// Optional embedded PostgreSQL: SPHERIER_PGLITE_PATH=/path/to/node_modules/@electric-sql/pglite node tests/progression-sql.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.SPHERIER_PGLITE_PATH || '@electric-sql/pglite');
async function main() {
  const db = new PGlite();
  try {
    await db.exec('create role service_role; create role anon;');
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8'));
    const user = '00000000-0000-4000-8000-000000000001';
    await db.query("insert into notes(client_id,code,texte) values($1,'A','Ancienne note')", [user]);
    const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260925_progression.sql'), 'utf8');
    await db.exec(migration); await db.exec(migration);
    const snap = async (base, value) => (await db.query('select save_spherier_snapshot($1,$2,$3,$4) as result', [user, base, 'Point', JSON.stringify({ referential_version: 1, levels: { A: value }, kind: 'checkpoint' })])).rows[0].result;
    const first = (await snap(null, 1)).snapshot;
    assert.ok(first.id);
    // Requests from two clients carrying the same baseline: only the first is accepted.
    const competing = await Promise.all([snap(first.id, 2), snap(first.id, 3)]);
    assert.equal(competing.filter(r => r.conflict).length, 1);
    assert.equal((await db.query('select count(*)::int as count from snapshots')).rows[0].count, 2);
    const note = async (revision, text) => (await db.query('select save_spherier_note($1,$2,$3,$4) as result', [user, 'A', text, revision])).rows[0].result;
    assert.equal((await note(null, 'Obsolète')).conflict, true);
    const second = (await note(1, 'Version 2')).note;
    assert.equal(second.revision, 2);
    const deleted = (await note(2, '')).note;
    assert.equal(deleted.revision, 3);
    assert.equal((await note(2, 'Ancien onglet')).conflict, true);
    assert.equal((await db.query("select texte from notes where code='A'")).rows[0].texte, '');
    assert.ok(deleted.maj_le >= second.maj_le);
    const permissions = await db.query("select has_function_privilege('anon','save_spherier_snapshot(uuid,uuid,text,jsonb)','execute') as anonymous, has_function_privilege('service_role','save_spherier_snapshot(uuid,uuid,text,jsonb)','execute') as server");
    assert.deepEqual(permissions.rows[0], { anonymous: false, server: true });
    await db.exec('set role service_role');
    assert.equal((await note(3, 'Rôle de service')).note.revision, 4);
    await db.exec('reset role');
    console.log('Migration PostgreSQL, idempotence, versions, tombstone et droits RPC : OK (moteur embarqué, une connexion).');
  } finally { await db.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
