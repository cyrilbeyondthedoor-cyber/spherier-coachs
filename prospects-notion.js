require('dotenv').config({ quiet: true });

const { randomUUID } = require('node:crypto');
const { Client, collectPaginatedAPI } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const { DB_PROSPECTS } = process.env;
let dataSourceId = null;

function morceaux(texte) {
  const valeur = String(texte || '');
  const resultat = [];
  for (let index = 0; index < valeur.length; index += 1900) {
    resultat.push({ type: 'text', text: { content: valeur.slice(index, index + 1900) } });
  }
  return resultat;
}

function texte(page, nom) {
  const propriete = page.properties[nom];
  return (propriete?.rich_text || propriete?.title || []).map((segment) => segment.plain_text).join('').trim();
}

async function sourceProspects() {
  if (dataSourceId) return dataSourceId;
  if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN manquant');
  if (!DB_PROSPECTS) throw new Error('DB_PROSPECTS manquant');
  const database = await notion.databases.retrieve({ database_id: DB_PROSPECTS });
  dataSourceId = database.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error('Data source Prospects absente');
  return dataSourceId;
}

async function chercherProspect(propriete, valeur) {
  const source = await sourceProspects();
  const pages = await collectPaginatedAPI(notion.dataSources.query, {
    data_source_id: source,
    filter: { property: propriete, rich_text: { equals: valeur } },
    page_size: 10,
  });
  if (pages.length > 1) console.warn(`Prospects : ${pages.length} doublons pour ${propriete}`);
  return pages[0] || null;
}

async function obtenirOuCreerProspect({ prenom, email, source, baseUrl }) {
  const emailNormalise = email.trim().toLowerCase();
  const existant = await chercherProspect('Email normalisé', emailNormalise);
  if (existant) {
    let uuid = texte(existant, 'UUID');
    let lien = existant.properties['Lien du sphérier']?.url;
    if (!uuid) uuid = randomUUID();
    if (!lien) lien = `${baseUrl.replace(/\/$/, '')}/?c=${uuid}`;
    if (!texte(existant, 'UUID') || !existant.properties['Lien du sphérier']?.url) {
      await mettreAJourProspect(existant.id, {
        UUID: { rich_text: morceaux(uuid) },
        'Lien du sphérier': { url: lien },
      });
    }
    return {
      pageId: existant.id,
      uuid,
      lien,
      nouveau: false,
    };
  }

  const uuid = randomUUID();
  const lien = `${baseUrl.replace(/\/$/, '')}/?c=${uuid}`;
  const maintenant = new Date().toISOString();
  const dataSource = await sourceProspects();
  const page = await notion.pages.create({
    parent: { type: 'data_source_id', data_source_id: dataSource },
    properties: {
      Name: { title: morceaux(prenom) },
      Email: { email },
      'Email normalisé': { rich_text: morceaux(emailNormalise) },
      UUID: { rich_text: morceaux(uuid) },
      'Lien du sphérier': { url: lien },
      Source: { rich_text: morceaux(source) },
      'Consentement le': { date: { start: maintenant } },
      'Progression audit': { number: 0 },
      'Rendez-vous réservé': { checkbox: false },
    },
  });
  return { pageId: page.id, uuid, lien, nouveau: true };
}

async function trouverProspectParUuid(uuid) {
  return chercherProspect('UUID', uuid);
}

async function mettreAJourProspect(pageId, properties) {
  return notion.pages.update({ page_id: pageId, properties });
}

module.exports = {
  morceaux,
  obtenirOuCreerProspect,
  trouverProspectParUuid,
  mettreAJourProspect,
};
