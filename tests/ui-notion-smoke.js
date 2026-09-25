const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { getReferentielV2 } = require('../referentiel-v2.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'spherier-v2.html'));

function json(reponse, valeur) {
  reponse.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  reponse.end(JSON.stringify(valeur));
}

async function principal() {
  const referentiel = process.env.SPHERIER_REFERENTIEL_JSON ? JSON.parse(fs.readFileSync(process.env.SPHERIER_REFERENTIEL_JSON, 'utf8')) : await getReferentielV2({ force: true });
  const levels = Object.fromEntries(referentiel.competencies.map((competence) => [competence.id, 0]));
  const themes = Object.fromEntries(referentiel.themes.map((theme) => [theme.id, { status: 'open', unlock_hint: '' }]));

  const serveur = http.createServer((requete, reponse) => {
    const asset = requete.url.split('?')[0];
    if (/^\/spherier-(core|persistence|dashboard|navigation|progress)\.(js|css)$/.test(asset)) {
      reponse.writeHead(200, { 'Content-Type': asset.endsWith('.css') ? 'text/css' : 'text/javascript' });
      return reponse.end(fs.readFileSync(path.join(__dirname, '..', 'public', asset)));
    }
    if (requete.url.startsWith('/api/history')) return json(reponse, { items: [], nextCursor: null });

    if (requete.url.startsWith('/api/referential')) return json(reponse, referentiel);
    if (requete.url.startsWith('/api/state')) {
      return json(reponse, { snapshot: null, computed: { levels, themes }, notes: {} });
    }
    reponse.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    reponse.end(html);
  });

  await new Promise((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  const adresse = serveur.address();
  const url = `http://127.0.0.1:${adresse.port}/?c=00000000-0000-4000-8000-000000000001`;
  const navigateur = await chromium.launch({ headless: true });

  try {
    const page = await navigateur.newPage({ viewport: { width: 1280, height: 900 } });
    const erreurs = [];
    page.on('pageerror', (erreur) => erreurs.push(erreur.message));
    await page.goto(url);
    await page.locator('#ciel:not([hidden])').waitFor();

    await page.locator('#comprendre-spherier').click();
    await page.getByRole('heading', { name: 'Comment utiliser le sphérier ?' }).waitFor();
    await page.getByText('Tu choisis par où commencer, thématique par thématique.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Commencer mon audit' }).dispatchEvent('click');
    await page.locator('body[data-panneau="choix-dimension"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.choix-carte').count(), referentiel.dimensions.length);

    // Première dimension du référentiel réel : on descend jusqu'au compteur de section.
    const premiere = referentiel.dimensions[0];
    const themesPremiere = referentiel.themes
      .filter((theme) => theme.dimension === premiere.name)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    await page.locator(`[data-choix-dimension="${premiere.id}"]`).dispatchEvent('click');
    assert.equal(await page.locator('.choix-theme').count(), themesPremiere.length);
    await page.locator(`[data-evaluer-theme="${themesPremiere[0].id}"]`).dispatchEvent('click');
    const compteurAudit = page.locator('.situer-compte');
    await compteurAudit.waitFor();
    const dansLaThematique = referentiel.competencies.filter((competence) => competence.theme === themesPremiere[0].id).length;
    assert.equal((await compteurAudit.textContent()).trim(), `1 / ${dansLaThematique}`);
    assert.match(await page.locator('.audit-sous-compteur').textContent(),
      new RegExp(`Thématique 1 / ${themesPremiere.length} de `));
    await page.locator('#panneau-fermer').dispatchEvent('click');

    assert.equal(await page.locator('.ciel-categorie').count(), 3);
    assert.equal(await page.locator('.ciel-dimension').count(), 7);
    assert.equal(referentiel.bookingUrl, 'https://calendly.com/thomasgibot/55min');
    assert.ok((await page.locator('.ciel-dimension-compte').allTextContents()).every((texte) => texte.includes('Pas encore évalué')));
    const cercles = await page.locator('.ciel-categorie').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        overflowX: element.scrollWidth - element.clientWidth,
        overflowY: element.scrollHeight - element.clientHeight,
      };
    }));
    assert.ok(cercles.every((cercle) => cercle.width > 250 && cercle.height >= 400), 'les trois territoires gardent une zone de lecture suffisante');
    assert.ok(cercles.every((cercle) => cercle.overflowX === 0 && cercle.overflowY === 0));
    assert.equal(await page.locator('.ciel-guide').count(), 0);

    for (const categorie of referentiel.categories) {
      await page.locator(`[data-categorie="${categorie.id}"]`).dispatchEvent('click');
      const dimensions = referentiel.dimensions.filter((dimension) => dimension.category === categorie.id);
      assert.equal(await page.locator('.dimension').count(), dimensions.length);
      for (const dimension of dimensions) {
        await page.locator(`[data-toggle="${dimension.id}"]`).dispatchEvent('click');
        await page.locator(`[data-dimension="${dimension.id}"].ouverte svg.constellation`).waitFor();
        const attendues = referentiel.themes.filter((theme) => theme.dimension === dimension.name).length;
        assert.equal(
          await page.locator(`[data-dimension="${dimension.id}"].ouverte .theme[data-theme]`).count(),
          attendues,
          dimension.name
        );
        await page.locator('#detail-retour').dispatchEvent('click');
      }
      await page.locator('#detail-retour').dispatchEvent('click');
    }

    assert.deepEqual(erreurs, []);
    console.log(`Renderer vérifié avec le vrai référentiel : 3 catégories · 7 dimensions · 33 thématiques · ${referentiel.competencies.length} compétences actives`);
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
