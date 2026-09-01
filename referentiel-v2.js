require('dotenv').config({ quiet: true });

const { Client, collectPaginatedAPI } = require('@notionhq/client');
const { DIMENSIONS, ECHELLE, VERSION_REFERENTIEL, DIFFICULTES, CIEL,
        MAX_CIBLES_MAINTENANT, NIVEAU_ACQUIS, CLUB, verifierClub } = require('./club.config.js');

const { NOTION_TOKEN, DB_THEMES, DB_COMPETENCES, DB_RESSOURCES } = process.env;

const notion = new Client({ auth: NOTION_TOKEN });

// --- Lecture des propriétés Notion -------------------------------------------------

// Notion découpe un texte en plusieurs segments dès qu'il porte du formatage. Ne lire
// que le premier tronquerait silencieusement les définitions et les énoncés : on
// concatène toujours l'intégralité.
function texte(page, nom) {
  const prop = page.properties[nom];
  const segments = prop?.rich_text ?? prop?.title ?? [];
  return segments.map((s) => s.plain_text).join('').trim();
}

function nombre(page, nom) {
  return page.properties[nom]?.number ?? null;
}

function coche(page, nom) {
  return page.properties[nom]?.checkbox === true;
}

function selection(page, nom) {
  return page.properties[nom]?.select?.name ?? '';
}

// Rang d'une compétence dans sa thématique. `Ordre` vide vaut « à la fin » : on ne
// renvoie pas Infinity, dont la différence avec elle-même donne NaN et casserait le tri.
function rangCompetence(competence) {
  return competence.order ?? Number.MAX_SAFE_INTEGER;
}

function multiSelection(page, nom) {
  return (page.properties[nom]?.multi_select ?? []).map((o) => o.name);
}

function relations(page, nom) {
  return (page.properties[nom]?.relation ?? []).map((r) => r.id);
}

// La propriété URL est repérée par son TYPE plutôt que par son nom : le brief l'annonce
// sous « userDefined:URL » alors que l'API la renvoie sous « URL ». Cibler le type rend
// la lecture insensible à ce genre de renommage.
function url(page) {
  const cle = Object.keys(page.properties).find((k) => page.properties[k].type === 'url');
  return cle ? (page.properties[cle].url ?? '') : '';
}

async function interroger(databaseId) {
  const database = await notion.databases.retrieve({ database_id: databaseId });
  const dataSourceId = database.data_sources?.[0]?.id;
  if (!dataSourceId) {
    throw new Error(`Aucune data source trouvée pour la base ${databaseId}`);
  }
  return collectPaginatedAPI(notion.dataSources.query, { data_source_id: dataSourceId });
}

// --- Assemblage du référentiel ------------------------------------------------------

// Cache mémoire du référentiel.
//
// Le lire intégralement à chaque affichage n'est pas tenable : 40 thèmes + 152
// compétences + ressources représentent plusieurs appels paginés à l'API Notion
// (limitée à 3 req/s), soit ~1,3 s et du quota consommé à chaque ouverture de page.
//
// Le référentiel reste néanmoins lu EN LIVE au sens où il n'est jamais figé au build :
// une correction dans Notion se voit seule, au pire après le TTL. Les fonctions
// serverless étant éphémères, ce cache n'est ni durable ni partagé entre instances —
// il sert à absorber les rafales, pas à garantir une cohérence globale.
const TTL_CACHE_MS = 10 * 60 * 1000;
let cache = { referentiel: null, expireA: 0, posePar: null };

function viderCacheReferentiel() {
  cache = { referentiel: null, expireA: 0, posePar: null };
}

function etatCacheReferentiel() {
  return {
    present: cache.referentiel !== null,
    expire_dans_s: cache.referentiel ? Math.max(0, Math.round((cache.expireA - Date.now()) / 1000)) : 0,
    pose_a: cache.posePar,
  };
}

// `force: true` contourne le cache sans le vider (lecture fraîche ponctuelle).
async function getReferentielV2({ force = false } = {}) {
  if (!force && cache.referentiel && Date.now() < cache.expireA) {
    return cache.referentiel;
  }
  const referentiel = await lireReferentielDepuisNotion();
  cache = {
    referentiel,
    expireA: Date.now() + TTL_CACHE_MS,
    posePar: new Date().toISOString(),
  };
  return referentiel;
}

async function lireReferentielDepuisNotion() {
  for (const [cle, valeur] of Object.entries({ NOTION_TOKEN, DB_THEMES, DB_COMPETENCES, DB_RESSOURCES })) {
    if (!valeur) throw new Error(`Variable d'environnement manquante : ${cle}`);
  }

  const [pagesThemes, pagesCompetences, pagesRessources] = await Promise.all([
    interroger(DB_THEMES),
    interroger(DB_COMPETENCES),
    interroger(DB_RESSOURCES),
  ]);

  // Seules les lignes actives entrent dans le référentiel : les pages « [archive] »
  // sont à Actif = false et doivent rester invisibles.
  const themesActifs = pagesThemes.filter((p) => coche(p, 'Actif'));
  const idsThemesActifs = new Set(themesActifs.map((p) => p.id));

  const themes = themesActifs
    .map((p) => ({
      id: p.id,
      code: texte(p, 'Code'),
      name: texte(p, 'Name'),
      dimension: selection(p, 'Dimension'),
      definition: texte(p, 'DefinitionThematique'),
      // Une arête vers une thématique archivée serait un lien mort dans le graphe.
      feeds: relations(p, 'Nourrit').filter((id) => idsThemesActifs.has(id)),
      x: nombre(p, 'Position X'),
      y: nombre(p, 'Position Y'),
      order: nombre(p, 'Ordre'),
    }))
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));

  const ressourcesActives = pagesRessources.filter((p) => coche(p, 'Actif'));
  const idsRessourcesActives = new Set(ressourcesActives.map((p) => p.id));

  const resources = ressourcesActives.map((p) => {
    const themesLies = relations(p, '📚 Thèmes').filter((id) => idsThemesActifs.has(id));
    return {
      id: p.id,
      name: texte(p, 'Name'),
      type: multiSelection(p, 'Type'),
      url: url(p),
      // Le contrat prévoit un rattachement unique ; `themes` conserve l'intégralité au
      // cas où une ressource en viserait plusieurs, sans rien perdre en silence.
      theme: themesLies[0] ?? null,
      themes: themesLies,
    };
  });

  const competencies = pagesCompetences
    .filter((p) => coche(p, 'Actif'))
    .map((p) => {
      const themesLies = relations(p, '📚 Thèmes').filter((id) => idsThemesActifs.has(id));
      return {
        id: texte(p, 'Code'),
        theme: themesLies[0] ?? null,
        name: texte(p, 'Name'),
        definition: texte(p, 'Description'),
        statements: {
          1: texte(p, 'Énoncé N1'),
          2: texte(p, 'Énoncé N2'),
          3: texte(p, 'Énoncé N3'),
        },
        // Fondamental / Avancé, pour la pastille de difficulté.
        difficulty: selection(p, 'Difficulté') || null,
        // Rang d'affichage DANS la thématique. Les codes restent des identifiants
        // permanents : on insère une compétence en lui donnant un rang intermédiaire,
        // jamais en renumérotant les codes.
        order: nombre(p, 'Ordre'),
        resources: relations(p, '📋 Ressources').filter((id) => idsRessourcesActives.has(id)),
      };
    })
    // Une compétence sans code n'est pas identifiable dans un snapshot : on l'écarte.
    .filter((c) => c.id)
    // L'ordre est fixé ICI, une fois : tout ce qui consomme la liste la filtre par
    // thématique et suit l'ordre du tableau. Une compétence sans `Ordre` passe en FIN
    // de sa thématique — c'est le cas normal d'une compétence qu'on vient d'ajouter
    // dans Notion, et elle ne doit jamais se retrouver en tête par accident. Deux
    // compétences sans rang restent départagées par leur code, pour un ordre stable.
    .sort((a, b) => rangCompetence(a) - rangCompetence(b) || a.id.localeCompare(b.id, 'fr'));

  return {
    // Le club voyage avec le référentiel : c'est le garde-fou contre une configuration
    // croisée entre les deux instances, visible d'un coup d'œil dans la réponse.
    club: verifierClub(),
    version: VERSION_REFERENTIEL,
    // Réglages de club envoyés au navigateur, pour qu'il n'en tienne aucune copie :
    // teintes, libellés de difficulté, plafonds, ordre du ciel. Ajouter une dimension
    // ou renommer un palier ne demande alors de toucher qu'à club.config.js.
    difficulties: DIFFICULTES,
    limites: { maxCiblesMaintenant: MAX_CIBLES_MAINTENANT, niveauAcquis: NIVEAU_ACQUIS },
    ciel: CIEL,
    dimensions: DIMENSIONS,
    themes,
    competencies,
    resources,
    scale: ECHELLE,
  };
}

module.exports = {
  getReferentielV2,
  viderCacheReferentiel,
  etatCacheReferentiel,
  VERSION_REFERENTIEL,
  TTL_CACHE_MS,
};
