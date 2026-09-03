const assert = require('node:assert/strict');
const { Client } = require('@notionhq/client');
const {
  obtenirOuCreerProspect,
  trouverProspectParUuid,
  mettreAJourProspect,
} = require('../prospects-notion.js');

async function principal() {
  if (!process.env.NOTION_TOKEN || !process.env.DB_PROSPECTS) {
    throw new Error('NOTION_TOKEN et DB_PROSPECTS requis');
  }
  const notion = new Client({ auth: process.env.NOTION_TOKEN });
  const email = `test-spherier-${Date.now()}@example.com`;
  let pageId = null;
  try {
    const premier = await obtenirOuCreerProspect({
      prenom: 'Test',
      email,
      source: 'test-automatique',
      baseUrl: 'https://spherier.example',
    });
    pageId = premier.pageId;
    const second = await obtenirOuCreerProspect({
      prenom: 'Test',
      email: email.toUpperCase(),
      source: 'test-automatique',
      baseUrl: 'https://spherier.example',
    });
    assert.equal(premier.nouveau, true);
    assert.equal(second.nouveau, false);
    assert.equal(second.uuid, premier.uuid);
    assert.equal(second.pageId, premier.pageId);

    const retrouve = await trouverProspectParUuid(premier.uuid);
    assert.equal(retrouve.id, premier.pageId);
    await mettreAJourProspect(premier.pageId, { 'Progression audit': { number: 0.5 } });
    console.log('Notion Prospects : création, dédoublonnage UUID et mise à jour OK');
  } finally {
    if (pageId) await notion.pages.update({ page_id: pageId, archived: true });
  }
}

principal().catch((erreur) => {
  console.error(erreur);
  process.exit(1);
});
