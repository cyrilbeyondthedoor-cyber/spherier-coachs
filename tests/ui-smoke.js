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
  BOOKING_URL,
  LEXIQUE,
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
  bookingUrl: BOOKING_URL,
  lexique: LEXIQUE,
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

async function capturer(page, dossier, nom, options = {}) {
  if (!dossier) return;
  await page.addStyleTag({ content: '#bar:not(.visible) { display: none !important; }' });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(dossier, nom), ...options });
}

async function principal() {
  await new Promise((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  const adresse = serveur.address();
  const url = `http://127.0.0.1:${adresse.port}/?c=00000000-0000-4000-8000-000000000001`;
  const navigateur = await chromium.launch({ headless: true });

  try {
    const screenshotDir = process.env.SCREENSHOT_DIR || null;
    if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
    const page = await navigateur.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(url);
    await page.locator('#ciel:not([hidden])').waitFor();

    await page.getByRole('heading', { name: 'Le sphérier de compétences de coach' }).waitFor();
    const comprendre = page.getByRole('button', { name: 'Comprendre comment fonctionne le sphérier' });
    await comprendre.waitFor();
    assert.equal(await page.locator('#presentation-details').isVisible(), false);
    await comprendre.click();
    await page.getByRole('heading', { name: 'À quoi sert le sphérier ?' }).waitFor();
    await page.getByRole('heading', { name: 'Comment utiliser le sphérier ?' }).waitFor();
    await page.getByRole('button', { name: 'Consulter le lexique' }).click();
    await page.getByRole('heading', { name: "Lexique de l'approche des Sommets" }).waitFor();
    await page.getByText('Niveau Professionnel établi', { exact: true }).waitFor();
    assert.equal(await page.getByText('Niveau TTC', { exact: true }).count(), 0);
    await page.locator('#panneau-fermer').click();
    await page.getByRole('button', { name: 'Refermer le mode d’emploi' }).click();
    await page.getByText('marque une pause toutes les 30 compétences.').waitFor();
    await page.getByRole('button', { name: 'Réserver un échange', exact: true }).waitFor();
    assert.equal(await page.locator('.niveau-accueil').count(), 3);
    assert.equal(await page.getByText('Finis ton audit pour afficher ton score', { exact: true }).count(), 3);
    assert.equal(await page.locator('#bar.visible').count(), 0);
    await capturer(page, screenshotDir, 'accueil-desktop.png', { fullPage: true });
    await page.getByRole('button', { name: 'Commencer mon audit initial' }).dispatchEvent('click');
    const compteurAudit = page.locator('.situer-compte');
    await compteurAudit.waitFor();
    assert.equal((await compteurAudit.textContent()).trim(), `1 / ${competencies.length}`);
    assert.match(await page.locator('.situer-difficulte').textContent(), /Niveau de la compétence :\s*Socle fondamental/);
    await page.getByText('Je ne maîtrise pas du tout', { exact: true }).waitFor();
    await page.getByText("Je dois m'améliorer", { exact: true }).waitFor();
    await page.getByText('Je maîtrise', { exact: true }).waitFor();
    assert.equal(await page.locator('.situer-layout .audit-mini-sphere').count(), 3);
    await capturer(page, screenshotDir, 'audit-mini-carte-desktop.png');
    await page.getByRole('button', { name: 'Agrandir la carte' }).click();
    assert.equal(await page.locator('#audit-carte-overlay').isVisible(), true);
    await page.getByRole('button', { name: 'Revenir à la question' }).click();
    await page.locator('#panneau-fermer').dispatchEvent('click');

    assert.equal(await page.locator('.ciel-categorie').count(), 3);
    assert.deepEqual(await page.locator('.ciel-categorie-titre').allTextContents(), [
      'Moi en tant que coach',
      'Moi et mes clients',
      'Moi et mon activité',
    ]);
    assert.equal(await page.locator('.ciel-dimension').count(), 7);
    const territoires = await page.locator('.ciel-categorie').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        overflowX: element.scrollWidth - element.clientWidth,
        overflowY: element.scrollHeight - element.clientHeight,
      };
    }));
    assert.ok(territoires.every((territoire) => territoire.height >= 380));
    assert.ok(territoires.every((territoire) => territoire.overflowX === 0 && territoire.overflowY === 0));
    assert.equal(await page.locator('.ciel-dimension-astre').count(), 7);
    assert.equal(await page.locator('.ciel-guide').count(), 0);
    await page.locator('[data-ouvrir="FON"]').dispatchEvent('click');
    await page.locator('body[data-vue="categorie"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.dimension.ouverte').count(), 2);
    assert.equal(await page.locator('.constellation').count(), 2);
    await page.locator('#detail-retour').dispatchEvent('click');
    await page.locator('#ciel:not([hidden])').waitFor();
    await page.locator('[data-categorie="COACH"]').dispatchEvent('click');
    await page.getByRole('heading', { name: 'Moi en tant que coach' }).waitFor();
    assert.equal(await page.locator('.dimension').count(), 2);
    assert.equal(await page.locator('.dimension.ouverte').count(), 2);
    assert.equal(await page.locator('.constellation').count(), 2);
    const espacementsProgression = await page.locator('.theme-nom').evaluateAll((noms) => noms.map((nom) => {
      const progression = nom.parentElement.querySelector('.theme-progression');
      return progression.getBoundingClientRect().top - nom.getBoundingClientRect().bottom;
    }));
    assert.ok(espacementsProgression.every((espace) => espace >= 4));
    await capturer(page, screenshotDir, 'zoom-categorie-desktop.png', { fullPage: true });
    await page.locator('[data-tab-categorie="CLIENTS"]').dispatchEvent('click');
    assert.equal(await page.locator('.dimension').count(), 3);
    await page.locator('[data-tab-categorie="COACH"]').dispatchEvent('click');
    await page.locator('[data-toggle="FON"]').dispatchEvent('click');
    await page.locator('[data-dimension="FON"].ouverte').waitFor();
    assert.equal(await page.locator('#presentation').isVisible(), false);
    assert.equal(await page.getByText('Thématique à débloquer').count(), 0);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const scrollAvantTheme = await page.evaluate(() => window.scrollY);
    await page.locator('[data-dimension="FON"] .theme[data-theme]').first().dispatchEvent('click');
    await page.locator('body[data-panneau^="theme:"]').waitFor({ state: 'attached' });
    await page.waitForTimeout(50);
    const scrollApresTheme = await page.evaluate(() => window.scrollY);
    assert.ok(Math.abs(scrollAvantTheme - scrollApresTheme) <= 1);
    await page.locator('#panneau-fermer').dispatchEvent('click');
    assert.equal(await page.locator('.etoile[data-competence="FON-01-01"] title').textContent(), 'Je sais mobiliser la compétence FON.');
    await page.locator('.etoile[data-competence="FON-01-01"]').dispatchEvent('pointerenter', { pointerType: 'mouse', clientX: 300, clientY: 300 });
    await page.locator('#etoile-tooltip:not([hidden])').waitFor();
    assert.equal(await page.locator('#etoile-tooltip').textContent(), 'Je sais mobiliser la compétence FON.');
    await page.locator('.etoile[data-competence="FON-01-01"]').dispatchEvent('pointerleave');
    await page.locator('.etoile[data-competence="FON-01-01"]').dispatchEvent('click');
    await page.getByText('Un exemple observable pour FON.').waitFor();
    assert.equal(await page.locator('.marche[data-niveau]').count(), 3);

    await page.locator('.marche[data-niveau="3"]').dispatchEvent('click');
    await page.locator('#panneau-fermer').dispatchEvent('click');
    await page.locator('#btn-enregistrer').dispatchEvent('click');
    await page.getByText('Ton sphérier est enregistré.').waitFor();
    assert.equal(dernierSnapshot.levels['FON-01-01'], 3);

    await page.locator('#btn-synthese').dispatchEvent('click');
    assert.equal(await page.locator('.syn-categorie-item').count(), 3);
    assert.deepEqual(await page.locator('.syn-categorie-nom').allTextContents(), [
      'Moi en tant que coach',
      'Moi et mes clients',
      'Moi et mon activité',
    ]);
    assert.equal(await page.locator('.syn-maitrise-item').count(), 3);
    await page.locator('.syn-maitrise-nom', { hasText: 'Socle fondamental' }).waitFor();
    await page.locator('.syn-maitrise-nom', { hasText: 'Professionnel établi' }).waitFor();
    assert.equal(await page.locator('[data-filtre="ouvertes"]').count(), 0);
    assert.equal(await page.locator('[data-filtre^="diff:"]').count(), 0);
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
    await resultatPage.getByRole('heading', { name: 'Ton sphérier en un regard' }).waitFor();
    assert.equal(await resultatPage.locator('.carte-resultat .ciel-categorie').count(), 3);
    assert.equal(await resultatPage.locator('.carte-resultat .niveau-accueil').count(), 3);
    await capturer(resultatPage, screenshotDir, 'resultat-avant-priorites-desktop.png');
    await resultatPage.getByRole('button', { name: 'Choisir mes trois priorités' }).click();
    await resultatPage.getByRole('heading', { name: 'Sélectionne tes principales zones de progression' }).waitFor();
    assert.equal(await resultatPage.locator('.audit-zone').count(), 5);
    const options = resultatPage.locator('.audit-competence');
    await options.nth(0).dispatchEvent('click');
    await options.nth(1).dispatchEvent('click');
    await options.nth(2).dispatchEvent('click');
    await resultatPage.locator('#audit-suite').dispatchEvent('click');
    await resultatPage.getByRole('heading', { name: 'Ton sphérier en un regard' }).waitFor();
    assert.equal(await resultatPage.locator('.priorite-marque').count() > 0, true);
    await resultatPage.getByRole('button', { name: 'Ouvrir la vue d’ensemble linéaire' }).click();
    assert.equal(await resultatPage.locator('.syn-categorie-item').count(), 3);
    assert.equal(await resultatPage.locator('.syn-maitrise-item').count(), 3);
    assert.equal(await resultatPage.locator('.syn-dim').count(), 7);
    assert.equal(await resultatPage.locator('.syn-theme').count(), 7);
    assert.equal(await resultatPage.locator('.audit-priorite').count(), 3);
    assert.equal(await resultatPage.locator('[data-audit-rdv]').count(), 2);
    assert.equal(await resultatPage.locator('#panneau.plein-ecran').count(), 1);
    await resultatPage.locator('#panneau-plein-ecran').dispatchEvent('click');
    assert.equal(await resultatPage.locator('#panneau.plein-ecran').count(), 0);
    await resultatPage.locator('#panneau-plein-ecran').dispatchEvent('click');
    assert.equal(await resultatPage.locator('#panneau.plein-ecran').count(), 1);
    assert.equal(await resultatPage.locator('#bar.visible').count(), 0);

    await resultatPage.locator('[data-scope-categorie="CLIENTS"]').dispatchEvent('click');
    await resultatPage.locator('#panneau-titre', { hasText: 'Moi et mes clients' }).waitFor();
    assert.equal(await resultatPage.locator('.syn-comp').count(), 2);
    assert.equal(await resultatPage.locator('.syn-comp-niveau', { hasText: 'Je maîtrise' }).count(), 0);
    await resultatPage.locator('#syn-voir-maitrisees').dispatchEvent('click');
    assert.equal(await resultatPage.locator('.syn-comp').count(), 3);
    await resultatPage.locator('#syn-retour').dispatchEvent('click');
    await resultatPage.locator('[data-scope-difficulte="Professionnel établi"]').dispatchEvent('click');
    await resultatPage.locator('#panneau-titre', { hasText: 'Professionnel établi' }).waitFor();
    assert.ok(await resultatPage.locator('.syn-comp').count() > 0);

    const publicMobile = await navigateur.newPage({ viewport: { width: 390, height: 844 } });
    await publicMobile.goto(`http://127.0.0.1:${adresse.port}/`);
    await publicMobile.getByRole('heading', { name: 'Accède au sphérier de compétences du coach' }).waitFor();
    assert.equal(await publicMobile.locator('#header-etat').isVisible(), false);
    assert.ok(await publicMobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    const resultatMobile = await navigateur.newPage({ viewport: { width: 390, height: 844 } });
    await resultatMobile.goto(`http://127.0.0.1:${adresse.port}/?c=00000000-0000-4000-8000-000000000002`);
    await resultatMobile.locator('#audit-cta').dispatchEvent('click');
    await resultatMobile.getByRole('heading', { name: 'Ton sphérier en un regard' }).waitFor();
    await resultatMobile.getByRole('button', { name: 'Choisir mes trois priorités' }).waitFor();
    assert.ok(await resultatMobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    const mobile = await navigateur.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto(url);
    await mobile.locator('#ciel:not([hidden])').waitFor();
    await mobile.getByRole('button', { name: 'Comprendre comment fonctionne le sphérier' }).waitFor();
    assert.equal(await mobile.getByRole('heading', { name: 'À quoi sert le sphérier ?' }).isVisible(), false);
    assert.equal(await mobile.locator('.ciel-categorie').count(), 3);
    assert.equal(await mobile.locator('#bar.visible').count(), 0);
    await capturer(mobile, screenshotDir, 'accueil-mobile.png', { fullPage: true });
    await mobile.locator('[data-categorie="COACH"]').dispatchEvent('click');
    assert.equal(await mobile.locator('.dimension').count(), 2);
    assert.equal(await mobile.locator('.amas-mobile-piste').count(), 2);
    await mobile.locator('[data-toggle="FON"]').dispatchEvent('click');
    await mobile.locator('[data-dimension="FON"].ouverte .amas-mobile-piste').waitFor();
    assert.equal(await mobile.locator('[data-dimension="FON"].ouverte .amas-mobile').count(), 1);
    assert.equal(await mobile.locator('#ciel').isVisible(), false);
    await capturer(mobile, screenshotDir, 'detail-mobile.png');

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
