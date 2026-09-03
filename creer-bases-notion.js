require('dotenv').config({ quiet: true });
const { DIFFICULTES } = require('./club.config.js');

const { Client, collectPaginatedAPI } = require('@notionhq/client');

// ===========================================================================
// Création des quatre bases Notion du sphérier.
// ===========================================================================
//
// À lancer UNE FOIS, sur un espace Notion vierge. Il crée Thèmes, Compétences,
// Ressources et Clients avec les noms de propriétés exacts que le code cherche —
// une faute de frappe sur un nom de propriété vide silencieusement le champ
// correspondant, sans message d'erreur.
//
// Utilisation :
//   1. Créer une intégration Notion dans votre espace, récupérer son jeton.
//   2. Créer une page vide qui accueillera les bases, et la PARTAGER avec
//      l'intégration (menu ••• > Connexions).
//   3. NOTION_TOKEN=... PAGE_PARENT=<id de la page> node creer-bases-notion.js
//      L'id de page se lit dans son URL : les 32 caractères après le dernier tiret.
//   4. Recopier les identifiants affichés à la fin dans les variables
//      d'environnement du site Netlify.
//
// Mode simulation, pour voir ce qui serait créé sans rien écrire :
//   SIMULATION=1 NOTION_TOKEN=... PAGE_PARENT=... node creer-bases-notion.js
//
// ---------------------------------------------------------------------------
// DEUX PIÈGES, appris à nos dépens sur le premier club.
//
// 1. UNE RELATION DUALE SE CRÉE EN UNE SEULE INSTRUCTION. Déclarer la relation
//    d'un côté puis l'autre produit DEUX paires orphelines, non synchronisées,
//    sans que rien ne le signale : on coche d'un côté, l'autre reste vide. Ce
//    script crée donc chaque relation duale en une fois, via `dual_property`.
//
// 2. LA RELATION RÉFLEXIVE « Nourrit / Nourri par » NE PEUT PAS être créée en
//    même temps que la base : elle pointe vers la base elle-même, qui n'existe
//    pas encore. Elle est donc ajoutée dans un second temps, une fois la base
//    Thèmes créée. Le script s'en charge — c'est la raison de l'étape 5.
// ---------------------------------------------------------------------------

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const SIMULATION = process.env.SIMULATION === '1';
const PARENT = (process.env.PAGE_PARENT || '').replace(/-/g, '');

const titre = (t) => ({ title: [{ type: 'text', text: { content: t } }] });

// Les noms de propriétés ci-dessous sont CONTRACTUELS : ce sont ceux que
// referentiel-v2.js cherche. Ne les changer que si l'on change aussi le code.
const THEMES = {
  Name: { title: {} },
  Code: { rich_text: {} },
  DefinitionThematique: { rich_text: {} },
  // Les options de `Dimension` doivent correspondre EXACTEMENT aux `name` des
  // dimensions déclarées dans club.config.js.
  Dimension: { select: { options: [] } },
  'Position X': { number: { format: 'number' } },
  'Position Y': { number: { format: 'number' } },
  Ordre: { number: { format: 'number' } },
  Actif: { checkbox: {} },
};

const COMPETENCES = (idThemes) => ({
  Name: { title: {} },
  Code: { rich_text: {} },
  'ID source': { rich_text: {} },
  Description: { rich_text: {} },
  'Énoncé N1': { rich_text: {} },
  'Énoncé N2': { rich_text: {} },
  'Énoncé N3': { rich_text: {} },
  Marqueurs: { rich_text: {} },
  Revue: {
    select: {
      options: [
        { name: 'OK', color: 'green' },
        { name: 'À revoir', color: 'red' },
        { name: 'Marqueurs à revoir', color: 'yellow' },
      ],
    },
  },
  // Les noms d'options doivent correspondre aux `nom` de DIFFICULTES dans
  // club.config.js. Renommer une option depuis l'interface Notion en
  // redéfinissant la liste EFFACE toutes les valeurs assignées : passer par
  // l'API et l'identifiant de l'option.
  'Difficulté': {
    select: {
      options: [
        ...DIFFICULTES.map((difficulte, index) => ({ name: difficulte.nom, color: ['green', 'orange', 'purple'][index] || 'default' })),
      ],
    },
  },
  Ordre: { number: { format: 'number' } },
  Actif: { checkbox: {} },
  // Relation duale, créée en UNE instruction — voir le piège 1.
  '📚 Thèmes': {
    relation: {
      data_source_id: idThemes,
      type: 'dual_property',
      dual_property: { synced_property_name: '⚒️ Compétences' },
    },
  },
});

const RESSOURCES = (idThemes, idCompetences) => ({
  Name: { title: {} },
  Type: { multi_select: { options: [] } },
  URL: { url: {} },
  Actif: { checkbox: {} },
  '📚 Thèmes': {
    relation: {
      data_source_id: idThemes,
      type: 'dual_property',
      dual_property: { synced_property_name: '📋 Ressources' },
    },
  },
  '⚒️ Compétences': {
    relation: {
      data_source_id: idCompetences,
      type: 'dual_property',
      dual_property: { synced_property_name: '📋 Ressources' },
    },
  },
});

// La base Clients n'est pas lue par l'application : elle sert au pilote du club
// à retrouver quel membre porte quel UUID, et à lui envoyer son lien.
// L'UUID doit être ALÉATOIRE : c'est le seul secret qui protège les données du
// membre. Jamais « membre-01 ».
const CLIENTS = {
  Name: { title: {} },
  UUID: { rich_text: {} },
  'Lien du sphérier': { url: {} },
  Actif: { checkbox: {} },
};

async function creerBase(nom, proprietes) {
  if (SIMULATION) {
    console.log(`  [simulation] ${nom} : ${Object.keys(proprietes).join(', ')}`);
    return { id: `SIMULATION_${nom}`, dsId: `SIMULATION_DS_${nom}` };
  }
  const base = await notion.databases.create({
    parent: { type: 'page_id', page_id: PARENT },
    title: titre(nom).title,
    is_inline: false,
    initial_data_source: { properties: proprietes },
  });
  // Depuis l'API 2025-09-03, les propriétés vivent sur la « data source » de la
  // base. C'est cet identifiant qu'il faut pour déclarer une relation.
  const complet = await notion.databases.retrieve({ database_id: base.id });
  const dsId = complet.data_sources[0].id;
  console.log(`  ${nom} créée · database ${base.id} · data source ${dsId}`);
  return { id: base.id, dsId };
}

async function principal() {
  if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN manquant');
  if (!PARENT) throw new Error('PAGE_PARENT manquant (id de la page qui accueille les bases)');

  console.log(SIMULATION ? '=== SIMULATION — aucune écriture ===\n' : '=== Création des bases ===\n');

  // Relancer ce script sur une page déjà équipée créait quatre bases de plus.
  if (!SIMULATION) {
    const enfants = await collectPaginatedAPI(notion.blocks.children.list, { block_id: PARENT });
    const deja = enfants.find((bloc) => bloc.type === 'child_database' && /Thèmes/.test(bloc.child_database?.title || ''));
    if (deja) {
      throw new Error(`La page parent contient déjà une base Thèmes (${deja.id}). Rien n'est créé : utiliser les bases existantes ou une autre page.`);
    }
  }

  // 1. Thèmes d'abord : les autres bases pointent vers elle.
  const themes = await creerBase('📚 Thèmes', THEMES);

  // 2. Compétences, avec sa relation duale vers Thèmes.
  const competences = await creerBase('⚒️ Compétences', COMPETENCES(themes.dsId));

  // 3. Ressources, avec ses deux relations duales.
  const ressources = await creerBase('📋 Ressources', RESSOURCES(themes.dsId, competences.dsId));

  // 4. Clients.
  const clients = await creerBase('Clients', CLIENTS);

  // 5. La relation réflexive de Thèmes, en second temps — voir le piège 2.
  //    « Nourrit » signifie « travailler ici éclaire là-bas ». C'est le graphe de
  //    progression : une thématique s'ouvre quand une de ses sources atteint le seuil.
  if (!SIMULATION) {
    await notion.dataSources.update({
      data_source_id: themes.dsId,
      properties: {
        Nourrit: {
          relation: {
            data_source_id: themes.dsId,
            type: 'dual_property',
            dual_property: { synced_property_name: 'Nourri par' },
          },
        },
      },
    });
    const verif = await notion.dataSources.retrieve({ data_source_id: themes.dsId });
    const ok = Boolean(verif.properties.Nourrit) && Boolean(verif.properties['Nourri par']);
    console.log(ok
      ? '  relation réflexive Nourrit / Nourri par posée'
      : '  ATTENTION : la relation réflexive n\'a pas été créée, à faire à la main');
  } else {
    console.log('  [simulation] relation réflexive Nourrit / Nourri par');
  }

  if (SIMULATION) return;

  console.log('\n=== À reporter dans les variables d\'environnement Netlify ===');
  console.log(`DB_THEMES=${themes.id}`);
  console.log(`DB_COMPETENCES=${competences.id}`);
  console.log(`DB_RESSOURCES=${ressources.id}`);
  console.log(`DB_CLIENTS=${clients.id} (pilotage uniquement, non requis par Netlify)`);
  console.log('\nEt à faire ensuite, à la main :');
  console.log('  1. Partager les QUATRE bases avec l\'intégration (••• > Connexions).');
  console.log('     C\'est Clients qu\'on avait oubliée la première fois.');
  console.log('  2. Renseigner les options du select `Dimension` de la base Thèmes,');
  console.log('     avec EXACTEMENT les `name` déclarés dans club.config.js.');
}

if (require.main === module) {
  principal().catch((err) => {
    console.error('ÉCHEC :', err.message);
    process.exit(1);
  });
}

module.exports = { THEMES, COMPETENCES, RESSOURCES, CLIENTS };
