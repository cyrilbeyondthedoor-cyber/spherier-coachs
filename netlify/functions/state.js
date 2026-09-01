require('dotenv').config({ quiet: true });

const { getReferentielV2 } = require('../../referentiel-v2.js');
const { lireDernierSnapshotV2, composerEtat, estUuidV4 } = require('../../snapshot-v2.js');
const { lireNotes } = require('../../notes-v3.js');

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function reponse(statusCode, payload) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(payload) };
}

// GET /api/state?uuid=<uuid v4>
// Renvoie le dernier snapshot v2 du membre ET l'état calculé (niveaux complets et
// ouverture des thématiques). Sans snapshot, `snapshot` vaut null et l'état calculé
// décrit le point de départ : tout à 0, seules les racines ouvertes.
exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return reponse(405, { erreur: 'Méthode non autorisée, utilisez GET.' });
  }

  const uuid = (event.queryStringParameters || {}).uuid;
  if (!estUuidV4(uuid)) {
    return reponse(400, { erreur: 'uuid manquant ou invalide (UUID v4 attendu).' });
  }

  try {
    // Le référentiel est relu à chaque appel : c'est lui qui porte la structure, jamais
    // le snapshot. L'ouverture se recalcule donc toujours sur le graphe à jour.
    // Les notes voyagent avec l'état : elles vivent hors des snapshots, mais le
    // navigateur en a besoin dès l'ouverture pour signaler les compétences annotées.
    const [referentiel, snapshot, notes] = await Promise.all([
      getReferentielV2(),
      lireDernierSnapshotV2(uuid.trim().toLowerCase()),
      lireNotes(uuid.trim().toLowerCase()),
    ]);

    return reponse(200, { ...composerEtat({ referentiel, snapshot }), notes });
  } catch (err) {
    console.error('state:', err);
    return reponse(502, { erreur: "Lecture de l'état impossible." });
  }
};
