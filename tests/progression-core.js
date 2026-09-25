const assert = require('node:assert/strict');
const { score, merge, compare } = require('../public/spherier-core');
const { validerEtNormaliser, deriverSelections, composerEtat } = require('../snapshot-v2');
const { VERSION_REFERENTIEL } = require('../club.config');
const codes = ['A', 'B', 'C', 'D'];
assert.equal(score(codes, { A: 2, B: 2, C: 2, D: 2 }).percent, 0);
assert.deepEqual(score(codes, { A: 3 }, ['B', 'C', 'D']), { total: 4, evaluated: 1, mastered: 1, skipped: 3, percent: 100 });
assert.equal(score(codes, {}, codes).percent, null);
assert.equal(score(codes, { A: 3, B: 2, C: 1 }).percent, 33);
assert.deepEqual(compare({ A: 1, B: 0, C: 3 }, { A: 2, B: 3, C: 0, D: 1 }, codes), [{ code: 'A', before: 1, after: 2, delta: 1 }]);
const baseline = { levels: { A: 0, B: 0 }, current: [], later: [], priorites: {}, practice: {} };
const local = { ...baseline, levels: { A: 1, B: 0 }, practice: { A: { action: 'Essayer' } } };
const remote = { ...baseline, levels: { A: 0, B: 3 } };
const result = merge(baseline, local, remote);
assert.deepEqual(result.conflicts, []);
assert.deepEqual(result.state.levels, { A: 1, B: 3 });
assert.equal(result.state.practice.A.action, 'Essayer');
assert.deepEqual(merge(baseline, local, { ...remote, levels: { A: 2, B: 3 } }).conflicts, ['levels.A']);
assert.equal(deriverSelections({ priorites: { classement: [] }, maxMaintenant: 3 }), null);
assert.deepEqual(deriverSelections({ priorites: { classement: [], initialized: true }, maxMaintenant: 3 }), { current: [], later: [] });
for (const length of [1, 3, 4]) {
  const selection = deriverSelections({ priorites: { classement: codes.slice(0, length), initialized: true }, maxMaintenant: 3 });
  assert.equal(selection.current.length, Math.min(length, 3));
  assert.equal(selection.later.length, Math.max(length - 3, 0));
}
const referentiel = { dimensions: [{ id: 'D', name: 'Dimension' }], themes: [{ id: 'T', dimension: 'Dimension', feeds: [] }], competencies: codes.map(id => ({ id, theme: 'T' })) };
const body = { uuid: '00000000-0000-4000-8000-000000000001', referential_version: VERSION_REFERENTIEL, levels: { A: 1 }, selections: { current: [], later: [] } };
assert.ok(validerEtNormaliser({ referentiel, corps: null }).erreurs.length);
const emptyRanking = { themes: {}, dimensions: {}, classement: [], initialized: true };
const removedLast = validerEtNormaliser({ referentiel, corps: { ...body, selections: { current: ['A'], later: [] }, priorites: emptyRanking } });
assert.deepEqual(removedLast.blob.selections, { current: [], later: [] });
const oldGhost = composerEtat({ referentiel, snapshot: { blob: { ...body, selections: { current: ['A'], later: [] }, priorites: emptyRanking } } });
assert.deepEqual(oldGhost.snapshot.blob.selections, { current: [], later: [] });
const validated = validerEtNormaliser({ referentiel, corps: { ...body, kind: 'checkpoint', practice: { A: { action: 'Essayer', observation: 'J’ai progressé' }, OBSOLETE: { action: 'Ancien code' } }, audit: { derniere: { dimensionId: 'D', themeId: 'T', code: 'A', mode: 'dimension' } } } });
assert.deepEqual(validated.erreurs, []);
assert.equal(validated.blob.audit.derniere.mode, 'dimension');
assert.equal(validated.blob.kind, 'checkpoint');
assert.equal(validated.blob.practice.A.observation, 'J’ai progressé');
assert.equal(validated.blob.practice.OBSOLETE, undefined);
assert.ok(validerEtNormaliser({ referentiel, corps: { ...body, practice: { A: { action: 'a'.repeat(2001) } } } }).erreurs.length);
const oldState = composerEtat({ referentiel, snapshot: { id: 'old', blob: { ...body, referential_version: VERSION_REFERENTIEL } } });
assert.equal(oldState.computed.levels.A, 1);
async function invalidBodies() {
  for (const name of ['access', 'note', 'snapshot', 'prospect-event']) {
    const { handler } = require(`../netlify/functions/${name}`);
    for (const body of ['null', '[]', '3', '"text"', '{']) {
      const response = await handler({ httpMethod: 'POST', body, headers: { 'x-forwarded-for': '127.0.0.91' } });
      assert.equal(response.statusCode, 400, `${name} ${body}`);
    }
  }
  console.log('Scores, fusion à trois versions, priorités vides, pratique, anciens snapshots et JSON invalides : OK');
}
invalidBodies().catch(e => { console.error(e); process.exitCode = 1; });
