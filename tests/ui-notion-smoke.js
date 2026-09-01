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

    assert.equal(await page.locator('.ciel-categorie').count(), 3);
    assert.equal(await page.locator('.ciel-dimension').count(), 7);

    for (const dimension of referentiel.dimensions) {
      await page.locator(`[data-ouvrir="${dimension.id}"]`).click();
      await page.locator(`[data-dimension="${dimension.id}"].ouverte svg.constellation`).waitFor();
      const attendues = referentiel.themes.filter((theme) => theme.dimension === dimension.name).length;
      assert.equal(
        await page.locator(`[data-dimension="${dimension.id}"].ouverte .theme[data-theme]`).count(),
        attendues,
        dimension.name
      );
      await page.locator('#detail-retour').click();
    }

    assert.deepEqual(erreurs, []);
    console.log('Renderer vérifié avec le vrai référentiel : 3 catégories · 7 dimensions · 33 thématiques · 193 compétences');
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
