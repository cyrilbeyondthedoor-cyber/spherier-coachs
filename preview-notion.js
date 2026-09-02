require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { getReferentielV2 } = require('./referentiel-v2.js');

const PORT = Number(process.env.PORT || 8890);
const CLIENT_ID = '00000000-0000-4000-8000-000000000001';
const html = fs.readFileSync(path.join(__dirname, 'public', 'spherier-v2.html'));

function json(reponse, valeur, statusCode = 200) {
  reponse.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  reponse.end(JSON.stringify(valeur));
}

function lireCorps(requete) {
  return new Promise((resolve, reject) => {
    let corps = '';
    requete.on('data', (morceau) => { corps += morceau; });
    requete.on('end', () => {
      try {
        resolve(corps ? JSON.parse(corps) : {});
      } catch (erreur) {
        reject(erreur);
      }
    });
    requete.on('error', reject);
  });
}

async function principal() {
  const referentiel = await getReferentielV2({ force: true });
  let levels = Object.fromEntries(referentiel.competencies.map((competence) => [competence.id, 0]));
  let selections = { current: [], later: [] };
  let snapshot = null;
  const notes = {};
  const prospects = new Map();

  const etatThemes = () => Object.fromEntries(
    referentiel.themes.map((theme) => [theme.id, { status: 'open', unlock_hint: '' }])
  );

  const serveur = http.createServer(async (requete, reponse) => {
    try {
      const url = new URL(requete.url, `http://${requete.headers.host}`);

      if (url.pathname === '/api/referential') return json(reponse, referentiel);
      if (url.pathname === '/api/state') {
        const demoComplet = (requete.headers.referer || '').includes('demo=complete');
        const levelsServis = demoComplet
          ? Object.fromEntries(referentiel.competencies.map((competence, index) => [competence.id, (index % 3) + 1]))
          : levels;
        return json(reponse, {
          snapshot,
          computed: { levels: levelsServis, themes: etatThemes() },
          notes,
        });
      }
      if (url.pathname === '/api/access' && requete.method === 'POST') {
        const corps = await lireCorps(requete);
        const email = String(corps.email || '').trim().toLowerCase();
        const prenom = String(corps.prenom || '').trim();
        if (!prenom || !/^\S+@\S+\.\S+$/.test(email) || corps.consentement !== true) {
          return json(reponse, { erreur: 'Prénom, email et consentement valides requis' }, 400);
        }
        if (!prospects.has(email)) prospects.set(email, { prenom, email, uuid: randomUUID() });
        return json(reponse, { accepte: true }, 202);
      }
      if (url.pathname === '/api/prospect-event' && requete.method === 'POST') {
        return json(reponse, {}, 204);
      }
      if (url.pathname === '/api/snapshot' && requete.method === 'POST') {
        const corps = await lireCorps(requete);
        levels = { ...levels, ...(corps.levels || {}) };
        selections = corps.selections || selections;
        snapshot = {
          id: `preview-${Date.now()}`,
          created_at: new Date().toISOString(),
          label: corps.label || null,
          blob: { levels, selections },
        };
        return json(reponse, { snapshot, computed: { levels, themes: etatThemes() } });
      }
      if (url.pathname === '/api/note' && requete.method === 'POST') {
        const corps = await lireCorps(requete);
        notes[corps.code] = {
          texte: corps.texte || '',
          cree_le: new Date().toISOString(),
          maj_le: new Date().toISOString(),
        };
        return json(reponse, notes[corps.code]);
      }

      reponse.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      reponse.end(html);
    } catch (erreur) {
      json(reponse, { erreur: erreur.message }, 500);
    }
  });

  serveur.listen(PORT, '127.0.0.1', () => {
    console.log(`Aperçu local : http://127.0.0.1:${PORT}/?c=${CLIENT_ID}`);
    console.log('Les sauvegardes restent en mémoire locale et disparaissent à l’arrêt du serveur.');
  });

  const fermer = () => serveur.close(() => process.exit(0));
  process.on('SIGINT', fermer);
  process.on('SIGTERM', fermer);
}

principal().catch((erreur) => {
  console.error(erreur);
  process.exit(1);
});
