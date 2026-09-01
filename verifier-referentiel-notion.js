require('dotenv').config({ quiet: true });

const assert = require('node:assert/strict');
const { Client, collectPaginatedAPI } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });

function texte(page, nom) {
  const propriete = page.properties[nom];
  const segments = propriete?.rich_text || propriete?.title || [];
  return segments.map((segment) => segment.plain_text).join('').trim();
}

async function interroger(databaseId) {
  const database = await notion.databases.retrieve({ database_id: databaseId });
  const dataSourceId = database.data_sources?.[0]?.id;
  assert.ok(dataSourceId, `Data source absente pour ${databaseId}`);
  return collectPaginatedAPI(notion.dataSources.query, { data_source_id: dataSourceId });
}

function verifierCodes(pages, nom) {
  const codes = pages.map((page) => texte(page, 'Code'));
  assert.ok(codes.every(Boolean), `${nom} : code vide`);
  assert.equal(new Set(codes).size, codes.length, `${nom} : code dupliqué`);
}

async function principal() {
  const variables = ['NOTION_TOKEN', 'DB_THEMES', 'DB_COMPETENCES', 'DB_RESSOURCES'];
  for (const variable of variables) assert.ok(process.env[variable], `${variable} manquant`);

  const [themes, competences, ressources] = await Promise.all([
    interroger(process.env.DB_THEMES),
    interroger(process.env.DB_COMPETENCES),
    interroger(process.env.DB_RESSOURCES),
  ]);

  assert.equal(themes.length, 33, 'Nombre de thématiques');
  assert.equal(competences.length, 193, 'Nombre de compétences');
  assert.equal(ressources.length, 0, 'La base Ressources doit être vide au premier import');
  verifierCodes(themes, 'Thématiques');
  verifierCodes(competences, 'Compétences');

  assert.ok(themes.every((page) => page.properties.Actif?.checkbox === true), 'Thématique inactive');
  assert.ok(themes.every((page) => page.properties['Position X']?.number !== null), 'Position X absente');
  assert.ok(themes.every((page) => page.properties['Position Y']?.number !== null), 'Position Y absente');
  assert.ok(competences.every((page) => page.properties.Actif?.checkbox === true), 'Compétence inactive');
  assert.ok(competences.every((page) => texte(page, 'Énoncé N1')), 'Énoncé N1 absent');
  assert.ok(competences.every((page) => !texte(page, 'Énoncé N2') && !texte(page, 'Énoncé N3')), 'N2 ou N3 doit rester vide');
  assert.ok(competences.every((page) => page.properties['📚 Thèmes']?.relation?.length === 1), 'Relation de thème invalide');

  const sansMarqueurs = competences.filter((page) => !texte(page, 'Marqueurs')).length;
  const aRevoir = competences.filter((page) => page.properties.Revue?.select?.name !== 'OK').length;
  const difficultes = competences.reduce((compte, page) => {
    const nom = page.properties.Difficulté?.select?.name || 'Non renseigné';
    compte[nom] = (compte[nom] || 0) + 1;
    return compte;
  }, {});

  assert.equal(sansMarqueurs, 5, 'Nombre de marqueurs vides');
  assert.equal(aRevoir, 56, 'Nombre de lignes à revoir');
  assert.deepEqual(difficultes, {
    'Socle fondamental': 57,
    TTC: 54,
    'A-player': 81,
    'Non renseigné': 1,
  });

  console.log('Notion vérifié : 33 thématiques · 193 compétences · 0 ressource');
  console.log('57 Socle fondamental · 54 TTC · 81 A-player · 1 non renseignée');
  console.log('5 marqueurs vides · 56 lignes à revoir · codes et relations uniques');
}

principal().catch((erreur) => {
  console.error('ÉCHEC :', erreur.message);
  process.exit(1);
});
