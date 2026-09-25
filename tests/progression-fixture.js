const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const config = require('../club.config');
const { validerEtNormaliser, composerEtat } = require('../snapshot-v2');
const clone = x => JSON.parse(JSON.stringify(x));
const themes = config.DIMENSIONS.flatMap((d, i) => Array.from({ length: i === 0 ? 2 : 1 }, (_, t) => ({ id: `${d.id}-${t}`, code: `${d.id}-${t}`, dimension: d.name, name: `Thématique ${d.name} ${t + 1}`, order: t, feeds: [], x: 240 + t * 100, y: 160 + t * 100 })));
const competencies = themes.flatMap(t => Array.from({ length: 4 }, (_, i) => ({ id: `${t.id}-${i}`, theme: t.id, name: `Pratique ${t.name} ${i + 1}`, statement: 'Je sais accompagner une bascule* dans une séance.', markers: Array.from({ length: 10 }, (_, j) => `Je peux observer le signe ${j + 1} : une prise de parole, un engagement et une action précise dans le contexte de cette séance.`).join('\n'), difficulty: config.DIFFICULTES[0].nom, order: i, resources: [] })));
const referential = { version: config.VERSION_REFERENTIEL, dimensions: config.DIMENSIONS, categories: config.CATEGORIES, difficulties: config.DIFFICULTES, scale: config.ECHELLE, niveauAcquis: config.NIVEAU_ACQUIS, maxMaintenant: config.MAX_CIBLES_MAINTENANT, themeLocking: false, resources: [], themes, competencies, lexique: config.LEXIQUE, bookingUrl: config.BOOKING_URL };
async function startFixture(realReference = referential) {
  const snapshots = new Map(), notes = new Map(), events = [];
  const control = { noteDelay: 0, snapshotDelay: 0, offline: false };
  const send = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  const latest = user => (snapshots.get(user) || []).at(-1) || null;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/referential') return send(res, 200, realReference);
    if (url.pathname === '/api/state') {
      const user = url.searchParams.get('uuid');
      return send(res, 200, { ...composerEtat({ referentiel: realReference, snapshot: latest(user) }), notes: notes.get(user) || {} });
    }
    if (url.pathname === '/api/history') {
      if (url.searchParams.has('id')) return send(res, 200, { snapshot: (snapshots.get(url.searchParams.get('uuid')) || []).find(s => s.id === url.searchParams.get('id')) });
      const items = (snapshots.get(url.searchParams.get('uuid')) || []).filter(x => x.blob.kind === 'checkpoint' || (url.searchParams.get('legacy') === 'true' && !x.blob.kind)).reverse();
      const offset = Number(url.searchParams.get('cursor') || 0);
      return send(res, 200, { items: items.slice(offset, offset + 20), nextCursor: items.length > offset + 20 ? String(offset + 20) : null });
    }
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); events.push({ path: url.pathname, body });
      if (url.pathname === '/api/prospect-event' || url.pathname === '/api/access') return send(res, 202, {});
      if (control.offline) return send(res, 503, { erreur: 'Réseau indisponible pour ce test.' });
      if (url.pathname === '/api/snapshot') {
        if ((latest(body.uuid)?.id || null) !== body.base_snapshot_id) return send(res, 409, { current: latest(body.uuid) });
        const normalized = validerEtNormaliser({ referentiel: realReference, corps: body });
        if (normalized.erreurs.length) return send(res, 400, { erreur: normalized.erreurs.join(' ') });
        const snapshot = { id: randomUUID(), cree_le: new Date().toISOString(), libelle: normalized.libelle, blob: normalized.blob };
        snapshots.set(body.uuid, [...(snapshots.get(body.uuid) || []), snapshot]);
        if (control.snapshotDelay) await new Promise(r => setTimeout(r, control.snapshotDelay));
        return send(res, 201, composerEtat({ referentiel: realReference, snapshot }));
      }
      if (url.pathname === '/api/note') {
        const all = notes.get(body.uuid) || {};
        const previous = all[body.code] || null;
        if ((previous?.revision ?? null) !== body.base_revision) return send(res, 409, { current: previous });
        const note = { texte: body.texte.trim(), revision: (previous?.revision || 0) + 1, maj_le: new Date().toISOString() };
        notes.set(body.uuid, { ...all, [body.code]: note });
        if (control.noteDelay) await new Promise(r => setTimeout(r, control.noteDelay));
        return send(res, 201, { note });
      }
    }
    const filename = url.pathname === '/' ? 'spherier-v2.html' : url.pathname.slice(1);
    if (!/^[a-z0-9.-]+\.(html|js|css)$/.test(filename)) { res.writeHead(404); return res.end(); }
    const file = path.join(__dirname, '../public', filename);
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': filename.endsWith('.css') ? 'text/css' : filename.endsWith('.js') ? 'text/javascript' : 'text/html' });
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}`, snapshots, notes, control, events, latest, referential: realReference };
}
module.exports = { startFixture, referential };
