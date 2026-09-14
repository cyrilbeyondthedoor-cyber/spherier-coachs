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

// Priorités vides : un snapshot écrit avant le classement reste valide, et le membre
// n'a rien à remigrer. Même principe que `audit`.
const PRIORITES_VIDES = { themes: {}, dimensions: {}, classement: [] };

// Trois priorités par thématique et par dimension : le plafond est la règle
// pédagogique, pas un détail d'affichage, donc il est tenu ici aussi.
const MAX_PRIORITES_PAR_ENTREE = 3;
// Le classement est l'union des priorités de toutes les dimensions : avec 6 dimensions
// il plafonne à 18. La borne à 100 n'existe que pour qu'une requête forgée ne puisse
// pas faire grossir le blob par ce chemin.
const MAX_CLASSEMENT = 100;

// Un code appartient à une dimension par sa thématique : la compétence porte `theme`,
// la thématique porte le NOM de sa dimension, et la dimension porte son identifiant.
function indexDimensions(referentiel) {
  const idParNom = new Map((referentiel.dimensions ?? []).map((d) => [d.name, d.id]));
  const parTheme = new Map((referentiel.themes ?? []).map((t) => [t.id, idParNom.get(t.dimension) ?? null]));
  return (competence) => (competence ? parTheme.get(competence.theme) ?? null : null);
}

// Valide `priorites` et le renvoie normalisé. Les entrées mal formées remplissent
// `erreurs` : un code inconnu ou rangé sous la mauvaise thématique signale un envoi
// douteux, pas une donnée à corriger en silence — même raisonnement que `audit.passees`.
function validerPriorites({ referentiel, brut, competenceParCode, erreurs }) {
  if (brut === undefined) return { themes: {}, dimensions: {}, classement: [] };
  if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) {
    erreurs.push('priorites doit être un objet { themes, dimensions, classement }.');
    return { themes: {}, dimensions: {}, classement: [] };
  }

  const dimensionDe = indexDimensions(referentiel);
  const themeDe = (code) => competenceParCode.get(code)?.theme ?? null;

  const validerGroupe = (nom, groupeBrut, appartient, cleConnue) => {
    const resultat = {};
    if (groupeBrut === undefined) return resultat;
    if (typeof groupeBrut !== 'object' || groupeBrut === null || Array.isArray(groupeBrut)) {
      erreurs.push(`priorites.${nom} doit être un objet { identifiant: [codes] }.`);
      return resultat;
    }
    for (const [cle, liste] of Object.entries(groupeBrut)) {
      // La clé est vérifiée AVANT la liste : une liste vide n'a aucun code pour trahir
      // une clé inventée, et un objet plein de clés arbitraires grossirait le blob.
      if (!cleConnue(cle)) {
        erreurs.push(`priorites.${nom} contient un identifiant absent du référentiel.`);
        continue;
      }
      if (!Array.isArray(liste)) {
        erreurs.push(`priorites.${nom}["${cle}"] doit être un tableau de codes.`);
        continue;
      }
      const codes = [...new Set(liste)];
      const inconnus = codes.filter((code) => !competenceParCode.has(code));
      if (inconnus.length > 0) {
        erreurs.push(`priorites.${nom}["${cle}"] contient des codes absents du référentiel (${inconnus.slice(0, 5).join(', ')}).`);
        continue;
      }
      const etrangers = codes.filter((code) => appartient(code) !== cle);
      if (etrangers.length > 0) {
        erreurs.push(`priorites.${nom}["${cle}"] contient des codes qui n'en font pas partie (${etrangers.slice(0, 5).join(', ')}).`);
        continue;
      }
      if (codes.length > MAX_PRIORITES_PAR_ENTREE) {
        erreurs.push(`priorites.${nom}["${cle}"] est limité à ${MAX_PRIORITES_PAR_ENTREE} compétences (reçu ${codes.length}).`);
        continue;
      }
      // Un tableau vide est conservé : pour une dimension, il dit « j'ai consolidé, et
      // je n'ai rien retenu », ce qui n'est pas la même chose que « je n'ai pas encore
      // consolidé ». La distinction décide si les priorités de thématique remontent.
      resultat[cle] = codes;
    }
    return resultat;
  };

  const themesConnus = new Set((referentiel.themes ?? []).map((t) => t.id));
  const dimensionsConnues = new Set((referentiel.dimensions ?? []).map((d) => d.id));
  const themes = validerGroupe('themes', brut.themes, themeDe, (cle) => themesConnus.has(cle));
  const dimensions = validerGroupe('dimensions', brut.dimensions,
    (code) => dimensionDe(competenceParCode.get(code)), (cle) => dimensionsConnues.has(cle));

  let classement = [];
  if (brut.classement !== undefined) {
    if (!Array.isArray(brut.classement)) {
      erreurs.push('priorites.classement doit être un tableau de codes.');
    } else if (brut.classement.length > MAX_CLASSEMENT) {
      erreurs.push(`priorites.classement est limité à ${MAX_CLASSEMENT} codes (reçu ${brut.classement.length}).`);
    } else {
      // Dédoublonné plutôt que refusé : l'ORDRE est la donnée, un code répété n'est pas
      // une intention contradictoire, juste une liste mal recomposée.
      classement = [...new Set(brut.classement)];
      const inconnus = classement.filter((code) => !competenceParCode.has(code));
      if (inconnus.length > 0) {
        erreurs.push(`priorites.classement contient des codes absents du référentiel (${inconnus.slice(0, 5).join(', ')}).`);
        classement = [];
      }
    }
  }

  return { themes, dimensions, classement };
}

// Dérive « maintenant » et « plus tard » du classement. `current` reste EXACTEMENT les
// trois premières du classement : c'est l'invariant sur lequel Mon mois, la carte et la
// synthèse s'appuient, et compléter le mois avec d'anciens choix le romprait. Ces anciens
// choix ne sont pas perdus pour autant : l'appelant les met en tête de `laterExistant`.
// Dérive « maintenant » et « plus tard » du classement. C'est ce qui permet à Mon mois,
// à la carte et à la synthèse de continuer à lire `selections` sans rien savoir des
// priorités : une seule source d'ordre, trois écrans qui la lisent comme avant.
// Appliquée à l'enregistrement ET à la relecture, pour qu'un snapshot ancien relu
// aujourd'hui donne le même résultat qu'un snapshot écrit aujourd'hui.
function deriverSelections({ priorites, maxMaintenant, laterExistant = [], estOuverte = () => true }) {
  const classement = priorites?.classement ?? [];
  if (classement.length === 0) return null;

  const tete = classement.slice(0, maxMaintenant);
  // Une compétence dont la thématique est fermée ne peut pas être une cible : le
  // contrat le refuse. Elle glisse en « plus tard » au lieu de faire échouer tout
  // l'enregistrement — le classement du membre n'a pas à payer une règle d'ouverture.
  const current = tete.filter((code) => estOuverte(code));
  const prioritesTheme = Object.values(priorites?.themes ?? {}).flat();
  const later = [...new Set([
    ...tete.filter((code) => !estOuverte(code)),
    ...classement.slice(maxMaintenant),
    // Les priorités de thématique non retenues au niveau dimension ne disparaissent
    // pas : elles rejoignent la file d'attente.
    ...prioritesTheme,
    ...laterExistant,
  ])].filter((code) => !current.includes(code));

  return { current, later };
}

// Assemble l'état renvoyé au navigateur : le snapshot brut, et l'état calculé.
// Le calcul d'ouverture vit côté serveur, un seul endroit où la règle existe.
function composerEtat({ referentiel, snapshot }) {
  const levels = snapshot?.blob?.levels ?? {};
  const themesOuverts = calculerOuverture({ referentiel, levels });
  const priorites = snapshot?.blob?.priorites ?? PRIORITES_VIDES;
  const competenceParCode = new Map(referentiel.competencies.map((c) => [c.id, c]));

  // Le classement fait autorité sur « maintenant » et « plus tard ». Un snapshot écrit
  // avant qu'il n'existe n'en a pas : ses sélections repartent telles quelles.
  const selectionsBlob = snapshot?.blob?.selections ?? { current: [], later: [] };
  const derivees = deriverSelections({
    priorites,
    maxMaintenant: MAX_CIBLES_MAINTENANT,
    // L'ancien « maintenant » entre dans la file d'attente avant l'ancien « plus tard ».
    // Sans lui, les trois priorités choisies avant l'existence du classement
    // disparaîtraient du modèle au premier classement, sans un mot.
    laterExistant: [...(selectionsBlob.current ?? []), ...(selectionsBlob.later ?? [])],
    estOuverte: (code) => themesOuverts[competenceParCode.get(code)?.theme]?.status === 'open',
  });
  const snapshotSorti = derivees && snapshot
    ? { ...snapshot, blob: { ...snapshot.blob, selections: derivees } }
    : snapshot;

  return {
    snapshot: snapshotSorti,
    // Renvoyé tel quel, sans recalcul : le contexte de reprise décrit où le membre en
    // était dans SON parcours. Le serveur n'a rien à en déduire, il le conserve.
    audit: snapshot?.blob?.audit ?? AUDIT_VIDE,
    priorites,
    computed: {
      levels: niveauxComplets({ referentiel, levels }),
      themes: themesOuverts,
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
  const currentBrut = filtrerCodes(current);
  // « Maintenant » et « plus tard » s'excluent : une compétence que l'on travaille
  // n'est plus en attente. Sans cette normalisation, promouvoir depuis la wishlist
  // laisserait la compétence dans les deux listes.
  const laterBrut = filtrerCodes(later).filter((code) => !currentBrut.includes(code));

  const priorites = validerPriorites({ referentiel, brut: corps.priorites, competenceParCode, erreurs });
  if (erreurs.length > 0) return { erreurs };

  // L'ouverture est évaluée sur les niveaux SOUMIS, pas sur ceux du snapshot précédent :
  // monter une compétence et sélectionner la thématique ainsi débloquée doit pouvoir se
  // faire en un seul enregistrement.
  const ouverture = calculerOuverture({ referentiel, levels });

  // Le classement écrase les sélections envoyées : c'est lui que le membre a ordonné,
  // et deux sources d'ordre finiraient par diverger. Sans classement, rien ne change.
  const derivees = deriverSelections({
    priorites,
    maxMaintenant: MAX_CIBLES_MAINTENANT,
    // Même raison qu'à la relecture : ce que le membre travaillait avant de classer
    // passe en tête de sa file d'attente au lieu de sortir du modèle.
    laterExistant: [...currentBrut, ...laterBrut],
    estOuverte: (code) => ouverture[competenceParCode.get(code)?.theme]?.status === 'open',
  });
  const currentFiltre = derivees ? derivees.current : currentBrut;
  const laterFiltre = derivees ? derivees.later : laterBrut;

  if (currentFiltre.length > MAX_CIBLES_MAINTENANT) {
    erreurs.push(`selections.current est limité à ${MAX_CIBLES_MAINTENANT} compétences (reçu ${currentFiltre.length}).`);
  }

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
      // Priorités par thématique, par dimension, et le classement qui les ordonne.
      priorites,
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
  deriverSelections,
  ecrireSnapshotV2,
  estUuidV4,
  VERSION_REFERENTIEL,
  MAX_CIBLES_MAINTENANT,
};
