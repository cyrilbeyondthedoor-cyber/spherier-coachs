require('dotenv').config({ quiet: true });

const { Client, collectPaginatedAPI } = require('@notionhq/client');

const APPLIQUER = process.env.APPLIQUER === '1';
const ANCIENNE = 'TTC';
const NOUVELLE = 'Professionnel établi';
const notion = new Client({ auth: process.env.NOTION_TOKEN });

const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function principal() {
  if (!process.env.NOTION_TOKEN || !process.env.DB_COMPETENCES) {
    throw new Error('NOTION_TOKEN ou DB_COMPETENCES manquant');
  }
  const database = await notion.databases.retrieve({ database_id: process.env.DB_COMPETENCES });
  const dataSourceId = database.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error('Data source Compétences absente');
  const pages = await collectPaginatedAPI(notion.dataSources.query, { data_source_id: dataSourceId });
  const aMigrer = pages.filter((page) => page.properties.Difficulté?.select?.name === ANCIENNE);
  console.log(`${aMigrer.length} compétences à migrer de « ${ANCIENNE} » vers « ${NOUVELLE} »`);
  if (!APPLIQUER) {
    console.log('Simulation terminée. Relancer avec APPLIQUER=1 pour écrire dans Notion.');
    return;
  }
  for (const page of aMigrer) {
    await notion.pages.update({
      page_id: page.id,
      properties: { Difficulté: { select: { name: NOUVELLE } } },
    });
    await attendre(350);
  }
  console.log('Migration terminée. L’ancienne option reste inutilisée pour éviter une suppression risquée.');
}

principal().catch((erreur) => {
  console.error('ÉCHEC :', erreur.message);
  process.exit(1);
});
