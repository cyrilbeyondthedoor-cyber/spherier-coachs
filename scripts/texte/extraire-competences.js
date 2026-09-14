// Extrait les compétences actives du référentiel Notion dans un fichier local, pour
// travailler le texte (fautes, tutoiement, ponctuation) sans relire l'API à chaque
// passe. Le fichier produit n'est pas versionné : il double le contenu de Notion, qui
// reste la source de vérité.
//
//   bash with-notion-env.sh node scripts/texte/extraire-competences.js

const fs = require('node:fs');
const path = require('node:path');
const { Client, collectPaginatedAPI } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const SORTIE = path.join(__dirname, 'competences.json');

// Notion découpe un texte en plusieurs segments dès qu'il porte du formatage : ne lire
// que le premier tronquerait silencieusement un marqueur.
function texte(page, nom) {
  const prop = page.properties[nom];
  const segments = prop?.rich_text ?? prop?.title ?? [];
  return segments.map((s) => s.plain_text).join('').trim();
}

function relations(page, nom) {
  return (page.properties[nom]?.relation ?? []).map((r) => r.id);
}

async function interroger(databaseId) {
  const database = await notion.databases.retrieve({ database_id: databaseId });
  const dataSourceId = database.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error(`Aucune data source pour la base ${databaseId}`);
  return collectPaginatedAPI(notion.dataSources.query, { data_source_id: dataSourceId });
}

async function principal() {
  for (const cle of ['NOTION_TOKEN', 'DB_THEMES', 'DB_COMPETENCES']) {
    if (!process.env[cle]) throw new Error(`Variable d'environnement manquante : ${cle}`);
  }
  const [pagesThemes, pagesCompetences] = await Promise.all([
    interroger(process.env.DB_THEMES),
    interroger(process.env.DB_COMPETENCES),
  ]);

  const themesActifs = new Map(
    pagesThemes
      .filter((p) => p.properties.Actif?.checkbox === true)
      .map((p) => [p.id, texte(p, 'Name')]),
  );

  const rang = (c) => c.order ?? Number.MAX_SAFE_INTEGER;
  const competences = pagesCompetences
    .filter((p) => p.properties.Actif?.checkbox === true)
    .map((p) => ({
      pageId: p.id,
      code: texte(p, 'Code'),
      theme: themesActifs.get(relations(p, '📚 Thèmes').find((id) => themesActifs.has(id))) ?? null,
      difficulte: p.properties.Difficulté?.select?.name ?? null,
      name: texte(p, 'Name'),
      statement: texte(p, 'Énoncé N1'),
      description: texte(p, 'Description'),
      markers: texte(p, 'Marqueurs'),
      order: p.properties.Ordre?.number ?? null,
    }))
    .filter((c) => c.code && c.theme)
    // Même ordre que referentiel-v2.js : l'audit des fautes numérote les compétences
    // dans cet ordre, une numérotation différente rendrait ses repères inutilisables.
    .sort((a, b) => rang(a) - rang(b) || a.code.localeCompare(b.code, 'fr'));

  fs.writeFileSync(SORTIE, `${JSON.stringify(competences, null, 2)}\n`, 'utf8');
  console.log(`${competences.length} compétences actives écrites dans ${path.relative(process.cwd(), SORTIE)}`);
}

principal().catch((erreur) => {
  console.error('ÉCHEC :', erreur.message);
  process.exit(1);
});
