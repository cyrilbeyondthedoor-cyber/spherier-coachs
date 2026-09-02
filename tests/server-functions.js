const assert = require('node:assert/strict');

process.env.N8N_SPHERIER_WEBHOOK_URL = 'https://n8n.example/webhook';
process.env.N8N_SPHERIER_WEBHOOK_SECRET = 'secret-test';
process.env.PUBLIC_SITE_URL = 'https://spherier.example';

const UUID = '11111111-1111-4111-8111-111111111111';
const pages = new Map();
const misesAJour = [];
let appelsN8n = [];

const prospectsPath = require.resolve('../prospects-notion.js');
require.cache[prospectsPath] = {
  id: prospectsPath,
  filename: prospectsPath,
  loaded: true,
  exports: {
    morceaux: (texte) => texte ? [{ type: 'text', text: { content: texte } }] : [],
    obtenirOuCreerProspect: async ({ prenom, email }) => {
      if (!pages.has(email)) pages.set(email, { prenom, uuid: UUID, lien: `https://spherier.example/?c=${UUID}` });
      const prospect = pages.get(email);
      return { pageId: 'page-1', ...prospect, nouveau: pages.size === 1 };
    },
    trouverProspectParUuid: async (uuid) => uuid === UUID ? { id: 'page-1' } : null,
    mettreAJourProspect: async (pageId, properties) => { misesAJour.push({ pageId, properties }); },
  },
};

global.fetch = async (url, options) => {
  appelsN8n.push({ url, options, body: JSON.parse(options.body) });
  return { ok: true, status: 202 };
};

const { handler: acces } = require('../netlify/functions/access.js');

async function testerAcces() {
  const invalide = await acces({ httpMethod: 'POST', body: JSON.stringify({ prenom: '', email: 'x', consentement: false }) });
  assert.equal(invalide.statusCode, 400);

  const corps = { prenom: 'Camille', email: 'Camille@Example.com', consentement: true, source: 'webinaire' };
  const premier = await acces({ httpMethod: 'POST', body: JSON.stringify(corps) });
  const second = await acces({ httpMethod: 'POST', body: JSON.stringify(corps) });
  assert.equal(premier.statusCode, 202);
  assert.equal(second.statusCode, 202);
  assert.equal(appelsN8n.length, 2);
  assert.equal(appelsN8n[0].body.uuid, UUID);
  assert.equal(appelsN8n[1].body.uuid, UUID);
  assert.equal(appelsN8n[0].options.headers['x-spherier-secret'], 'secret-test');
}

const referentielPath = require.resolve('../referentiel-v2.js');
require.cache[referentielPath] = {
  id: referentielPath,
  filename: referentielPath,
  loaded: true,
  exports: {
    getReferentielV2: async () => ({
      competencies: [
        { id: 'FON-01-01', name: 'Poser le cadre' },
        { id: 'ALL-01-01', name: 'Créer la confiance' },
        { id: 'COM-01-01', name: 'Écouter avec précision' },
      ],
    }),
  },
};

const { handler: evenement } = require('../netlify/functions/prospect-event.js');

async function testerEvenements() {
  const started = await evenement({ httpMethod: 'POST', body: JSON.stringify({ uuid: UUID, type: 'started' }) });
  assert.equal(started.statusCode, 204);
  assert.ok(misesAJour.at(-1).properties['Audit commencé le']);

  const progress = await evenement({
    httpMethod: 'POST',
    body: JSON.stringify({
      uuid: UUID,
      type: 'progress',
      progression: 1,
      priorites: ['FON-01-01', 'ALL-01-01', 'INCONNU'],
    }),
  });
  assert.equal(progress.statusCode, 204);
  const proprietes = misesAJour.at(-1).properties;
  assert.equal(proprietes['Progression audit'].number, 1);
  assert.ok(proprietes['Audit terminé le']);
  assert.equal(proprietes['Priorité 1'].rich_text[0].text.content, 'FON-01-01 — Poser le cadre');
  assert.deepEqual(proprietes['Priorité 3'].rich_text, []);

  const agenda = await evenement({ httpMethod: 'POST', body: JSON.stringify({ uuid: UUID, type: 'agenda_clicked' }) });
  assert.equal(agenda.statusCode, 204);
  assert.ok(misesAJour.at(-1).properties['Agenda cliqué le']);
}

Promise.resolve()
  .then(testerAcces)
  .then(testerEvenements)
  .then(() => console.log('Fonctions accès et suivi prospect : OK'))
  .catch((erreur) => {
    console.error(erreur);
    process.exit(1);
  });
