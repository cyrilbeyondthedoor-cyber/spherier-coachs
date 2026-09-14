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

// La première dimension porte DEUX thématiques : c'est le minimum pour éprouver
// l'audit modulaire — le sous-compteur « Thématique 1 / 2 », l'enchaînement d'une
// thématique à la suivante, et le résultat de dimension qui n'arrive qu'une fois les
// deux complètes.
const DIM_MULTI = DIMENSIONS[0];
themes.push({
  id: `theme-${DIM_MULTI.id}-2`,
  code: `${DIM_MULTI.id}-02`,
  name: `Seconde thématique ${DIM_MULTI.id}`,
  dimension: DIM_MULTI.name,
  definition: `Seconde définition ${DIM_MULTI.id}`,
  feeds: [],
  x: 420,
  y: 260,
  order: 2,
});

function competence(codeTheme, code, index) {
  return {
    id: code,
    theme: codeTheme,
    name: `Je sais mobiliser la compétence ${code}.`,
    definition: `Je sais mobiliser la compétence ${code}.`,
    statement: `Je sais mobiliser la compétence ${code}.`,
    markers: `Un exemple observable pour ${code}.`,
    difficulty: DIFFICULTES[index % DIFFICULTES.length].nom,
    order: index + 1,
    resources: [],
  };
}

const competencies = DIMENSIONS.map((dimension, index) =>
  competence(`theme-${dimension.id}`, `${dimension.id}-01-01`, index));

// Quatre compétences dans la première thématique : de quoi passer, évaluer, et lire
// un pourcentage qui ne soit pas un simple 0 ou 100.
competencies.push(
  competence(`theme-${DIM_MULTI.id}`, `${DIM_MULTI.id}-01-02`, 1),
  competence(`theme-${DIM_MULTI.id}`, `${DIM_MULTI.id}-01-03`, 2),
  competence(`theme-${DIM_MULTI.id}`, `${DIM_MULTI.id}-01-04`, 3),
  competence(`theme-${DIM_MULTI.id}-2`, `${DIM_MULTI.id}-02-01`, 0),
  competence(`theme-${DIM_MULTI.id}-2`, `${DIM_MULTI.id}-02-02`, 1),
);

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
    // Le membre 0003 relit ce qui a été enregistré : c'est le seul moyen d'éprouver le
    // contexte de reprise après un rechargement complet de la page.
    const relecture = requete.url.includes('00000000-0000-4000-8000-000000000003') && dernierSnapshot;
    if (relecture) {
      const audit = {
        passees: dernierSnapshot.audit?.passees ?? [],
        derniere: dernierSnapshot.audit?.derniere ?? null,
        maj: new Date().toISOString(),
      };
      return json(reponse, {
        snapshot: { id: 'snapshot-relu', created_at: new Date().toISOString(), label: null,
          blob: { levels: dernierSnapshot.levels, selections: dernierSnapshot.selections, audit } },
        audit,
        computed: { levels: { ...niveauxVides, ...dernierSnapshot.levels }, themes: etatThemes },
        notes: {},
      });
    }
    const levels = auditComplet
      ? Object.fromEntries(competencies.map((competence, index) => [competence.id, (index % 3) + 1]))
      : niveauxVides;
    return json(reponse, {
      snapshot: null,
      audit: { passees: [], derniere: null, maj: null },
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
      const audit = {
        passees: dernierSnapshot.audit?.passees ?? [],
        derniere: dernierSnapshot.audit?.derniere ?? null,
        maj: new Date().toISOString(),
      };
      json(reponse, {
        snapshot: {
          id: 'snapshot-test',
          created_at: new Date().toISOString(),
          label: null,
          blob: {
            levels: dernierSnapshot.levels,
            selections: dernierSnapshot.selections,
            audit,
          },
        },
        audit,
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
    // 1280x700 : le format de recette. L'écran de résultat doit y montrer son choix
    // principal sans défilement, c'est ce que vérifie le parcours d'audit plus bas.
    const page = await navigateur.newPage({ viewport: { width: 1280, height: 700 } });
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
    await page.getByText('Tu choisis par où commencer, thématique par thématique.', { exact: false }).waitFor();
    assert.equal(await page.getByText('marque une pause toutes les 30 compétences.').count(), 0);
    await page.getByRole('button', { name: 'Réserver un échange', exact: true }).waitFor();
    assert.equal(await page.locator('#audit-synthese').isVisible(), false, 'pas de synthèse tant qu\'aucune thématique n\'est complète');
    assert.equal(await page.locator('.niveau-accueil').count(), 3);
    assert.equal(await page.getByText('Finis ton audit pour afficher ton score', { exact: true }).count(), 3);
    assert.equal(await page.locator('#bar.visible').count(), 0);
    await capturer(page, screenshotDir, 'accueil-desktop.png', { fullPage: true });

    // --- Parcours modulaire : dimension → thématique → évaluation → résultat -----
    await page.getByRole('button', { name: 'Commencer mon audit' }).dispatchEvent('click');
    await page.locator('body[data-panneau="choix-dimension"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.choix-groupe').count(), 3);
    assert.equal(await page.locator('.choix-carte').count(), DIMENSIONS.length);
    await capturer(page, screenshotDir, 'choix-dimension-desktop.png');
    await page.locator(`[data-choix-dimension="${DIM_MULTI.id}"]`).dispatchEvent('click');
    await page.locator('body[data-panneau="choix-theme"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.choix-theme').count(), 2);
    await page.getByRole('button', { name: 'Évaluer toute la dimension' }).waitFor();
    await capturer(page, screenshotDir, 'choix-theme-desktop.png');
    await page.locator(`[data-evaluer-theme="theme-${DIM_MULTI.id}"]`).dispatchEvent('click');

    const compteurAudit = page.locator('.situer-compte');
    await compteurAudit.waitFor();
    assert.equal((await compteurAudit.textContent()).trim(), '1 / 4', 'compteur de section, pas de référentiel entier');
    assert.equal((await page.locator('.audit-sous-compteur').textContent()).trim(),
      `Thématique 1 / 2 de ${DIM_MULTI.name}`);
    assert.match(await page.locator('.situer-difficulte').textContent(), /Niveau de la compétence :\s*Socle fondamental/);
    await page.getByText('Je ne maîtrise pas du tout', { exact: true }).waitFor();
    await page.getByText("Je dois m'améliorer", { exact: true }).waitFor();
    await page.getByText('Je maîtrise', { exact: true }).waitFor();
    assert.equal(await page.locator('.situer-layout .audit-mini-sphere').count(), 3);
    await capturer(page, screenshotDir, 'audit-mini-carte-desktop.png');
    await page.getByRole('button', { name: 'Agrandir la carte' }).click();
    assert.equal(await page.locator('#audit-carte-overlay').isVisible(), true);
    await page.getByRole('button', { name: 'Revenir à la question' }).click();

    // Trois évaluations et une compétence passée : 3 + 2 + 1 sur 12 possibles = 50 %.
    // Le retour visuel est lu dans le même tour de boucle que le clic : il ne dure que
    // 250 ms, un `waitFor` arriverait après le passage à la compétence suivante.
    const retourVisuel = await page.evaluate(() => {
      const marche = document.querySelector('.marche[data-niveau="3"]');
      marche.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return {
        confirmee: marche.classList.contains('marche-confirmee'),
        astuce: document.getElementById('situer-astuce').textContent.trim(),
      };
    });
    assert.equal(retourVisuel.confirmee, true, 'la marche cochée se colore avant le passage');
    assert.equal(retourVisuel.astuce, 'Enregistré, compétence suivante.');
    await page.locator('.situer-compte', { hasText: '2 / 4' }).waitFor();
    await page.locator('.marche[data-niveau="2"]').dispatchEvent('click');
    await page.locator('.situer-compte', { hasText: '3 / 4' }).waitFor();
    await page.locator('.marche[data-niveau="1"]').dispatchEvent('click');
    await page.locator('.situer-compte', { hasText: '4 / 4' }).waitFor();
    await page.getByRole('button', { name: 'Passer →' }).dispatchEvent('click');

    await page.locator('body[data-panneau="resultat-theme"]').waitFor({ state: 'attached' });
    await page.getByRole('heading', { name: 'Résultat de la thématique' }).waitFor();
    assert.equal((await page.locator('.audit-bilan-score .syn-pct').textContent()).trim(), '50 %');
    assert.deepEqual(dernierSnapshot.audit.passees, [`${DIM_MULTI.id}-01-04`],
      'la compétence passée part bien dans le payload');
    assert.equal(dernierSnapshot.audit.derniere.themeId, `theme-${DIM_MULTI.id}`);
    assert.equal(await page.getByRole('button', { name: 'Évaluer maintenant' }).count(), 1);
    await capturer(page, screenshotDir, 'resultat-theme-desktop.png');

    // Le bouton principal de « Poursuivre » doit être atteignable sans défiler.
    const hauteurPanneau = await page.locator('#panneau-corps').evaluate((element) => ({
      visible: element.clientHeight,
      total: element.scrollHeight,
      principal: element.querySelector('.audit-suite-choix.principal').getBoundingClientRect().bottom
        - element.getBoundingClientRect().top,
    }));
    assert.ok(hauteurPanneau.principal <= hauteurPanneau.visible,
      `le choix principal doit tenir sans scroll (${Math.round(hauteurPanneau.principal)} > ${hauteurPanneau.visible})`);

    // Poursuivre vers la thématique suivante de la dimension.
    await page.locator('[data-suite="continuer"]').dispatchEvent('click');
    await page.locator('.audit-sous-compteur', { hasText: `Thématique 2 / 2 de ${DIM_MULTI.name}` }).waitFor();
    assert.equal((await page.locator('.situer-compte').textContent()).trim(), '1 / 2');

    // Fermeture par la croix, puis reprise : on revient sur la bonne compétence.
    await page.locator('#panneau-fermer').dispatchEvent('click');
    await page.locator('#audit-reprise:not([hidden])').waitFor();
    assert.match(await page.locator('#audit-reprise').textContent(), /dernière thématique : Seconde thématique/);
    assert.equal(await page.locator('#audit-synthese').isVisible(), true,
      'la synthèse s\'ouvre dès une thématique complète');
    await page.getByRole('button', { name: 'Reprendre mon audit' }).dispatchEvent('click');
    await page.locator('body[data-panneau="situer"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.situer-nom').textContent(), `Je sais mobiliser la compétence ${DIM_MULTI.id}-02-01.`);
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
    assert.equal(await page.locator('.etoile[data-competence="FON-01-01"] title').textContent(), 'Je sais mobiliser la compétence FON-01-01.');
    await page.locator('.etoile[data-competence="FON-01-01"]').dispatchEvent('pointerenter', { pointerType: 'mouse', clientX: 300, clientY: 300 });
    await page.locator('#etoile-tooltip:not([hidden])').waitFor();
    assert.equal(await page.locator('#etoile-tooltip').textContent(), 'Je sais mobiliser la compétence FON-01-01.');
    await page.locator('.etoile[data-competence="FON-01-01"]').dispatchEvent('pointerleave');
    // Compétence restée intacte pendant l'audit : la cocher depuis la carte doit
    // encore fonctionner, c'est l'usage « exploration libre » du même panneau.
    await page.locator('.etoile[data-competence="FON-02-02"]').dispatchEvent('click');
    await page.getByText('Un exemple observable pour FON-02-02.').waitFor();
    assert.equal(await page.locator('.marche[data-niveau]').count(), 3);

    await page.locator('.marche[data-niveau="3"]').dispatchEvent('click');
    await page.locator('#panneau-fermer').dispatchEvent('click');
    await page.locator('#btn-enregistrer').dispatchEvent('click');
    await page.getByText('Ton sphérier est enregistré.').waitFor();
    assert.equal(dernierSnapshot.levels['FON-02-02'], 3);
    // Les compétences passées survivent à un enregistrement déclenché ailleurs.
    assert.deepEqual(dernierSnapshot.audit.passees, [`${DIM_MULTI.id}-01-04`]);

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
    assert.ok(await page.locator('.syn-compte', { hasText: '3/4 évaluées' }).count() >= 1);
    assert.equal(await page.locator('.syn-theme').count(), 8);

    // Synthèse accessible avec une seule thématique complète : plus besoin d'avoir
    // évalué les 192 compétences pour lire ce qui est déjà là.
    await page.locator('#panneau-fermer').dispatchEvent('click');
    await page.locator('#detail-retour').dispatchEvent('click');
    await page.locator('#detail-retour').dispatchEvent('click');
    await page.locator('#audit-synthese:not([hidden])').waitFor();
    await page.locator('#audit-synthese').dispatchEvent('click');
    await page.getByRole('heading', { name: 'Ton sphérier en un regard' }).waitFor();
    await page.getByText('sur 8 évaluée', { exact: false }).waitFor();
    await capturer(page, screenshotDir, 'synthese-partielle-desktop.png');
    await page.locator('#panneau-fermer').dispatchEvent('click');

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
    assert.equal(await resultatPage.locator('.syn-theme').count(), 8);
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
    assert.equal(await mobile.locator('[data-dimension="FON"].ouverte .amas-mobile').count(), 2);
    assert.equal(await mobile.locator('#ciel').isVisible(), false);
    await capturer(mobile, screenshotDir, 'detail-mobile.png');

    // --- Le parcours d'audit sur un téléphone --------------------------------
    await mobile.locator('#detail-retour').dispatchEvent('click');
    await mobile.locator('#detail-retour').dispatchEvent('click');
    await mobile.locator('#audit-cta').dispatchEvent('click');
    await mobile.locator('body[data-panneau="choix-dimension"]').waitFor({ state: 'attached' });
    assert.equal(await mobile.locator('.choix-carte').count(), DIMENSIONS.length);
    await capturer(mobile, screenshotDir, 'choix-dimension-mobile.png');
    await mobile.locator(`[data-choix-dimension="${DIM_MULTI.id}"]`).dispatchEvent('click');
    await mobile.locator('body[data-panneau="choix-theme"]').waitFor({ state: 'attached' });
    await capturer(mobile, screenshotDir, 'choix-theme-mobile.png');
    await mobile.locator(`[data-evaluer-theme="theme-${DIM_MULTI.id}"]`).dispatchEvent('click');
    await mobile.locator('.situer-compte', { hasText: '1 / 4' }).waitFor();
    await capturer(mobile, screenshotDir, 'evaluation-mobile.png');
    await mobile.locator('.marche[data-niveau="3"]').dispatchEvent('click');
    await mobile.locator('.situer-compte', { hasText: '2 / 4' }).waitFor();
    await mobile.locator('.marche[data-niveau="2"]').dispatchEvent('click');
    await mobile.locator('.situer-compte', { hasText: '3 / 4' }).waitFor();
    await mobile.locator('.marche[data-niveau="1"]').dispatchEvent('click');
    await mobile.locator('.situer-compte', { hasText: '4 / 4' }).waitFor();
    await mobile.getByRole('button', { name: 'Passer →' }).dispatchEvent('click');
    await mobile.locator('body[data-panneau="resultat-theme"]').waitFor({ state: 'attached' });
    await mobile.getByRole('heading', { name: 'Résultat de la thématique' }).waitFor();
    await capturer(mobile, screenshotDir, 'resultat-theme-mobile.png');
    // Les quatre suites restent atteignables, empilées, sans débordement latéral.
    assert.equal(await mobile.locator('.audit-suite-choix').count(), 4);
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.ok(await mobile.locator('#panneau-corps').evaluate((element) => element.scrollWidth <= element.clientWidth),
      'le corps du panneau ne défile pas horizontalement');
    await mobile.locator('[data-suite="dimension"]').dispatchEvent('click');
    await mobile.locator('body[data-panneau="choix-dimension"]').waitFor({ state: 'attached' });

    // Une thématique dont toutes les compétences sont passées part quand même vers le
    // serveur : sans cela, la reprise sur un autre appareil les redemanderait toutes.
    await mobile.locator(`[data-choix-dimension="${DIM_MULTI.id}"]`).dispatchEvent('click');
    await mobile.locator(`[data-evaluer-theme="theme-${DIM_MULTI.id}-2"]`).dispatchEvent('click');
    await mobile.getByRole('button', { name: 'Passer →' }).dispatchEvent('click');
    await mobile.locator('.situer-compte', { hasText: '2 / 2' }).waitFor();
    await mobile.getByRole('button', { name: 'Passer →' }).dispatchEvent('click');
    await mobile.getByRole('heading', { name: 'Résultat de la thématique' }).waitFor();
    assert.deepEqual(dernierSnapshot.audit.passees.slice().sort(),
      [`${DIM_MULTI.id}-01-04`, `${DIM_MULTI.id}-02-01`, `${DIM_MULTI.id}-02-02`].sort());

    // --- Reprise après un rechargement complet -------------------------------
    // Même parcours, nouvel onglet, aucun brouillon local : le contexte doit venir
    // du snapshot relu. C'est le cas qui ramenait les testeurs à la mauvaise question.
    const reprise = await navigateur.newPage({ viewport: { width: 1280, height: 700 } });
    await reprise.goto(`http://127.0.0.1:${adresse.port}/?c=00000000-0000-4000-8000-000000000003`);
    await reprise.locator('#ciel:not([hidden])').waitFor();
    await reprise.getByRole('button', { name: 'Reprendre mon audit' }).waitFor();
    assert.match(await reprise.locator('#audit-reprise').textContent(), /dernière thématique : Seconde thématique/);
    await reprise.getByRole('button', { name: 'Reprendre mon audit' }).dispatchEvent('click');
    // La dernière thématique n'a plus rien « à faire » : plutôt qu'un point de reprise
    // arbitraire, on repose la question du départ.
    await reprise.locator('body[data-panneau="choix-dimension"]').waitFor({ state: 'attached' });
    await reprise.locator(`[data-choix-dimension="${DIM_MULTI.id}"]`).dispatchEvent('click');
    await reprise.getByText('2 passées', { exact: false }).waitFor();
    // Entièrement passée : rouvrir la thématique démarre sur la première passée, pas
    // au début de la liste, et le rappel dit pourquoi.
    await reprise.locator(`[data-evaluer-theme="theme-${DIM_MULTI.id}-2"]`).dispatchEvent('click');
    await reprise.locator('.situer-nom').waitFor();
    assert.equal(await reprise.locator('.situer-nom').textContent(),
      `Je sais mobiliser la compétence ${DIM_MULTI.id}-02-01.`);
    await reprise.getByText('Tu avais passé cette compétence.', { exact: false }).waitFor();

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
