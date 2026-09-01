const { createClient } = require('@supabase/supabase-js');

const TABLE_SNAPSHOTS = 'snapshots';
const VERSION_SCHEMA = 1;

// L'URL du projet peut être collée sous plusieurs formes selon l'endroit où on la
// copie dans Supabase (avec ou sans le suffixe /rest/v1). Le client l'ajoute
// lui-même : on le retire pour éviter un chemin doublé (erreur PGRST125).
function normaliserUrl(url) {
  return String(url).trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
}

// Client à privilèges élevés : réservé au serveur, jamais exposé au navigateur.
function creerClientServeur() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL et SUPABASE_SECRET_KEY doivent être définis');
  }
  return createClient(normaliserUrl(url), key, {
    auth: { persistSession: false },
  });
}

module.exports = { creerClientServeur, normaliserUrl, TABLE_SNAPSHOTS, VERSION_SCHEMA };
