require('dotenv').config({ quiet: true });

const { obtenirOuCreerProspect } = require('../../prospects-notion.js');

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FENETRE_MS = 10 * 60 * 1000;
const MAX_TENTATIVES = 8;
const tentativesParIp = new Map();

function reponse(statusCode, payload) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(payload) };
}

function ipClient(event) {
  return String(event.headers?.['x-nf-client-connection-ip'] || event.headers?.['x-forwarded-for'] || 'inconnue')
    .split(',')[0].trim();
}

function depasseLaLimite(ip) {
  const maintenant = Date.now();
  const recentes = (tentativesParIp.get(ip) || []).filter((date) => maintenant - date < FENETRE_MS);
  recentes.push(maintenant);
  tentativesParIp.set(ip, recentes);
  return recentes.length > MAX_TENTATIVES;
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
  if (corps.website || Number(corps.dureeMs) < 1200) return reponse(202, { accepte: true });
  if (depasseLaLimite(ipClient(event))) return reponse(429, { erreur: 'Trop de demandes. Réessaie plus tard.' });

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
