require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const ExcelJS = require('exceljs');
const { Client, collectPaginatedAPI } = require('@notionhq/client');

const APPLIQUER = process.env.APPLIQUER === '1';
const WORKBOOK_PATH = process.env.WORKBOOK_PATH;
const MAPPING_PATH = process.env.MAPPING_PATH || '.local/referentiel-mapping.json';
const DB_COMPETENCES = process.env.DB_COMPETENCES;
const DIFFICULTES = new Set(['Socle fondamental', 'Professionnel établi', 'A-player']);
const REMPLACEMENTS_SANS_ID = new Map([
  ['Je sais ancrer émotionnellement une prise de conscience du client', 'A développer TGI.'],
  ['Je sais incarner une posture où je prends beaucoup de place au service de mon client.', 'Je sais incarner une posture où je prend toute la place au service de mon client.'],
  ["Je sais incarner une posture solennelle (montrer qu'on qu'on comprend et respecte ce qui ce joue pour le client).", "Je sais incarner une posture solennel (montrer qu'on qu'on comprend et respecte ce qui ce joue pour le client)."],
]);

const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const texteCellule = (cellule) => String(cellule?.text || '').trim();
const sansNumero = (valeur) => String(valeur || '').trim().replace(/^\d+\s*-\s*/, '');
const normaliserDifficulte = (valeur) => String(valeur || '').trim() === 'TTC'
  ? 'Professionnel établi'
  : String(valeur || '').trim();
const morceaux = (texte) => {
  const valeur = String(texte || '');
  const resultat = [];
  for (let index = 0; index < valeur.length; index += 1900) {
    resultat.push({ type: 'text', text: { content: valeur.slice(index, index + 1900) } });
  }
  return resultat;
};
const titre = (texte) => ({ title: morceaux(texte) });
const riche = (texte) => ({ rich_text: morceaux(texte) });
const normaliserRevue = (valeur) => String(valeur || '').trim().toLocaleLowerCase('fr') === 'ok' ? 'OK' : 'À revoir';

function normaliserMarqueurs(valeur) {
  return String(valeur || '')
    .replace(/\s+•\s+/g, '\n• ')
    .split(/\r?\n/)
    .map((ligne) => ligne.trim().replace(/^(?:[•●◦▪*-]|–|—)+\s*/, ''))
    .filter(Boolean)
    .map((ligne) => `• ${ligne}`)
    .join('\n');
}

function texte(page, nom) {
  const propriete = page.properties[nom];
  return (propriete?.rich_text || propriete?.title || []).map((segment) => segment.plain_text).join('').trim();
}

async function lireV6() {
  if (!WORKBOOK_PATH) throw new Error('WORKBOOK_PATH manquant');
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.readFile(WORKBOOK_PATH);
  const feuille = classeur.getWorksheet('Énoncés et évaluation');
  if (!feuille) throw new Error('Onglet Énoncés et évaluation introuvable');

  const rangs = new Map();
  const competences = [];
  feuille.eachRow((ligne, numero) => {
    if (numero < 4) return;
    const dimension = sansNumero(texteCellule(ligne.getCell(2)));
    const theme = sansNumero(texteCellule(ligne.getCell(3)));
    const enonce = texteCellule(ligne.getCell(4));
    if (!dimension && !theme && !enonce) return;
    const cleTheme = `${dimension}\u0000${theme}`;
    const order = (rangs.get(cleTheme) || 0) + 1;
    rangs.set(cleTheme, order);
    competences.push({
      ligne: numero,
      dimension,
      theme,
      enonce,
      difficulte: normaliserDifficulte(texteCellule(ligne.getCell(5))),
      marqueurs: normaliserMarqueurs(texteCellule(ligne.getCell(6))),
      revue: normaliserRevue(texteCellule(ligne.getCell(7))),
      idSource: texteCellule(ligne.getCell(12)),
      order,
    });
  });
  if (competences.length !== 192) throw new Error(`192 compétences attendues, ${competences.length} reçues`);
  if (competences.some((item) => !item.enonce || !DIFFICULTES.has(item.difficulte) || !item.marqueurs)) {
    throw new Error('Le V6 contient une compétence incomplète');
  }
  return competences;
}

async function pagesNotion(notion) {
  const database = await notion.databases.retrieve({ database_id: DB_COMPETENCES });
  const dataSourceId = database.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error('Data source Compétences absente');
  return collectPaginatedAPI(notion.dataSources.query, { data_source_id: dataSourceId });
}

function trouverCorrespondances(v6, mapping, pages) {
  const pagesParCode = new Map(pages.map((page) => [texte(page, 'Code'), page]));
  const anciensParId = new Map(mapping.competences.filter((item) => item.idSource).map((item) => [item.idSource, item]));
  const anciensParEnonce = new Map(mapping.competences.filter((item) => !item.idSource).map((item) => [item.enonce, item]));
  const utilises = new Set();
  const correspondances = v6.map((item) => {
    let ancien = item.idSource ? anciensParId.get(item.idSource) : anciensParEnonce.get(item.enonce);
    if (!ancien && !item.idSource) ancien = anciensParEnonce.get(REMPLACEMENTS_SANS_ID.get(item.enonce));
    if (!ancien) throw new Error(`Ligne ${item.ligne} sans correspondance stable : ${item.enonce}`);
    const page = pagesParCode.get(ancien.code);
    if (!page) throw new Error(`Page Notion absente pour ${ancien.code}`);
    if (utilises.has(page.id)) throw new Error(`Page Notion utilisée deux fois : ${ancien.code}`);
    utilises.add(page.id);
    return { item, ancien, page };
  });
  const absentesDuV6 = pages.filter((page) => !utilises.has(page.id));
  if (absentesDuV6.length !== 1 || texte(absentesDuV6[0], 'ID source') !== 'NEW-ACT-05-01') {
    throw new Error(`Retrait inattendu : ${absentesDuV6.map((page) => texte(page, 'Code')).join(', ')}`);
  }
  return { correspondances, aDesactiver: absentesDuV6.filter((page) => page.properties.Actif?.checkbox === true) };
}

function changements({ item, page }) {
  const attendus = {
    Name: item.enonce,
    Description: item.enonce,
    'Énoncé N1': item.enonce,
    Marqueurs: item.marqueurs,
    Revue: item.revue,
    Difficulté: item.difficulte,
    Ordre: item.order,
    Actif: true,
  };
  const actuels = {
    Name: texte(page, 'Name'),
    Description: texte(page, 'Description'),
    'Énoncé N1': texte(page, 'Énoncé N1'),
    Marqueurs: texte(page, 'Marqueurs'),
    Revue: page.properties.Revue?.select?.name || '',
    Difficulté: page.properties.Difficulté?.select?.name || '',
    Ordre: page.properties.Ordre?.number,
    Actif: page.properties.Actif?.checkbox,
  };
  return Object.keys(attendus).filter((nom) => actuels[nom] !== attendus[nom]);
}

async function principal() {
  if (!process.env.NOTION_TOKEN || !DB_COMPETENCES) throw new Error('NOTION_TOKEN ou DB_COMPETENCES manquant');
  const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8'));
  const v6 = await lireV6();
  const notion = new Client({ auth: process.env.NOTION_TOKEN });
  const pages = await pagesNotion(notion);
  if (pages.length !== 193) throw new Error(`193 pages Notion attendues, ${pages.length} reçues`);
  const { correspondances, aDesactiver } = trouverCorrespondances(v6, mapping, pages);
  const aMettreAJour = correspondances
    .map((correspondance) => ({ ...correspondance, champs: changements(correspondance) }))
    .filter((correspondance) => correspondance.champs.length);

  console.log(`${v6.length} compétences V6 appariées aux codes permanents`);
  console.log(`${aMettreAJour.length} pages à mettre à jour · ${aDesactiver.length} page à désactiver`);
  for (const { ancien, champs } of aMettreAJour) console.log(`  ${ancien.code} : ${champs.join(', ')}`);
  for (const page of aDesactiver) console.log(`  ${texte(page, 'Code')} : Actif=false`);
  if (!APPLIQUER) {
    console.log('Simulation terminée. Relancer avec APPLIQUER=1 pour écrire dans Notion.');
    return;
  }

  for (const { item, page } of aMettreAJour) {
    await notion.pages.update({
      page_id: page.id,
      properties: {
        Name: titre(item.enonce),
        Description: riche(item.enonce),
        'Énoncé N1': riche(item.enonce),
        Marqueurs: riche(item.marqueurs),
        Revue: { select: { name: item.revue } },
        Difficulté: { select: { name: item.difficulte } },
        Ordre: { number: item.order },
        Actif: { checkbox: true },
      },
    });
    await attendre(350);
  }
  for (const page of aDesactiver) {
    await notion.pages.update({ page_id: page.id, properties: { Actif: { checkbox: false } } });
  }
  console.log('Synchronisation V6 terminée.');
}

principal().catch((erreur) => {
  console.error('ÉCHEC :', erreur.message);
  process.exit(1);
});
