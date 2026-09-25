const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startFixture } = require('./progression-fixture');
async function main() {
 const fixture = await startFixture();
 const browser = await chromium.launch();
 const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
 const issues = [];
 try {
  await page.goto(fixture.url + '/?c=00000000-0000-4000-8000-000000000091');
  await page.locator('body[data-pret="oui"]').waitFor();
  await page.addScriptTag({ path: require.resolve(process.env.SPHERIER_AXE_PATH || 'axe-core/axe.min.js') });
  await page.evaluate(() => { const c = etat.referentiel.competencies[0]; definirNiveau(c.id, 2); basculerMaintenant(c.id); });
  for (const theme of ['light', 'dark']) {
   await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
   for (const screen of ['home', 'dashboard', 'synthesis', 'evaluation']) {
    await page.evaluate(screen => {
     if (screen === 'home') { fermerPanneau(); allerAuCiel(); }
     if (screen === 'dashboard') afficherDashboard();
     if (screen === 'synthesis') ouvrirSynthese(false);
     if (screen === 'evaluation') evaluerTheme(etat.referentiel.dimensions[0].id, etat.referentiel.themes[0].id);
    }, screen);
    await page.waitForTimeout(350);
    const violations = await page.evaluate(async screen => (await axe.run(screen === 'home' ? document : document.querySelector('#panneau'), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, failure: n.failureSummary })) })), screen);
    if (violations.length) issues.push({ theme, screen, violations });
   }
  }
  console.log(JSON.stringify(issues, null, 2));
  assert.equal(issues.length, 0, 'Contrôles axe sur les parcours principaux');
  console.log('Accessibilité automatisée des parcours principaux, thèmes clair et sombre : OK');
 } finally { await browser.close(); await new Promise(r => fixture.server.close(r)); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
