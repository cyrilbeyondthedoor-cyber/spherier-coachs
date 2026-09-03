const assert = require('node:assert/strict');

// Recette du cache du référentiel et du garde-fou CLUB, sans réseau : le client
// Notion est remplacé par un faux qui compte ses appels et peut tomber en panne.
process.env.NOTION_TOKEN = 'jeton-test';
process.env.DB_THEMES = 'db-themes';
process.env.DB_COMPETENCES = 'db-competences';
process.env.DB_RESSOURCES = 'db-ressources';

let lectures = 0;
let panne = false;
const notionPath = require.resolve('@notionhq/client');
require.cache[notionPath] = {
  id: notionPath,
  filename: notionPath,
  loaded: true,
  exports: {
    Client: class {
      constructor() {
        this.databases = {
          retrieve: async ({ database_id }) => {
            if (database_id === 'db-themes') lectures += 1;
            if (panne) throw new Error('Notion indisponible (429)');
            return { data_sources: [{ id: `ds-${database_id}` }] };
          },
        };
        this.dataSources = { query: async () => ({ results: [] }) };
      }
    },
    collectPaginatedAPI: async () => [],
  },
};

const { getReferentielV2, viderCacheReferentiel, etatCacheReferentiel } = require('../referentiel-v2.js');
const { verifierClub } = require('../club.config.js');

async function testerCache() {
  viderCacheReferentiel();

  // Lectures concurrentes sur cache vide : une seule lecture Notion.
  const [a, b, c] = await Promise.all([getReferentielV2(), getReferentielV2(), getReferentielV2()]);
  assert.equal(lectures, 1, 'les appels concurrents doivent partager une seule lecture');
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(etatCacheReferentiel().present, true);

  // Cache valide : aucune lecture supplémentaire.
  await getReferentielV2();
  assert.equal(lectures, 1);

  // Cache expiré et Notion en panne : l'ancien référentiel est servi, pas une erreur.
  viderCacheReferentiel();
  await getReferentielV2();
  assert.equal(lectures, 2);
  const avant = etatCacheReferentiel().pose_a;
  await new Promise((r) => setTimeout(r, 5));
  // Forcer l'expiration sans attendre le TTL : on relit avec force, en panne.
  panne = true;
  const replie = await getReferentielV2({ force: true });
  assert.equal(lectures, 3, 'une relecture doit avoir été tentée');
  assert.equal(replie.club, 'coachs', 'le référentiel expiré doit être servi en repli');
  assert.equal(etatCacheReferentiel().pose_a, avant, 'le cache ne doit pas être rafraîchi par un repli');

  // Cache vide et Notion en panne : l'erreur remonte, il n'y a rien à servir.
  viderCacheReferentiel();
  await assert.rejects(() => getReferentielV2(), /Notion indisponible/);
  panne = false;
}

function testerGardeFouClub() {
  const netlifyAvant = process.env.NETLIFY;
  const clubAvant = process.env.CLUB;

  delete process.env.CLUB;
  delete process.env.NETLIFY;
  assert.equal(verifierClub(), 'coachs', 'en local, CLUB absent est toléré');

  process.env.NETLIFY = 'true';
  assert.throws(() => verifierClub(), /CLUB est absente/, 'sur Netlify, CLUB absent doit bloquer');

  process.env.CLUB = 'b2c';
  assert.throws(() => verifierClub(), /CONFIGURATION CROISÉE/);

  process.env.CLUB = 'coachs';
  assert.equal(verifierClub(), 'coachs');

  if (netlifyAvant === undefined) delete process.env.NETLIFY; else process.env.NETLIFY = netlifyAvant;
  if (clubAvant === undefined) delete process.env.CLUB; else process.env.CLUB = clubAvant;
}

(async () => {
  await testerCache();
  testerGardeFouClub();
  console.log('Cache du référentiel et garde-fou CLUB : OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
