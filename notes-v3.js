const { creerClientServeur } = require('./supabase-client.js');
const { estUuidV4 } = require('./snapshot-v2.js');

const TABLE_NOTES = 'notes';
const LONGUEUR_MAX = 4000;

// Notes personnelles du membre.
//
// Régime d'écriture opposé à celui des snapshots : ceux-ci sont append-only et figent
// un moment, une note appartient à la COMPÉTENCE. On la relit, on la complète, on la
// corrige — il n'y a donc qu'une note par compétence, et elle est modifiée sur place.

async function lireNotes(clientId) {
  const supabase = creerClientServeur();
  const { data, error } = await supabase
    .from(TABLE_NOTES)
    .select('code, texte, cree_le, maj_le, revision')
    .eq('client_id', clientId);

  if (error) throw new Error(`Lecture des notes impossible : ${error.message}`);

  // Renvoyées indexées par code : c'est ainsi que le renderer les consomme.
  const notes = {};
  (data ?? []).forEach((n) => {
    notes[n.code] = { texte: n.texte, cree_le: n.cree_le, maj_le: n.maj_le, revision: n.revision };
  });
  return notes;
}

function validerNote({ referentiel, corps }) {
  const erreurs = [];
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return { erreurs: ['Le corps doit être un objet JSON.'] };

  if (!estUuidV4(corps.uuid)) {
    erreurs.push('uuid manquant ou invalide (UUID v4 attendu).');
  }
  if (typeof corps.code !== 'string' || !referentiel.competencies.some((c) => c.id === corps.code)) {
    erreurs.push('code de compétence inconnu.');
  }
  if (corps.texte !== undefined && typeof corps.texte !== 'string') {
    erreurs.push('texte doit être une chaîne.');
  }
  if (typeof corps.texte === 'string' && corps.texte.length > LONGUEUR_MAX) {
    erreurs.push(`texte limité à ${LONGUEUR_MAX} caractères (reçu ${corps.texte.length}).`);
  }

  if (erreurs.length > 0) return { erreurs };

  return {
    erreurs: [],
    clientId: corps.uuid.trim().toLowerCase(),
    code: corps.code,
    texte: (corps.texte ?? '').trim(),
  };
}

// Écriture unique : on crée ou on remplace, jamais on n'empile.
// Une note vidée conserve sa révision pour empêcher un ancien appareil de la recréer.
async function ecrireNote({ clientId, code, texte, baseRevision }) {
  const { data, error } = await creerClientServeur().rpc('save_spherier_note', {
    p_client_id: clientId, p_code: code, p_text: texte, p_base_revision: baseRevision,
  });
  if (error) throw new Error(`Enregistrement de la note impossible : ${error.message}`);
  if (data.conflict) throw Object.assign(new Error('Cette note a changé sur un autre appareil.'), { status: 409, current: data.current });
  return { ...data.note, supprimee: data.note.texte === '' };
}

module.exports = { lireNotes, validerNote, ecrireNote, TABLE_NOTES, LONGUEUR_MAX };
