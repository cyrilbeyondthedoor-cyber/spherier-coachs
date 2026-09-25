require('dotenv').config({ quiet: true });

const { getReferentielV2 } = require('../../referentiel-v2.js');
const { validerEtNormaliser, ecrireSnapshotV2, composerEtat, estUuidV4 } = require('../../snapshot-v2.js');
const { creerLimiteur, ipClient } = require('../../limiteur.js');

const limiteur = creerLimiteur({ max: 60 });

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function reponse(statusCode, payload) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(payload) };
}

// POST /api/snapshot
// Corps attendu :
// { uuid, referential_version: 2, levels: { "INT-01": 2 },
//   selections: { current: ["INT-01"], later: ["REL-12"] }, label?: "…" }
//
// Le navigateur n'envoie que des niveaux et des sélections. La structure n'est jamais
// gelée : elle reste lue en live depuis Notion.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return reponse(405, { erreur: 'Méthode non autorisée, utilisez POST.' });
  }
  if (String(event.body || '').length > 2000000) return reponse(413, { erreur: 'Données trop volumineuses.' });
  if (limiteur.depasse(ipClient(event))) return reponse(429, { erreur: 'Trop de demandes. Réessaie dans quelques minutes.' });

  let corps;
  try {
    corps = JSON.parse(event.body || '{}');
  } catch {
    return reponse(400, { erreur: 'Corps de requête JSON invalide.' });
  }

  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return reponse(400, { erreur: 'Le corps doit être un objet JSON.' });

  if (!Object.hasOwn(corps, 'base_snapshot_id')) return reponse(428, { erreur: 'Recharge cette page pour utiliser la nouvelle sauvegarde.' });
  if (corps.base_snapshot_id !== null && !estUuidV4(corps.base_snapshot_id)) return reponse(400, { erreur: 'Version de départ invalide.' });

  try {
    const referentiel = await getReferentielV2();

    // Plafond de « maintenant » et verrouillage pédagogique vérifiés côté serveur :
    // l'interface n'est pas la seule barrière.
    const { erreurs, clientId, libelle, blob } = validerEtNormaliser({ referentiel, corps });
    if (erreurs.length > 0) {
      return reponse(400, { erreur: erreurs.join(' '), details: erreurs });
    }

    const snapshot = await ecrireSnapshotV2({ clientId, libelle, blob, baseSnapshotId: corps.base_snapshot_id });

    // Renvoyer l'état recalculé évite au navigateur un aller-retour supplémentaire, et
    // garantit qu'il affiche l'ouverture telle que le serveur vient de la déterminer.
    return reponse(201, composerEtat({ referentiel, snapshot }));
  } catch (err) {
    if (err.status === 409) return reponse(409, { erreur: err.message, current: err.current });
    console.error('snapshot:', err);
    return reponse(502, { erreur: "Enregistrement du snapshot impossible." });
  }
};
