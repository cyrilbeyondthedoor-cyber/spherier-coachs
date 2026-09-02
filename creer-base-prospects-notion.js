require('dotenv').config({ quiet: true });

const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const SIMULATION = process.env.SIMULATION === '1';
const PARENT = String(process.env.PAGE_PARENT || '').replaceAll('-', '');

const PROPRIETES = {
  Name: { title: {} },
  Email: { email: {} },
  'Email normalisé': { rich_text: {} },
  UUID: { rich_text: {} },
  'Lien du sphérier': { url: {} },
  Source: { rich_text: {} },
  'Consentement le': { date: {} },
  'Créé le': { created_time: {} },
  'Audit commencé le': { date: {} },
  'Progression audit': { number: { format: 'percent' } },
  'Audit terminé le': { date: {} },
  'Priorité 1': { rich_text: {} },
  'Priorité 2': { rich_text: {} },
  'Priorité 3': { rich_text: {} },
  'Agenda cliqué le': { date: {} },
  'Rendez-vous réservé': { checkbox: {} },
};

async function principal() {
  if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN manquant');
  if (!PARENT) throw new Error('PAGE_PARENT manquant');
  if (SIMULATION) {
    console.log(`Simulation : Prospects Sphérier · ${Object.keys(PROPRIETES).join(', ')}`);
    return;
  }
  const base = await notion.databases.create({
    parent: { type: 'page_id', page_id: PARENT },
    title: [{ type: 'text', text: { content: 'Prospects Sphérier' } }],
    is_inline: false,
    initial_data_source: { properties: PROPRIETES },
  });
  const complete = await notion.databases.retrieve({ database_id: base.id });
  const dataSourceId = complete.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error('Data source Prospects absente après création');
  const source = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const absentes = Object.keys(PROPRIETES).filter((nom) => !source.properties[nom]);
  if (absentes.length) throw new Error(`Propriétés absentes : ${absentes.join(', ')}`);
  console.log(`DB_PROSPECTS=${base.id}`);
  console.log(`DS_PROSPECTS=${dataSourceId}`);
  console.log(`URL=${base.url}`);
}

principal().catch((erreur) => {
  console.error('ÉCHEC :', erreur.message);
  process.exit(1);
});
