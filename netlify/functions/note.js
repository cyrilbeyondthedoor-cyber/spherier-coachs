require('dotenv').config({ quiet: true });

const { getReferentielV2 } = require('../../referentiel-v2.js');
const { validerNote, ecrireNote } = require('../../notes-v3.js');
const { creerLimiteur, ipClient } = require('../../limiteur.js');

const limiteur = creerLimiteur({ max: 120 });

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const reponse = (statusCode, payload) => ({ statusCode, headers: HEADERS, body: JSON.stringify(payload) });

// POST /api/note   { uuid, code, texte }
//
// Écriture immédiate et isolée : une note ne passe pas par la barre d'enregistrement du
// sphérier. Quelques phrases écrites sur une conversation difficile ne doivent pas
// dépendre d'un geste que le membre pourrait oublier de faire.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return reponse(405, { erreur: 'Méthode non autorisée, utilisez POST.' });
  }
  if (String(event.body || '').length > 16000) return reponse(413, { erreur: 'Données trop volumineuses.' });
  if (limiteur.depasse(ipClient(event))) return reponse(429, { erreur: 'Trop de demandes. Réessaie dans quelques minutes.' });

  let corps;
  try {
    corps = JSON.parse(event.body || '{}');
  } catch {
    return reponse(400, { erreur: 'Corps de requête JSON invalide.' });
  }

  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return reponse(400, { erreur: 'Le corps doit être un objet JSON.' });

  if (!Object.hasOwn(corps, 'base_revision')) return reponse(428, { erreur: 'Recharge cette page pour utiliser la nouvelle sauvegarde.' });
  if (corps.base_revision !== null && (!Number.isSafeInteger(corps.base_revision) || corps.base_revision < 1)) return reponse(400, { erreur: 'Version de note invalide.' });

  try {
    const referentiel = await getReferentielV2();
    const { erreurs, clientId, code, texte } = validerNote({ referentiel, corps });
    if (erreurs.length > 0) return reponse(400, { erreur: erreurs.join(' '), details: erreurs });

    const note = await ecrireNote({ clientId, code, texte, baseRevision: corps.base_revision });
    return reponse(200, { note });
  } catch (err) {
    if (err.status === 409) return reponse(409, { erreur: err.message, current: err.current });
    console.error('note:', err);
    return reponse(502, { erreur: "Enregistrement de la note impossible." });
  }
};
