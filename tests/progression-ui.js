const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const { startFixture } = require('./progression-fixture');
const USER = '00000000-0000-4000-8000-000000000001';
const delay = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const fixture = await startFixture();
  const browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch().catch(async error => { await new Promise(r => fixture.server.close(r)); throw error; });
  const { competencies, themes, dimensions } = fixture.referential;
  const [a, b] = competencies.map(c => c.id);
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
  async function open(ctx = context, user = USER) {
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(`${fixture.url}/?c=${user}`); await page.locator('body[data-pret="oui"]').waitFor(); return page;
  }
  async function card(page, code = a) { await page.evaluate(code => allerVersCompetence(code), code); }
  try {
    const page = await open();
    // All screens use the same denominator, including skipped competencies.
    assert.equal(await page.evaluate(() => scoreCodes(etat.referentiel.competencies.map(c => c.id)).percent), null);
    await page.evaluate(a => { definirNiveau(a, 3); marquerPassee(etat.referentiel.competencies[1].id); }, a);
    assert.equal(await page.evaluate(() => scoreGlobalPartiel().pct), 100);
    assert.equal(await page.evaluate(t => etatTheme(themeParId(t)).score, themes[0].id), 100);
    assert.equal(await page.evaluate(() => mentionScoreCiel(etat.referentiel.competencies.map(c => c.id), etat.referentiel.themes).pct), 100);
    assert.equal(await page.evaluate(() => enregistrer()), true);
    // A navigation bookmark carries no levels. Another device remains authoritative.
    await page.evaluate(({ theme, dimension, code }) => noterDerniere({ themeId: theme, dimensionId: dimension }, code), { theme: themes[0].id, dimension: dimensions[0].id, code: b });
    const secondContext = await browser.newContext();
    const other = await open(secondContext);
    await other.evaluate(a => definirNiveau(a, 1), a); assert.equal(await other.evaluate(() => enregistrer()), true);
    await page.reload(); await page.locator('body[data-pret="oui"]').waitFor();
    assert.equal(await page.evaluate(a => brouillon.levels[a], a), 1);
    // Concurrent snapshots return 409 and preserve local input until explicit choice.
    await page.evaluate(a => definirNiveau(a, 2), a);
    await other.evaluate(a => definirNiveau(a, 3), a); assert.equal(await other.evaluate(() => enregistrer()), true);
    assert.equal(await page.evaluate(() => enregistrer()), false);
    assert.equal(await page.locator('#conflit-notice').count(), 1);
    assert.equal(fixture.latest(USER).blob.levels[a], 3);
    await page.locator('#conflit-notice button').click();
    await page.locator('#conflit-local').click();
    await page.waitForFunction(() => !estModifie());
    assert.equal(fixture.latest(USER).blob.levels[a], 2);
    // A first note request finishes while newer text is being typed.
    await card(page); await page.locator('#note-entete').click();
    fixture.control.noteDelay = 700;
    await page.locator('#note-champ').fill('Premier texte');
    await page.locator('#note-btn').click();
    await page.locator('#note-champ').fill('Premier texte et derniers mots');
    await page.waitForFunction(() => document.getElementById('note-etat').textContent === 'Enregistrée');
    assert.equal(fixture.notes.get(USER)[a].texte, 'Premier texte et derniers mots');
    assert.equal(fixture.notes.get(USER)[a].revision, 2);
    assert.equal(await page.evaluate(a => localStorage.getItem(cleNote(a)), a), null);
    fixture.control.noteDelay = 0;
    // Reloading an offline draft over a newer note cannot overwrite the remote text.
    fixture.control.offline = true;
    await page.locator('#note-champ').fill('Brouillon hors ligne'); await page.locator('#note-btn').click();
    await page.waitForFunction(() => document.getElementById('note-etat').textContent.includes('Non enregistrée'));
    fixture.notes.get(USER)[a] = { texte: 'Autre appareil', revision: 3, maj_le: new Date().toISOString() };
    fixture.control.offline = false;
    await page.reload(); await page.locator('body[data-pret="oui"]').waitFor(); await card(page);
    await page.locator('#note-conflit').waitFor();
    assert.equal(await page.locator('#note-champ').inputValue(), 'Brouillon hors ligne');
    await page.locator('[data-note-remote]').click();
    assert.equal(await page.locator('#note-champ').inputValue(), 'Autre appareil');
    // Dashboard: first priority, practice, two dated checkpoints, undo, explicit empty.
    await page.locator('#btn-maintenant').click();
    await page.evaluate(() => ouvrirMois());
    await page.locator('[data-pratique="action"]').fill('Pratiquer une pause avant ma question');
    await page.locator('[data-pratique="observation"]').fill('J’ai laissé plus de place au silence.');
    await page.locator('#pratique-enregistrer').click(); await page.waitForFunction(() => !estModifie());
    assert.equal(fixture.latest(USER).blob.practice[a].action, 'Pratiquer une pause avant ma question');
    await page.locator('#bilan-creer').click(); await page.locator('#bilan-lire').waitFor();
    await page.locator('#bilan-lire').click(); await page.locator('.bilan-detail').waitFor();
    assert.match(await page.locator('#bilans-comparaison').textContent(), /J’ai laissé plus de place au silence/);
    await page.evaluate(a => definirNiveau(a, 3), a);
    await page.locator('#bilan-creer').click();
    await page.waitForFunction(() => document.querySelectorAll('#bilan-avant option').length === 2);
    await page.locator('#bilans-comparer').click();
    assert.match(await page.locator('#bilans-comparaison').textContent(), /1 changements de niveau/);
    await page.evaluate(() => { ouvrirMois(); window.print = () => {}; imprimerPratique(); });
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('#fiche-impression').isVisible(), true);
    assert.equal(await page.locator('.dashboard').isVisible(), false);
    assert.match(await page.locator('#fiche-impression').textContent(), /J’ai laissé plus de place au silence/);
    await page.emulateMedia({ media: 'screen' });
    await page.locator('[data-retirer-pratique]').click();
    assert.equal(await page.locator('.travail-priorite').count(), 0);
    await page.locator('#retablir-priorite').click(); assert.equal(await page.locator('.travail-priorite').count(), 1);
    await page.locator('[data-retirer-pratique]').click(); await page.waitForFunction(() => !estModifie());
    assert.deepEqual(fixture.latest(USER).blob.selections.current, []);
    await page.reload(); await page.locator('body[data-pret="oui"]').waitFor(); await page.locator('#btn-mois').click();
    assert.equal(await page.locator('.travail-priorite').count(), 0);
    // Exact dimension-mode navigation survives a reload, including skipped items.
    await page.evaluate(d => evaluerDimensionEnchainee(d), dimensions[0].id);
    await page.evaluate(() => { situer.index = 0; rendreMeSituer(); });
    const resumeBefore = await page.evaluate(() => ({ code: situer.codes[situer.index], mode: brouillon.derniere.mode }));
    await page.reload(); await page.locator('body[data-pret="oui"]').waitFor(); await page.evaluate(() => reprendreAudit());
    assert.deepEqual(await page.evaluate(() => ({ code: situer.codes[situer.index], mode: brouillon.derniere.mode })), resumeBefore);
    // Mobile, zoom-equivalent viewport, both themes: answers remain visible with all markers expanded.
    for (const viewport of [{ width: 390, height: 844 }, { width: 640, height: 400 }, { width: 1280, height: 700 }]) {
      await page.setViewportSize(viewport);
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        await page.locator('.marqueurs-details').evaluate(el => el.open = true);
        const boxes = await page.locator('#situer-reponses .marche').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, width: r.width }; }));
        assert.equal(boxes.length, 3);
        assert.ok(boxes.every(r => r.top >= 0 && r.bottom <= viewport.height && r.width > 0), `${theme} ${JSON.stringify(viewport)} ${JSON.stringify(boxes)}`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    // Search and origin survive consultation.
    await page.evaluate(() => ouvrirSynthese(false));
    await page.locator('#syn-recherche').fill('Pratique'); await page.locator('#syn-tri').selectOption('priorites');
    await page.locator('.syn-comp').first().click(); await page.locator('#panneau-retour-audit').click();
    assert.equal(await page.locator('#syn-recherche').inputValue(), 'Pratique'); assert.equal(await page.locator('#syn-tri').inputValue(), 'priorites');
    await page.locator('#panneau-fermer').click(); await page.locator('#theme-toggle').click();
    const chosen = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.reload(); await page.locator('body[data-pret="oui"]').waitFor(); assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), chosen);
    // Two tabs in one browser keep separate drafts, even when one tab saves first.
    const tabUser = '00000000-0000-4000-8000-000000000077';
    const tab1 = await open(context, tabUser), tab2 = await open(context, tabUser);
    await tab1.evaluate(a => definirNiveau(a, 2), a);
    await tab2.evaluate(a => definirNiveau(a, 3), a);
    assert.equal(await tab1.evaluate(() => enregistrer()), true);
    await tab2.reload(); await tab2.locator('body[data-pret="oui"]').waitFor();
    await tab2.locator('#conflit-notice').waitFor();
    await tab2.locator('#conflit-notice button').click(); await tab2.locator('#conflit-local').click();
    await tab2.waitForFunction(() => !estModifie());
    assert.equal(fixture.latest(tabUser).blob.levels[a], 3);
    await tab1.reload(); await tab1.locator('body[data-pret="oui"]').waitFor();
    await card(tab1); await card(tab2);
    if (!(await tab1.locator('#note-champ').isVisible())) await tab1.locator('#note-entete').click();
    if (!(await tab2.locator('#note-champ').isVisible())) await tab2.locator('#note-entete').click();
    fixture.control.offline = true;
    await tab1.locator('#note-champ').fill('Note de mon premier onglet');
    await tab2.locator('#note-champ').fill('Note de mon second onglet');
    await tab1.reload(); await tab1.locator('body[data-pret="oui"]').waitFor(); await card(tab1);
    assert.equal(await tab1.locator('#note-champ').inputValue(), 'Note de mon premier onglet');
    fixture.control.offline = false;
    await tab1.close(); await tab2.close();
    // Storage denial is visible and the interface remains usable.
    const denied = await browser.newContext(); await denied.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota'); }; });
    const deniedPage = await open(denied); await deniedPage.locator('#stockage-alerte').waitFor();
    await denied.close();
    const portal = await context.newPage(); await portal.goto(fixture.url);
    for (let i = 0; i < 18; i++) { await portal.keyboard.press('Tab'); assert.ok(!await portal.evaluate(() => document.activeElement.closest('#barre-sauvegarde'))); }
    assert.deepEqual(errors, []);
    await secondContext.close();
    console.log('Régressions navigateur : conflits, notes lentes/hors ligne, dashboard, bilans, priorités, reprise, mobile, thèmes, clavier et stockage : OK');
  } finally { await browser.close(); await new Promise(r => fixture.server.close(r)); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
