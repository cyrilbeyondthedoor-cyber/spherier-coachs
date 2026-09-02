require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { Client, collectPaginatedAPI } = require('@notionhq/client');
const { DIMENSIONS } = require('./club.config.js');

const SIMULATION = process.env.SIMULATION === '1';
const WORKBOOK_PATH = process.env.WORKBOOK_PATH;
const DB_THEMES = process.env.DB_THEMES;
const DB_COMPETENCES = process.env.DB_COMPETENCES;
const MAPPING_OUTPUT = process.env.MAPPING_OUTPUT
  || path.join(__dirname, '.local', 'referentiel-mapping.json');

const PREFIXES = new Map(DIMENSIONS.map((dimension) => [dimension.name, dimension.id]));
const DIFFICULTES = new Set(['Socle fondamental', 'Professionnel établi', 'A-player']);

const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sansNumero = (valeur) => String(valeur || '').trim().replace(/^\d+\s*-\s*/, '');
const cleTexte = (valeur) => sansNumero(valeur).replaceAll('*', '').trim();

function texteCellule(cellule) {
  return String(cellule?.text || '').trim();
}

function morceaux(texte) {
  const valeur = String(texte || '');
  if (!valeur) return [];
  const resultat = [];
  for (let index = 0; index < valeur.length; index += 1900) {
    resultat.push({ type: 'text', text: { content: valeur.slice(index, index + 1900) } });
  }
  return resultat;
}

function titre(texte) {
  return { title: morceaux(texte) };
}

function riche(texte) {
  return { rich_text: morceaux(texte) };
}

function normaliserRevue(valeur) {
  const revue = String(valeur || '').trim().toLocaleLowerCase('fr');
  if (revue === 'ok') return 'OK';
  if (revue.includes('marqueur')) return 'Marqueurs à revoir';
  return 'À revoir';
}

function normaliserDifficulte(valeur) {
  const difficulte = String(valeur || '').trim();
  return difficulte === 'TTC' ? 'Professionnel établi' : difficulte;
}

function positions(nombre) {
  const colonnes = Math.min(3, nombre);
  const largeur = (colonnes - 1) * 270;
  return Array.from({ length: nombre }, (_, index) => ({
    x: 380 - largeur / 2 + (index % colonnes) * 270,
    y: 120 + Math.floor(index / colonnes) * 210,
  }));
}

async function lireClasseur() {
  if (!WORKBOOK_PATH) throw new Error('WORKBOOK_PATH manquant');
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.readFile(WORKBOOK_PATH);

  const architecture = classeur.getWorksheet('Architecture');
  const enonces = classeur.getWorksheet('Énoncés et évaluation');
  if (!architecture || !enonces) {
    throw new Error('Onglet Architecture ou Énoncés et évaluation introuvable');
  }

  const definitionsThemes = new Map();
  architecture.eachRow((ligne, numero) => {
    if (numero < 3) return;
    const dimension = sansNumero(texteCellule(ligne.getCell(2)));
    const theme = sansNumero(texteCellule(ligne.getCell(4)));
    const definition = texteCellule(ligne.getCell(5));
    if (dimension && theme) definitionsThemes.set(`${dimension}\u0000${cleTexte(theme)}`, definition);
  });

  const lignes = [];
  enonces.eachRow((ligne, numero) => {
    if (numero < 4) return;
    const categorie = texteCellule(ligne.getCell(1));
    const dimension = sansNumero(texteCellule(ligne.getCell(2)));
    const theme = sansNumero(texteCellule(ligne.getCell(3)));
    const enonce = texteCellule(ligne.getCell(4));
    if (!dimension && !theme && !enonce) return;

    lignes.push({
      ligne: numero,
      categorie,
      dimension,
      theme,
      enonce,
      difficulte: normaliserDifficulte(texteCellule(ligne.getCell(5))),
      marqueurs: texteCellule(ligne.getCell(6)),
      revue: normaliserRevue(texteCellule(ligne.getCell(7))),
      idSource: texteCellule(ligne.getCell(12)),
    });
  });

  const themes = [];
  const indexThemes = new Map();
  for (const dimension of DIMENSIONS) {
    const noms = [...new Set(lignes
      .filter((ligne) => ligne.dimension === dimension.name)
      .map((ligne) => ligne.theme))];
    const coordonnees = positions(noms.length);
    noms.forEach((nom, index) => {
      const code = `${dimension.id}-${String(index + 1).padStart(2, '0')}`;
      const theme = {
        code,
        name: nom,
        dimension: dimension.name,
        definition: definitionsThemes.get(`${dimension.name}\u0000${cleTexte(nom)}`) || '',
        order: index + 1,
        ...coordonnees[index],
      };
      themes.push(theme);
      indexThemes.set(`${dimension.name}\u0000${nom}`, theme);
    });
  }

  const rangs = new Map();
  const competences = lignes.map((ligne) => {
    const theme = indexThemes.get(`${ligne.dimension}\u0000${ligne.theme}`);
    if (!theme) throw new Error(`Ligne ${ligne.ligne} : thématique inconnue ${ligne.dimension} / ${ligne.theme}`);
    const rang = (rangs.get(theme.code) || 0) + 1;
    rangs.set(theme.code, rang);
    return {
      ...ligne,
      code: `${theme.code}-${String(rang).padStart(2, '0')}`,
      themeCode: theme.code,
      order: rang,
      difficulte: DIFFICULTES.has(ligne.difficulte) ? ligne.difficulte : '',
    };
  });

  return { themes, competences };
}

function verifier({ themes, competences }) {
  const erreurs = [];
  const doublons = (valeurs) => [...valeurs.entries()].filter(([, nombre]) => nombre > 1).map(([valeur]) => valeur);
  const compte = (liste) => liste.reduce((acc, valeur) => acc.set(valeur, (acc.get(valeur) || 0) + 1), new Map());

  if (themes.length !== 33) erreurs.push(`33 thématiques attendues, ${themes.length} reçues`);
  if (competences.length !== 193) erreurs.push(`193 compétences attendues, ${competences.length} reçues`);

  const codesThemesDupliques = doublons(compte(themes.map((theme) => theme.code)));
  const codesCompetencesDupliques = doublons(compte(competences.map((competence) => competence.code)));
  if (codesThemesDupliques.length) erreurs.push(`Codes de thèmes dupliqués : ${codesThemesDupliques.join(', ')}`);
  if (codesCompetencesDupliques.length) erreurs.push(`Codes de compétences dupliqués : ${codesCompetencesDupliques.join(', ')}`);

  for (const competence of competences) {
    if (!competence.enonce) erreurs.push(`Ligne ${competence.ligne} sans énoncé`);
    if (!PREFIXES.has(competence.dimension)) erreurs.push(`Ligne ${competence.ligne} : dimension inconnue`);
  }

  if (erreurs.length) throw new Error(erreurs.join('\n'));
}

async function dataSource(notion, databaseId) {
  const database = await notion.databases.retrieve({ database_id: databaseId });
  const id = database.data_sources?.[0]?.id;
  if (!id) throw new Error(`Aucune data source pour la base ${databaseId}`);
  return id;
}

async function pagesParCode(notion, dataSourceId) {
  const pages = await collectPaginatedAPI(notion.dataSources.query, { data_source_id: dataSourceId });
  return new Map(pages.map((page) => {
    const code = (page.properties.Code?.rich_text || []).map((segment) => segment.plain_text).join('');
    return [code, page];
  }).filter(([code]) => code));
}

async function importer(donnees) {
  const notion = new Client({ auth: process.env.NOTION_TOKEN });
  if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN manquant');
  if (!DB_THEMES || !DB_COMPETENCES) throw new Error('DB_THEMES ou DB_COMPETENCES manquant');

  const themesDs = await dataSource(notion, DB_THEMES);
  const competencesDs = await dataSource(notion, DB_COMPETENCES);

  await notion.dataSources.update({
    data_source_id: themesDs,
    properties: {
      Dimension: {
        select: {
          options: DIMENSIONS.map((dimension) => ({ name: dimension.name })),
        },
      },
    },
  });

  const themesExistants = await pagesParCode(notion, themesDs);
  const competencesExistantes = await pagesParCode(notion, competencesDs);
  if (themesExistants.size || competencesExistantes.size) {
    const themesAttendus = new Set(donnees.themes.map((theme) => theme.code));
    const competencesAttendues = new Set(donnees.competences.map((competence) => competence.code));
    const importComplet = themesExistants.size === themesAttendus.size
      && competencesExistantes.size === competencesAttendues.size
      && [...themesAttendus].every((code) => themesExistants.has(code))
      && [...competencesAttendues].every((code) => competencesExistantes.has(code));
    if (importComplet) {
      console.log('Le référentiel complet est déjà présent. Aucune écriture effectuée.');
      return;
    }
    throw new Error(
      `Import partiel détecté (${themesExistants.size} thèmes, ${competencesExistantes.size} compétences). `
      + 'Arrêt pour éviter les doublons ou l’écrasement de corrections faites dans Notion.'
    );
  }

  const pagesThemes = new Map();
  for (const theme of donnees.themes) {
    const page = await notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: themesDs },
      properties: {
        Name: titre(theme.name),
        Code: riche(theme.code),
        DefinitionThematique: riche(theme.definition),
        Dimension: { select: { name: theme.dimension } },
        'Position X': { number: theme.x },
        'Position Y': { number: theme.y },
        Ordre: { number: theme.order },
        Actif: { checkbox: true },
      },
    });
    await attendre(350);
    pagesThemes.set(theme.code, page.id);
  }

  for (const competence of donnees.competences) {
    const properties = {
      Name: titre(competence.enonce),
      Code: riche(competence.code),
      'ID source': riche(competence.idSource),
      Description: riche(competence.enonce),
      'Énoncé N1': riche(competence.enonce),
      'Énoncé N2': riche(''),
      'Énoncé N3': riche(''),
      Marqueurs: riche(competence.marqueurs),
      Revue: { select: { name: competence.revue } },
      Ordre: { number: competence.order },
      Actif: { checkbox: true },
      '📚 Thèmes': { relation: [{ id: pagesThemes.get(competence.themeCode) }] },
    };
    if (competence.difficulte) properties.Difficulté = { select: { name: competence.difficulte } };

    await notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: competencesDs },
      properties,
    });
    await attendre(350);
  }
}

async function principal() {
  const donnees = await lireClasseur();
  verifier(donnees);

  fs.mkdirSync(path.dirname(MAPPING_OUTPUT), { recursive: true });
  fs.writeFileSync(MAPPING_OUTPUT, JSON.stringify(donnees, null, 2));

  const sansMarqueurs = donnees.competences.filter((competence) => !competence.marqueurs).length;
  const aRevoir = donnees.competences.filter((competence) => competence.revue !== 'OK').length;
  const sansDifficulte = donnees.competences.filter((competence) => !competence.difficulte).length;
  console.log(`${donnees.themes.length} thématiques · ${donnees.competences.length} compétences`);
  console.log(`${sansMarqueurs} sans marqueurs · ${aRevoir} à revoir · ${sansDifficulte} sans difficulté`);
  console.log(`Mapping : ${MAPPING_OUTPUT}`);

  if (SIMULATION) {
    console.log('Simulation terminée, aucune écriture Notion.');
    return;
  }

  await importer(donnees);
  console.log('Import Notion terminé.');
}

principal().catch((erreur) => {
  console.error('ÉCHEC :', erreur.message);
  process.exit(1);
});
