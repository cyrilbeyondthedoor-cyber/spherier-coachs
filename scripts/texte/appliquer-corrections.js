// Écrit dans Notion les propositions validées par `proposer-corrections.js`.
//
//   bash with-notion-env.sh node scripts/texte/appliquer-corrections.js            (simulation)
//   APPLIQUER=1 bash with-notion-env.sh node scripts/texte/appliquer-corrections.js (écriture)
//
// Sans APPLIQUER=1 rien n'est écrit : le script se contente de lister ce qu'il ferait.
// Après écriture, chaque page modifiée est relue et comparée au texte proposé : une
// écriture partielle ou tronquée par l'API doit se voir ici, pas en production.

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('@notionhq/client');

const APPLIQUER = process.env.APPLIQUER === '1';
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Notion refuse un segment de plus de 2000 caractères. Les marqueurs les plus longs
// tiennent largement en dessous, mais un découpage évite un échec silencieux le jour où
// une compétence s'allonge.
const TAILLE_SEGMENT = 2000;

const NOMS_NOTION = {
  name: 'Name',
  statement: 'Énoncé N1',
  description: 'Description',
  markers: 'Marqueurs',
  // Aucune proposition ne porte aujourd'hui sur la difficulté : l'arbitrage a conclu
  // que les compétences visées étaient déjà au bon niveau. Le chemin d'écriture reste
  // en place, testé en simulation, pour le jour où un arbitrage en reclassera une.
  difficulte: 'Difficulté',
};

function segments(texte) {
  const morceaux = [];
  for (let i = 0; i < texte.length; i += TAILLE_SEGMENT) {
    morceaux.push({ text: { content: texte.slice(i, i + TAILLE_SEGMENT) } });
  }
  return morceaux.length ? morceaux : [{ text: { content: '' } }];
}

function proprieteNotion(champ, texte) {
  if (champ === 'name') return { title: segments(texte) };
  // La difficulté est une liste de choix : l'option doit exister telle quelle dans
  // Notion, sans quoi l'API en crée une nouvelle et la pastille perd sa couleur.
  if (champ === 'difficulte') return { select: { name: texte } };
  return { rich_text: segments(texte) };
}

function lire(page, nom) {
  const prop = page.properties[nom];
  if (prop?.type === 'select') return prop.select?.name ?? '';
  const parts = prop?.rich_text ?? prop?.title ?? [];
  return parts.map((s) => s.plain_text).join('').trim();
}

async function principal() {
  if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN manquant');
  const fichier = path.join(__dirname, 'propositions.json');
  if (!fs.existsSync(fichier)) throw new Error('propositions.json absent : lancer proposer-corrections.js');
  const { propositions } = JSON.parse(fs.readFileSync(fichier, 'utf8'));

  // Une page porte jusqu'à quatre champs corrigés : on l'écrit en une seule requête.
  const parPage = new Map();
  for (const p of propositions) {
    if (!p.pageId) throw new Error(`Proposition sans pageId pour ${p.code}`);
    const entree = parPage.get(p.pageId) || { code: p.code, champs: {} };
    entree.champs[p.champ] = p.apres;
    parPage.set(p.pageId, entree);
  }

  console.log(`${propositions.length} champs à écrire sur ${parPage.size} compétences.`);
  if (!APPLIQUER) {
    for (const [, entree] of parPage) {
      console.log(`  ${entree.code} : ${Object.keys(entree.champs).join(', ')}`);
    }
    console.log('Simulation terminée. Relancer avec APPLIQUER=1 pour écrire dans Notion.');
    return;
  }

  const ecrites = [];
  for (const [pageId, entree] of parPage) {
    const properties = {};
    for (const [champ, texte] of Object.entries(entree.champs)) {
      properties[NOMS_NOTION[champ]] = proprieteNotion(champ, texte);
    }
    await notion.pages.update({ page_id: pageId, properties });
    ecrites.push([pageId, entree]);
    await attendre(350);
  }
  console.log(`${ecrites.length} compétences écrites. Relecture de contrôle…`);

  const ecarts = [];
  for (const [pageId, entree] of ecrites) {
    const page = await notion.pages.retrieve({ page_id: pageId });
    for (const [champ, attendu] of Object.entries(entree.champs)) {
      const obtenu = lire(page, NOMS_NOTION[champ]);
      if (obtenu !== attendu.trim()) ecarts.push(`${entree.code} · ${champ}`);
    }
    await attendre(350);
  }
  if (ecarts.length) {
    console.error(`ÉCARTS après relecture (${ecarts.length}) : ${ecarts.join(', ')}`);
    process.exit(1);
  }
  console.log('Relecture de contrôle : le texte écrit correspond au texte proposé.');
}

principal().catch((erreur) => {
  console.error('ÉCHEC :', erreur.message);
  process.exit(1);
});
