require('dotenv').config({ quiet: true });

const { getReferentielV2, etatCacheReferentiel } = require('../../referentiel-v2.js');

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function reponse(statusCode, payload, entetes = {}) {
  return { statusCode, headers: { ...HEADERS, ...entetes }, body: JSON.stringify(payload) };
}

// GET /api/referential
// Renvoie le graphe complet du référentiel v2, toujours lu en live depuis Notion :
// il n'est jamais figé dans un snapshot, pour que corriger un libellé côté Notion se
// répercute immédiatement sans redéploiement.
exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return reponse(405, { erreur: 'Méthode non autorisée, utilisez GET.' });
  }

  try {
    const referentiel = await getReferentielV2();
    return reponse(200, referentiel, {
      // Pas de cache HTTP : c'est le cache mémoire côté serveur (TTL 10 min) qui absorbe
      // la charge. Une copie retenue par le CDN survivrait à /api/refresh et rendrait la
      // purge sans effet visible.
      'Cache-Control': 'no-store',
      // Observabilité : savoir si la réponse vient du cache et quand il expire.
      'X-Referentiel-Cache': JSON.stringify(etatCacheReferentiel()),
    });
  } catch (err) {
    console.error('referential:', err);
    return reponse(502, { erreur: 'Lecture du référentiel impossible.' });
  }
};
