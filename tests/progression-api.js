const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { referential } = require('./progression-fixture');
const user = randomUUID(), code = referential.competencies[0].id;
let rpcResult, rpcError, lastRpc, historyRows = [], filters = [];
const mockClient = {
  async rpc(name, args) { lastRpc = { name, args }; return { data: rpcResult, error: rpcError }; },
  from() {
    let single = false;
    const query = { maybeSingle() { single = true; return query; }, then(resolve) { return Promise.resolve({ data: single ? (historyRows[0] || null) : historyRows, error: null }).then(resolve); } };
    for (const method of ['select', 'eq', 'order', 'limit', 'or']) query[method] = (...args) => { filters.push([method, ...args]); return query; };
    return query;
  },
};
require.cache[require.resolve('../supabase-client')] = { exports: { creerClientServeur: () => mockClient, TABLE_SNAPSHOTS: 'snapshots' } };
require.cache[require.resolve('../referentiel-v2')] = { exports: { getReferentielV2: async () => referential } };
for (const path of ['../snapshot-v2', '../notes-v3']) delete require.cache[require.resolve(path)];
const { handler: save } = require('../netlify/functions/snapshot');
const { handler: note } = require('../netlify/functions/note');
const { handler: history } = require('../netlify/functions/history');
const call = (handler, data) => handler({ httpMethod: 'POST', body: JSON.stringify(data), headers: { 'x-forwarded-for': '127.0.0.72' } });
async function main() {
  const data = { uuid: user, referential_version: referential.version, levels: { [code]: 2 }, selections: { current: [], later: [] } };
  assert.equal((await call(save, data)).statusCode, 428);
  assert.equal((await call(save, { ...data, base_snapshot_id: 'bad' })).statusCode, 400);
  rpcResult = { snapshot: { id: randomUUID(), blob: { ...data, selections: { current: [], later: [] }, kind: 'checkpoint' } } };
  const saved = await call(save, { ...data, base_snapshot_id: null, kind: 'checkpoint' });
  assert.equal(saved.statusCode, 201);
  assert.equal(lastRpc.name, 'save_spherier_snapshot'); assert.equal(lastRpc.args.p_base_id, null);
  assert.equal(lastRpc.args.p_blob.kind, 'checkpoint');
  const newest = { id: randomUUID(), blob: data };
  rpcResult = { conflict: true, current: newest };
  assert.equal((await call(save, { ...data, base_snapshot_id: newest.id })).statusCode, 409);
  assert.equal((await call(note, { uuid: user, code, texte: 'Hello' })).statusCode, 428);
  assert.equal((await call(note, { uuid: user, code, texte: 'Hello', base_revision: -1 })).statusCode, 400);
  rpcResult = { note: { code, texte: '', revision: 4, maj_le: '2026-09-25T12:00:00Z' } };
  const removed = await call(note, { uuid: user, code, texte: '', base_revision: 3 });
  assert.equal(removed.statusCode, 200); assert.equal(JSON.parse(removed.body).note.revision, 4);
  assert.equal(lastRpc.args.p_base_revision, 3);
  rpcResult = { conflict: true, current: { texte: 'Other', revision: 5 } };
  const conflict = await call(note, { uuid: user, code, texte: 'Local', base_revision: 4 });
  assert.equal(conflict.statusCode, 409); assert.equal(JSON.parse(conflict.body).current.texte, 'Other');
  historyRows = Array.from({ length: 21 }, (_, i) => ({ id: randomUUID(), cree_le: `2026-09-${String(25 - i).padStart(2, '0')}T12:00:00.123456+00:00`, kind: 'checkpoint', referential_version: 1, levels: { [code]: 2 }, selections: { current: [code] } }));
  const first = await history({ httpMethod: 'GET', queryStringParameters: { uuid: user } });
  assert.equal(first.statusCode, 200);
  const page = JSON.parse(first.body); assert.equal(page.items.length, 20); assert.ok(page.nextCursor);
  assert.equal(page.items[0].blob.levels[code], 2); assert.equal(page.items[0].blob.practice, undefined);
  assert.ok(filters.some(f => f[0] === 'eq' && f[1] === 'client_id' && f[2] === user));
  assert.ok(filters.some(f => f[0] === 'eq' && f[1] === 'blob->>kind' && f[2] === 'checkpoint'));
  filters = []; historyRows = [];
  assert.equal((await history({ httpMethod: 'GET', queryStringParameters: { uuid: user, cursor: page.nextCursor } })).statusCode, 200);
  assert.ok(filters.some(f => f[0] === 'or' && f[1].includes(page.items.at(-1).id)));
  assert.equal((await history({ httpMethod: 'GET', queryStringParameters: { uuid: user, cursor: 'null' } })).statusCode, 400);
  assert.equal((await history({ httpMethod: 'GET', queryStringParameters: {} })).statusCode, 400);
  assert.equal((await history({ httpMethod: 'POST' })).statusCode, 405);
  historyRows = [{ id: newest.id, blob: { practice: { [code]: { observation: 'Observation privée' } } } }]; filters = [];
  const detail = await history({ httpMethod: 'GET', queryStringParameters: { uuid: user, id: newest.id } });
  assert.equal(detail.statusCode, 200); assert.equal(JSON.parse(detail.body).snapshot.blob.practice[code].observation, 'Observation privée');
  assert.ok(filters.some(f => f[0] === 'eq' && f[1] === 'client_id' && f[2] === user));
  historyRows = [];
  assert.equal((await history({ httpMethod: 'GET', queryStringParameters: { uuid: user, id: newest.id } })).statusCode, 404);
  console.log('API : préconditions 428/400, sauvegardes RPC, conflits 409 et pagination des bilans : OK');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
