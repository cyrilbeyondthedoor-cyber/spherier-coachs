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
  const referentiel = await getReferentielV2({ force: true });
  const levels = Object.fromEntries(referentiel.competencies.map((competence) => [competence.id, 0]));
  const themes = Object.fromEntries(referentiel.themes.map((theme) => [theme.id, { status: 'open', unlock_hint: '' }]));

  const serveur = http.createServer((requete, reponse) => {
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

    await page.getByRole('heading', { name: 'Comment utiliser le sphérier ?' }).waitFor();
    await page.getByText('marque une pause toutes les 30 compétences.').waitFor();
    await page.getByRole('button', { name: 'Commencer mon audit initial' }).dispatchEvent('click');
    const compteurAudit = page.locator('.situer-compte');
    await compteurAudit.waitFor();
    assert.equal((await compteurAudit.textContent()).trim(), `1 / ${referentiel.competencies.length}`);
    await page.locator('#panneau-fermer').dispatchEvent('click');

    assert.equal(await page.locator('.ciel-categorie').count(), 3);
    assert.equal(await page.locator('.ciel-dimension').count(), 0);
    assert.equal(referentiel.bookingUrl, 'https://calendly.com/thomasgibot/55min');
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
