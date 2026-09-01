require('dotenv').config({ quiet: true });

const crypto = require('crypto');
const {
  getReferentielV2,
  viderCacheReferentiel,
  etatCacheReferentiel,
} = require('../../referentiel-v2.js');

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function reponse(statusCode, payload) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(payload) };
}

// Comparaison à durée constante : un `===` sur un secret laisse fuiter sa longueur et
// ses premiers caractères par le temps de réponse.
function jetonValide(fourni, attendu) {
  if (typeof fourni !== 'string' || typeof attendu !== 'string' || attendu === '') return false;
  const a = Buffer.from(fourni);
  const b = Buffer.from(attendu);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// POST /api/refresh?token=…   (le jeton est aussi accepté en en-tête X-Refresh-Token)
//
// Vide le cache du référentiel et le recharge aussitôt : c'est le bouton « appliquer
// maintenant » après une correction dans Notion, sans attendre l'expiration du TTL.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return reponse(405, { erreur: 'Méthode non autorisée, utilisez POST.' });
  }

  const attendu = process.env.REFRESH_TOKEN;
  if (!attendu) {
    console.error('refresh: REFRESH_TOKEN non défini côté serveur.');
    return reponse(503, { erreur: 'Purge non configurée sur ce serveur.' });
  }

  const fourni = (event.queryStringParameters || {}).token
    || event.headers?.['x-refresh-token']
    || '';

  if (!jetonValide(fourni, attendu)) {
    return reponse(401, { erreur: 'Jeton de purge invalide.' });
  }

  try {
    viderCacheReferentiel();
    // Rechargement immédiat : la première visite après une purge ne paie pas l'attente.
    const referentiel = await getReferentielV2();

    return reponse(200, {
      purge: true,
      recharge: {
        themes: referentiel.themes.length,
        competences: referentiel.competencies.length,
        ressources: referentiel.resources.length,
      },
      cache: etatCacheReferentiel(),
      // Le cache vit dans la mémoire d'une instance serverless : cette purge ne vaut
      // que pour l'instance qui a traité l'appel. Les autres expireront d'elles-mêmes.
      portee: "Instance ayant traité la requête uniquement ; les autres instances expirent d'elles-mêmes au bout du TTL.",
    });
  } catch (err) {
    console.error('refresh:', err);
    return reponse(502, { erreur: 'Rechargement du référentiel impossible.' });
  }
};
