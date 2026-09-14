const { creerClientServeur, TABLE_SNAPSHOTS } = require('./supabase-client.js');
const { calculerOuverture, niveauxComplets, normaliserNiveau } = require('./ouverture-v2.js');
// Importée plutôt que redéfinie : la même constante à deux endroits finit toujours par
// diverger, et ici la divergence rendrait les snapshots illisibles en silence.
const { VERSION_REFERENTIEL, MAX_CIBLES_MAINTENANT } = require('./club.config.js');



const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function estUuidV4(valeur) {
  return typeof valeur === 'string' && UUID_V4_RE.test(valeur.trim());
}

// Dernier snapshot v2 du membre.
//
// Les snapshots antérieurs (référentiel v1) restent en base mais sont ignorés : leur
// blob décrit une tout autre structure, les comparer n'aurait aucun sens. On ne peut
// pas filtrer en SQL sur une clé JSON via PostgREST de façon lisible ici, donc on
// récupère les plus récents et on retient le premier qui est en v2.
async function lireDernierSnapshotV2(clientId) {
  const supabase = creerClientServeur();
  const { data, error } = await supabase
    .from(TABLE_SNAPSHOTS)
    .select('id, client_id, libelle, cree_le, blob')
    .eq('client_id', clientId)
    .order('cree_le', { ascending: false })
    .limit(50);

  if (error) throw new Error(`Lecture du snapshot impossible : ${error.message}`);

  const v2 = (data ?? []).find((ligne) => ligne.blob?.referential_version === VERSION_REFERENTIEL);
  return v2 ?? null;
}

// Contexte de reprise vide : la valeur qu'un membre sans snapshot, ou dont le snapshot
// date d'avant l'audit modulaire, doit recevoir. Un `audit` absent reste valide.
const AUDIT_VIDE = { passees: [], derniere: null, maj: null };

// Longueur maximale d'un identifiant repris tel quel du navigateur. Les codes du
// référentiel font une douzaine de caractères ; la borne existe pour qu'une requête
// forgée ne puisse pas faire grossir le blob par ce chemin.
const MAX_IDENTIFIANT = 64;

function identifiantBorne(valeur) {
  if (typeof valeur !== 'string') return null;
  const propre = valeur.trim();
  return propre !== '' && propre.length <= MAX_IDENTIFIANT ? propre : null;
}

// Assemble l'état renvoyé au navigateur : le snapshot brut, et l'état calculé.
// Le calcul d'ouverture vit côté serveur, un seul endroit où la règle existe.
function composerEtat({ referentiel, snapshot }) {
  const levels = snapshot?.blob?.levels ?? {};
  return {
    snapshot,
    // Renvoyé tel quel, sans recalcul : le contexte de reprise décrit où le membre en
    // était dans SON parcours. Le serveur n'a rien à en déduire, il le conserve.
    audit: snapshot?.blob?.audit ?? AUDIT_VIDE,
    computed: {
      levels: niveauxComplets({ referentiel, levels }),
      themes: calculerOuverture({ referentiel, levels }),
    },
  };
}

// Valide et normalise ce que le navigateur propose d'enregistrer.
// Les contraintes sont vérifiées ICI et pas seulement dans l'interface : une requête
// forgée ne doit pas pouvoir contourner le plafond ni le verrouillage pédagogique.
function validerEtNormaliser({ referentiel, corps }) {
  const erreurs = [];

  if (!estUuidV4(corps.uuid)) {
    erreurs.push('uuid manquant ou invalide (UUID v4 attendu).');
  }

  if (corps.referential_version !== undefined && corps.referential_version !== VERSION_REFERENTIEL) {
    erreurs.push(`referential_version doit valoir ${VERSION_REFERENTIEL}.`);
  }

  const levelsBruts = corps.levels ?? {};
  if (typeof levelsBruts !== 'object' || levelsBruts === null || Array.isArray(levelsBruts)) {
    erreurs.push('levels doit être un objet { CODE: niveau }.');
  }

  const selections = corps.selections ?? {};
  if (typeof selections !== 'object' || selections === null || Array.isArray(selections)) {
    erreurs.push('selections doit être un objet { current: [], later: [] }.');
  }
  const current = selections.current ?? [];
  const later = selections.later ?? [];
  if (!Array.isArray(current)) erreurs.push('selections.current doit être un tableau.');
  if (!Array.isArray(later)) erreurs.push('selections.later doit être un tableau.');

  // Contexte de l'audit modulaire. Absent = audit vide : un snapshot écrit avant que ce
  // champ n'existe reste parfaitement valide, et le membre n'a rien à remigrer.
  const auditBrut = corps.audit ?? {};
  const auditEstObjet = typeof auditBrut === 'object' && auditBrut !== null && !Array.isArray(auditBrut);
  if (!auditEstObjet) erreurs.push('audit doit être un objet { passees, derniere }.');
  const passeesBrutes = auditEstObjet ? (auditBrut.passees ?? []) : [];
  if (!Array.isArray(passeesBrutes)) erreurs.push('audit.passees doit être un tableau de codes.');

  if (erreurs.length > 0) return { erreurs };

  const competenceParCode = new Map(referentiel.competencies.map((c) => [c.id, c]));

  // Ne garder que des codes réellement présents dans le référentiel courant : un code
  // disparu depuis la dernière lecture ne doit pas être figé dans un nouveau snapshot.
  const levels = {};
  for (const [code, valeur] of Object.entries(levelsBruts)) {
    if (competenceParCode.has(code)) levels[code] = normaliserNiveau(valeur);
  }

  const filtrerCodes = (liste) => [...new Set(liste)].filter((code) => competenceParCode.has(code));
  const currentFiltre = filtrerCodes(current);
  // « Maintenant » et « plus tard » s'excluent : une compétence que l'on travaille
  // n'est plus en attente. Sans cette normalisation, promouvoir depuis la wishlist
  // laisserait la compétence dans les deux listes.
  const laterFiltre = filtrerCodes(later).filter((code) => !currentFiltre.includes(code));

  if (currentFiltre.length > MAX_CIBLES_MAINTENANT) {
    erreurs.push(`selections.current est limité à ${MAX_CIBLES_MAINTENANT} compétences (reçu ${currentFiltre.length}).`);
  }

  // L'ouverture est évaluée sur les niveaux SOUMIS, pas sur ceux du snapshot précédent :
  // monter une compétence et sélectionner la thématique ainsi débloquée doit pouvoir se
  // faire en un seul enregistrement.
  const ouverture = calculerOuverture({ referentiel, levels });
  const horsThematiqueOuverte = currentFiltre.filter((code) => {
    const themeId = competenceParCode.get(code).theme;
    return ouverture[themeId]?.status !== 'open';
  });
  if (horsThematiqueOuverte.length > 0) {
    erreurs.push(`selections.current ne peut viser que des thématiques ouvertes (refusé : ${horsThematiqueOuverte.join(', ')}).`);
  }

  // « Passées » porte une décision du membre — j'ai vu cette compétence et je la laisse
  // de côté — donc un code inconnu est refusé plutôt que filtré en silence : contrairement
  // aux niveaux, il n'y a rien à retomber dessus, et l'erreur signale un envoi douteux.
  const passees = [...new Set(passeesBrutes)];
  if (passees.length > referentiel.competencies.length) {
    erreurs.push(`audit.passees est limité à ${referentiel.competencies.length} codes (reçu ${passees.length}).`);
  }
  const passeesInconnues = passees.filter((code) => !competenceParCode.has(code));
  if (passeesInconnues.length > 0) {
    erreurs.push(`audit.passees contient des codes absents du référentiel (${passeesInconnues.slice(0, 5).join(', ')}).`);
  }

  if (erreurs.length > 0) return { erreurs };

  // Le repère de reprise, lui, est un simple signet : s'il pointe vers une compétence
  // disparue du référentiel depuis la dernière session, on l'abandonne au lieu de
  // refuser l'enregistrement entier — ce serait perdre l'audit pour un détail d'écran.
  const brute = auditBrut.derniere;
  let derniere = null;
  if (brute && typeof brute === 'object' && !Array.isArray(brute)) {
    const code = identifiantBorne(brute.code);
    const dimensionId = identifiantBorne(brute.dimensionId);
    const themeId = identifiantBorne(brute.themeId);
    if (code && dimensionId && themeId && competenceParCode.has(code)) {
      derniere = { dimensionId, themeId, code };
    }
  }

  return {
    erreurs: [],
    clientId: corps.uuid.trim().toLowerCase(),
    libelle: typeof corps.label === 'string' && corps.label.trim() !== '' ? corps.label.trim() : null,
    blob: {
      referential_version: VERSION_REFERENTIEL,
      levels,
      // « plus tard » est libre : sans plafond, et autorisé même en thématique verrouillée.
      selections: { current: currentFiltre, later: laterFiltre },
      // L'horodatage est posé ICI et pas repris du navigateur : une horloge de poste
      // mal réglée écrirait une date de reprise fantaisiste dans la base.
      audit: { passees, derniere, maj: new Date().toISOString() },
    },
  };
}

// Écriture append-only : jamais d'UPDATE, chaque enregistrement est une nouvelle ligne.
async function ecrireSnapshotV2({ clientId, libelle, blob }) {
  const supabase = creerClientServeur();
  const { data, error } = await supabase
    .from(TABLE_SNAPSHOTS)
    .insert({ client_id: clientId, libelle, blob })
    .select('id, client_id, libelle, cree_le, blob')
    .single();

  if (error) throw new Error(`Insertion du snapshot impossible : ${error.message}`);
  return data;
}

module.exports = {
  lireDernierSnapshotV2,
  composerEtat,
  validerEtNormaliser,
  ecrireSnapshotV2,
  estUuidV4,
  VERSION_REFERENTIEL,
  MAX_CIBLES_MAINTENANT,
};
