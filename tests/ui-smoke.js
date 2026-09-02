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
    const auditComplet = requete.url.includes('00000000-0000-4000-8000-000000000002');
    const levels = auditComplet
      ? Object.fromEntries(competencies.map((competence, index) => [competence.id, (index % 3) + 1]))
      : niveauxVides;
    return json(reponse, {
      snapshot: null,
      computed: { levels, themes: etatThemes },
      notes: {},
    });
  }
  if (requete.url === '/api/access' && requete.method === 'POST') {
    let corps = '';
    requete.on('data', (morceau) => { corps += morceau; });
    requete.on('end', () => json(reponse, { accepte: Boolean(JSON.parse(corps).email) }));
    return;
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

    await page.getByRole('heading', { name: 'Le sphérier de compétences de coach' }).waitFor();
    await page.getByRole('heading', { name: 'Comment utiliser le sphérier ?' }).waitFor();
    await page.getByText('marque une pause toutes les 30 compétences.').waitFor();
    await page.getByRole('button', { name: 'Réserver un échange', exact: true }).waitFor();
    const sphereAnimee = page.locator('.ciel-categorie').first();
    await sphereAnimee.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        pointerType: 'mouse',
        clientX: rect.left + rect.width * .78,
        clientY: rect.top + rect.height * .22,
      }));
    });
    await page.waitForTimeout(50);
    assert.match(await sphereAnimee.evaluate((element) => element.style.transform), /rotateX\(.+deg\) rotateY\(.+deg\)/);
    await sphereAnimee.dispatchEvent('pointerleave');
    await page.waitForTimeout(50);
    await page.getByRole('button', { name: 'Commencer mon audit initial' }).dispatchEvent('click');
    const compteurAudit = page.locator('.situer-compte');
    await compteurAudit.waitFor();
    assert.equal((await compteurAudit.textContent()).trim(), `1 / ${competencies.length}`);
    await page.locator('#panneau-fermer').dispatchEvent('click');

    assert.equal(await page.locator('.ciel-categorie').count(), 3);
    assert.deepEqual(await page.locator('.ciel-categorie-titre').allTextContents(), [
      'Moi en tant que coach',
      'Moi et mes clients',
      'Moi et mon activité',
    ]);
    assert.equal(await page.locator('.ciel-dimension').count(), 7);
    assert.ok((await page.locator('.ciel-dimension-compte').allTextContents()).every((texte) => texte.includes('% maîtrisées')));
    const cercles = await page.locator('.ciel-categorie').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        overflowX: element.scrollWidth - element.clientWidth,
        overflowY: element.scrollHeight - element.clientHeight,
      };
    }));
    assert.ok(cercles.every((cercle) => Math.abs(cercle.width - cercle.height) <= 1));
    assert.ok(cercles.every((cercle) => cercle.overflowX === 0 && cercle.overflowY === 0));
    assert.equal(await page.locator('.ciel-guide').count(), 0);
    if (process.env.SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'accueil-desktop.png'), fullPage: true });
    }

    await page.locator('[data-ouvrir="FON"]').dispatchEvent('click');
    await page.locator('[data-dimension="FON"].ouverte').waitFor();
    assert.equal(await page.locator('#presentation').isVisible(), false);
    await page.locator('[data-competence="FON-01-01"]').dispatchEvent('click');
    await page.getByText('Un exemple observable pour FON.').waitFor();
    assert.equal(await page.locator('.marche[data-niveau]').count(), 3);

    await page.locator('.marche[data-niveau="3"]').dispatchEvent('click');
    await page.locator('#panneau-fermer').dispatchEvent('click');
    await page.locator('#btn-enregistrer').dispatchEvent('click');
    await page.getByText('Ton sphérier est enregistré.').waitFor();
    assert.equal(dernierSnapshot.levels['FON-01-01'], 3);

    await page.locator('#btn-synthese').dispatchEvent('click');
    assert.equal(await page.locator('.syn-maitrise-item').count(), 3);
    await page.locator('.syn-maitrise-nom', { hasText: 'Socle fondamental' }).waitFor();
    await page.locator('.syn-maitrise-nom', { hasText: 'Professionnel établi' }).waitFor();
    assert.equal(await page.locator('[data-filtre="ouvertes"]').count(), 0);
    assert.ok(await page.locator('.syn-compte', { hasText: '100 % maîtrisées' }).count() >= 2);

    const publicPage = await navigateur.newPage({ viewport: { width: 1280, height: 900 } });
    await publicPage.goto(`http://127.0.0.1:${adresse.port}/`);
    await publicPage.getByRole('heading', { name: 'Accède au sphérier de compétences du coach' }).waitFor();
    await publicPage.locator('#acces-prenom').fill('Camille');
    await publicPage.locator('#acces-email').fill('camille@example.com');
    await publicPage.locator('#acces-consentement').check();
    await publicPage.getByRole('button', { name: 'Recevoir mon lien personnel' }).click();
    await publicPage.getByRole('heading', { name: 'Ton lien personnel est en route' }).waitFor();
    assert.ok(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    const resultatPage = await navigateur.newPage({ viewport: { width: 1280, height: 900 } });
    await resultatPage.goto(`http://127.0.0.1:${adresse.port}/?c=00000000-0000-4000-8000-000000000002`);
    await resultatPage.locator('#audit-cta').dispatchEvent('click');
    await resultatPage.getByRole('heading', { name: 'Sélectionne tes principales zones de progression' }).waitFor();
    assert.equal(await resultatPage.locator('.audit-zone').count(), 5);
    const options = resultatPage.locator('.audit-competence');
    await options.nth(0).dispatchEvent('click');
    await options.nth(1).dispatchEvent('click');
    await options.nth(2).dispatchEvent('click');
    await resultatPage.locator('#audit-suite').dispatchEvent('click');
    await resultatPage.getByRole('heading', { name: 'Tes trois priorités de progression' }).waitFor();
    await resultatPage.getByRole('button', { name: 'Réserver mon appel pour recevoir une analyse personnalisée de mon sphérier' }).waitFor();
    assert.equal(await resultatPage.locator('#bar.visible').count(), 0);

    const publicMobile = await navigateur.newPage({ viewport: { width: 390, height: 844 } });
    await publicMobile.goto(`http://127.0.0.1:${adresse.port}/`);
    await publicMobile.getByRole('heading', { name: 'Accède au sphérier de compétences du coach' }).waitFor();
    assert.equal(await publicMobile.locator('#header-etat').isVisible(), false);
    assert.ok(await publicMobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    const resultatMobile = await navigateur.newPage({ viewport: { width: 390, height: 844 } });
    await resultatMobile.goto(`http://127.0.0.1:${adresse.port}/?c=00000000-0000-4000-8000-000000000002`);
    await resultatMobile.locator('#audit-cta').dispatchEvent('click');
    await resultatMobile.getByRole('heading', { name: 'Sélectionne tes principales zones de progression' }).waitFor();
    assert.ok(await resultatMobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    const mobile = await navigateur.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto(url);
    await mobile.locator('#detail:not([hidden])').waitFor();
    await mobile.getByRole('heading', { name: 'À quoi sert le sphérier ?' }).waitFor();
    assert.equal(await mobile.locator('.categorie-dimensions').count(), 3);
    assert.equal(await mobile.locator('.dimension').count(), 7);
    assert.equal(await mobile.locator('#ciel').isVisible(), false);
    if (process.env.SCREENSHOT_DIR) {
      await mobile.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'accueil-mobile.png') });
    }

    console.log('UI desktop, mobile et sauvegarde simulée : OK');
  } finally {
    await Promise.race([
      navigateur.close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    serveur.closeAllConnections();
    await new Promise((resolve) => serveur.close(resolve));
  }
}

principal()
  .then(() => process.exit(0))
  .catch((erreur) => {
    console.error(erreur);
    process.exit(1);
  });
