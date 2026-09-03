require('dotenv').config({ quiet: true });

const { obtenirOuCreerProspect } = require('../../prospects-notion.js');
const { creerLimiteur, ipClient } = require('../../limiteur.js');

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const limiteur = creerLimiteur({ max: 8 });

function reponse(statusCode, payload) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(payload) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reponse(405, { erreur: 'Méthode non autorisée.' });
  if (String(event.body || '').length > 10000) return reponse(413, { erreur: 'Données trop volumineuses.' });
  let corps;
  try {
    corps = JSON.parse(event.body || '{}');
  } catch {
    return reponse(400, { erreur: 'Données invalides.' });
  }

  const prenom = String(corps.prenom || '').trim();
  const email = String(corps.email || '').trim().toLowerCase();
  const source = String(corps.source || 'lien-direct').trim().slice(0, 120);
  if (!prenom || prenom.length > 80 || !EMAIL_RE.test(email) || email.length > 254 || corps.consentement !== true) {
    return reponse(400, { erreur: 'Prénom, email et consentement valides requis.' });
  }
  // Un corps sans dureeMs donnait NaN, donc « pas trop rapide » : la comparaison est
  // inversée pour qu'une valeur absente ou invalide soit traitée comme suspecte.
  const duree = Number(corps.dureeMs);
  if (corps.website || !(duree >= 1200)) return reponse(202, { accepte: true });
  if (limiteur.depasse(ipClient(event))) return reponse(429, { erreur: 'Trop de demandes. Réessaie plus tard.' });

  try {
    const prospect = await obtenirOuCreerProspect({
      prenom,
      email,
      source,
      baseUrl: process.env.PUBLIC_SITE_URL || 'https://spherier-coachs.netlify.app',
    });

    if (!process.env.N8N_SPHERIER_WEBHOOK_URL || !process.env.N8N_SPHERIER_WEBHOOK_SECRET) {
      throw new Error('Configuration n8n manquante');
    }
    const envoi = await fetch(process.env.N8N_SPHERIER_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-spherier-secret': process.env.N8N_SPHERIER_WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        prenom,
        email,
        uuid: prospect.uuid,
        lien: prospect.lien,
        nouveau: prospect.nouveau,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!envoi.ok) throw new Error(`n8n a répondu ${envoi.status}`);
    return reponse(202, { accepte: true });
  } catch (erreur) {
    console.error('access:', erreur.message);
    return reponse(502, { erreur: "L'envoi du lien n'a pas abouti" });
  }
};
