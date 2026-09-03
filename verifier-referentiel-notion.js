require('dotenv').config({ quiet: true });

const assert = require('node:assert/strict');
const { Client, collectPaginatedAPI } = require('@notionhq/client');
const { DIFFICULTES } = require('./club.config.js');

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

  // Seuls les invariants sont des assertions. Les comptes changent avec la vie du
  // référentiel : ils sont affichés, pas figés.
  verifierCodes(themes, 'Thématiques');
  verifierCodes(competences, 'Compétences');

  assert.ok(themes.every((page) => page.properties.Actif?.checkbox === true), 'Thématique inactive');
  assert.ok(themes.every((page) => page.properties['Position X']?.number !== null), 'Position X absente');
  assert.ok(themes.every((page) => page.properties['Position Y']?.number !== null), 'Position Y absente');
  const competencesActives = competences.filter((page) => page.properties.Actif?.checkbox === true);
  const competencesInactives = competences.filter((page) => page.properties.Actif?.checkbox !== true);
  assert.ok(competencesActives.every((page) => texte(page, 'Énoncé N1')), 'Énoncé N1 absent');
  assert.ok(competencesActives.every((page) => !texte(page, 'Énoncé N2') && !texte(page, 'Énoncé N3')), 'N2 ou N3 doit rester vide');
  assert.ok(competencesActives.every((page) => page.properties['📚 Thèmes']?.relation?.length === 1), 'Relation de thème invalide');
  assert.ok(competencesActives.every((page) => texte(page, 'Marqueurs').split('\n').every((ligne) => ligne.startsWith('• '))), 'Format des marqueurs non uniforme');
  const difficultesConnues = new Set(DIFFICULTES.map((difficulte) => difficulte.nom));
  assert.ok(
    competencesActives.every((page) => difficultesConnues.has(page.properties.Difficulté?.select?.name)),
    `Difficulté hors des valeurs connues (${[...difficultesConnues].join(', ')})`
  );

  const sansMarqueurs = competencesActives.filter((page) => !texte(page, 'Marqueurs')).length;
  const aRevoir = competencesActives.filter((page) => page.properties.Revue?.select?.name !== 'OK').length;
  const difficultes = competencesActives.reduce((compte, page) => {
    const nom = page.properties.Difficulté?.select?.name || 'Non renseigné';
    compte[nom] = (compte[nom] || 0) + 1;
    return compte;
  }, {});

  console.log(`Notion vérifié : ${themes.length} thématiques · ${competencesActives.length} compétences actives · ${competencesInactives.length} inactive(s) · ${ressources.length} ressource(s)`);
  console.log(Object.entries(difficultes).map(([nom, n]) => `${n} ${nom}`).join(' · '));
  console.log(`${sansMarqueurs} marqueur(s) vide(s) · ${aRevoir} ligne(s) à revoir · codes et relations uniques`);
  if (sansMarqueurs || aRevoir) console.warn('Attention : des lignes restent incomplètes, voir ci-dessus.');
}

principal().catch((erreur) => {
  console.error('ÉCHEC :', erreur.message);
  process.exit(1);
});
