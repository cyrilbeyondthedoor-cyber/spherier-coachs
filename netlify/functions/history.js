require('dotenv').config({ quiet: true });
const { creerClientServeur, TABLE_SNAPSHOTS } = require('../../supabase-client.js');
const { estUuidV4 } = require('../../snapshot-v2.js');
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const response = (statusCode, data) => ({ statusCode, headers, body: JSON.stringify(data) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return response(405, { erreur: 'Utilise GET.' });
  const { uuid, cursor, legacy, id } = event.queryStringParameters || {};
  if (!estUuidV4(uuid)) return response(400, { erreur: 'Lien personnel invalide.' });
  if (id !== undefined && !estUuidV4(id)) return response(400, { erreur: 'Identifiant de bilan invalide.' });
  let boundary = null;
  if (cursor) {
    try {
      boundary = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      if (!estUuidV4(boundary.id) || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|\+00:00)$/.test(boundary.date)
        || !Number.isFinite(Date.parse(boundary.date))) throw new Error();
    } catch { return response(400, { erreur: 'Curseur invalide.' }); }
  }
  try {
    if (id) {
      const { data, error } = await creerClientServeur().from(TABLE_SNAPSHOTS)
        .select('id, libelle, cree_le, blob').eq('client_id', uuid.trim().toLowerCase()).eq('id', id).maybeSingle();
      if (error) throw error;
      return data ? response(200, { snapshot: data }) : response(404, { erreur: 'Bilan introuvable.' });
    }
    let query = creerClientServeur().from(TABLE_SNAPSHOTS)
      .select('id, libelle, cree_le, kind:blob->>kind, referential_version:blob->referential_version, levels:blob->levels, selections:blob->selections').eq('client_id', uuid.trim().toLowerCase())
      .order('cree_le', { ascending: false }).order('id', { ascending: false }).limit(21);
    query = legacy === 'true' ? query.or('blob->>kind.eq.checkpoint,blob->>kind.is.null') : query.eq('blob->>kind', 'checkpoint');
    if (boundary) query = query.or(`cree_le.lt.${boundary.date},and(cree_le.eq.${boundary.date},id.lt.${boundary.id})`);
    const { data, error } = await query;
    if (error) throw error;
    const items = (data || []).slice(0, 20).map(row => ({ id: row.id, libelle: row.libelle, cree_le: row.cree_le, blob: { kind: row.kind, referential_version: row.referential_version, levels: row.levels || {}, selections: row.selections || {} } }));
    const last = items.at(-1);
    return response(200, { items, nextCursor: (data || []).length > 20
      ? Buffer.from(JSON.stringify({ date: last.cree_le, id: last.id })).toString('base64url') : null });
  } catch (error) {
    console.error('history:', error.message);
    return response(502, { erreur: 'Lecture des bilans impossible. Réessaie.' });
  }
};
