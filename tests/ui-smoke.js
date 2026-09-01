const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const {
  CATEGORIES,
  DIMENSIONS,
  DIFFICULTES,
  ECHELLE,
  NIVEAU_ACQUIS,
  MAX_CIBLES_MAINTENANT,
} = require('../club.config.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'spherier-v2.html'));

const themes = DIMENSIONS.map((dimension, index) => ({
  id: `theme-${dimension.id}`,
  code: `${dimension.id}-01`,
  name: `Thématique ${dimension.id}`,
  dimension: dimension.name,
  definition: `Définition ${dimension.id}`,
  feeds: [],
  x: 180,
  y: 140,
  order: 1,
}));

const competencies = DIMENSIONS.map((dimension, index) => ({
  id: `${dimension.id}-01-01`,
  theme: `theme-${dimension.id}`,
  name: `Je sais mobiliser la compétence ${dimension.id}.`,
  definition: `Je sais mobiliser la compétence ${dimension.id}.`,
  statement: `Je sais mobiliser la compétence ${dimension.id}.`,
  markers: `Un exemple observable pour ${dimension.id}.`,
  difficulty: DIFFICULTES[index % DIFFICULTES.length].nom,
  order: 1,
  resources: [],
}));

const referential = {
  club: 'coachs',
  version: 1,
  categories: CATEGORIES,
  dimensions: DIMENSIONS,
  difficulties: DIFFICULTES,
  scale: ECHELLE,
  limites: { maxCiblesMaintenant: MAX_CIBLES_MAINTENANT, niveauAcquis: NIVEAU_ACQUIS },
  themes,
  competencies,
  resources: [],
};

const niveauxVides = Object.fromEntries(competencies.map((competence) => [competence.id, 0]));
const etatThemes = Object.fromEntries(themes.map((theme) => [theme.id, { status: 'open', unlock_hint: '' }]));
let dernierSnapshot = null;

function json(reponse, valeur) {
  reponse.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  reponse.end(JSON.stringify(valeur));
}

const serveur = http.createServer((requete, reponse) => {
  if (requete.url.startsWith('/api/referential')) return json(reponse, referential);
  if (requete.url.startsWith('/api/state')) {
    return json(reponse, {
      snapshot: null,
      computed: { levels: niveauxVides, themes: etatThemes },
      notes: {},
    });
  }
  if (requete.url === '/api/snapshot' && requete.method === 'POST') {
    let corps = '';
    requete.on('data', (morceau) => { corps += morceau; });
    requete.on('end', () => {
      dernierSnapshot = JSON.parse(corps);
      json(reponse, {
        snapshot: {
          id: 'snapshot-test',
          created_at: new Date().toISOString(),
          label: null,
          blob: {
            levels: dernierSnapshot.levels,
            selections: dernierSnapshot.selections,
          },
        },
        computed: { levels: dernierSnapshot.levels, themes: etatThemes },
      });
    });
    return;
  }
  reponse.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  reponse.end(html);
});

async function principal() {
  await new Promise((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  const adresse = serveur.address();
  const url = `http://127.0.0.1:${adresse.port}/?c=00000000-0000-4000-8000-000000000001`;
  const navigateur = await chromium.launch({ headless: true });

  try {
    const page = await navigateur.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(url);
    await page.locator('#ciel:not([hidden])').waitFor();

    assert.equal(await page.locator('.ciel-categorie').count(), 3);
    assert.deepEqual(await page.locator('.ciel-categorie-titre').allTextContents(), [
      'Moi en tant que coach',
      'Moi et mes clients',
      'Moi et mon activité',
    ]);
    assert.equal(await page.locator('.ciel-dimension').count(), 7);
    if (process.env.SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'accueil-desktop.png'), fullPage: true });
    }

    await page.locator('[data-ouvrir="FON"]').click();
    await page.locator('[data-dimension="FON"].ouverte').waitFor();
    await page.locator('[data-competence="FON-01-01"]').click();
    await page.getByText('Un exemple observable pour FON.').waitFor();
    assert.equal(await page.locator('.marche[data-niveau]').count(), 3);

    await page.locator('.marche[data-niveau="3"]').click();
    await page.locator('#panneau-fermer').click();
    await page.locator('#btn-enregistrer').click();
    await page.getByText('Ton sphérier est enregistré.').waitFor();
    assert.equal(dernierSnapshot.levels['FON-01-01'], 3);

    await page.locator('#btn-synthese').click();
    assert.equal(await page.locator('.syn-maitrise-item').count(), 3);
    await page.locator('.syn-maitrise-nom', { hasText: 'Socle fondamental' }).waitFor();

    const mobile = await navigateur.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto(url);
    await mobile.locator('#detail:not([hidden])').waitFor();
    assert.equal(await mobile.locator('.categorie-dimensions').count(), 3);
    assert.equal(await mobile.locator('.dimension').count(), 7);
    assert.equal(await mobile.locator('#ciel').isVisible(), false);
    if (process.env.SCREENSHOT_DIR) {
      await mobile.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'accueil-mobile.png') });
    }

    console.log('UI desktop, mobile et sauvegarde simulée : OK');
  } finally {
    await navigateur.close();
    serveur.closeAllConnections();
    await new Promise((resolve) => serveur.close(resolve));
  }
}

principal().catch((erreur) => {
  console.error(erreur);
  process.exitCode = 1;
});
