require('dotenv').config({ quiet: true });

const { getReferentielV2 } = require('../../referentiel-v2.js');
const { validerNote, ecrireNote } = require('../../notes-v3.js');

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

  let corps;
  try {
    corps = JSON.parse(event.body || '{}');
  } catch {
    return reponse(400, { erreur: 'Corps de requête JSON invalide.' });
  }

  try {
    const referentiel = await getReferentielV2();
    const { erreurs, clientId, code, texte } = validerNote({ referentiel, corps });
    if (erreurs.length > 0) return reponse(400, { erreur: erreurs.join(' '), details: erreurs });

    const note = await ecrireNote({ clientId, code, texte });
    return reponse(200, { note });
  } catch (err) {
    console.error('note:', err);
    return reponse(502, { erreur: "Enregistrement de la note impossible." });
  }
};
