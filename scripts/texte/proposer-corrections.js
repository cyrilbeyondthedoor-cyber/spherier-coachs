// Construit les propositions de correction du référentiel, SANS rien écrire dans
// Notion. Trois sources se combinent, dans cet ordre :
//
//   1. `tutoiement.json` — les marqueurs réécrits au tutoiement, relus un par un.
//   2. les tables de fautes ci-dessous — corrections d'orthographe et de formulation.
//   3. la normalisation de ponctuation des puces.
//
// Sortie : `propositions.json` (exploitable par appliquer-corrections.js) et
// `propositions.md` (relecture humaine). Aucun des deux n'est versionné.
//
//   node scripts/texte/proposer-corrections.js
//
// Les fonctions pures sont exportées : `tests/texte-corrections.js` les exerce sur des
// marqueurs en mémoire, sans Notion ni fichier extrait.

const fs = require('node:fs');
const path = require('node:path');

const DOSSIER = __dirname;
const CHAMPS = ['name', 'statement', 'description', 'markers', 'difficulte'];

// Fautes relevées lors de la recette de la version testeurs. Les motifs sont écrits sur
// le texte d'origine (au vouvoiement) ET, quand la faute survit à la réécriture, sur sa
// forme tutoyée : le passage au « tu » est appliqué avant, la correction doit mordre
// dans les deux cas plutôt que de dépendre de l'ordre.
const FAUTES_SIGNALEES = [
  [/marcé/g, 'marché'],
  [/Vous positionnement/g, 'Votre positionnement'],
  [/leads générées/g, 'leads générés'],
  [/ventes généréees/g, 'ventes générées'],
  [/sa(vez|is) calculez/g, 'sa$1 calculer'],
  [/\(ex :témoignages\)/g, '(ex : témoignages)'],
  [/ceux auquel (vous savez|tu sais) répondre/g, 'ceux auxquels $1 répondre'],
  [/sa(vez|is) formulez/g, 'sa$1 formuler'],
  [/sa(vez|is) enchaînez/g, 'sa$1 enchaîner'],
  [/call découvert en fonction/g, 'call découverte en fonction'],
  [/transparant/g, 'transparent'],
  [/avec de créer un lien/g, 'afin de créer un lien'],
  [/capitliser/g, 'capitaliser'],
  [/différentes prestation en entreprise/g, 'différentes prestations en entreprise'],
  [/claire pour (votre cliente|ta cliente)\./g, 'claire pour ton client.'],
  [/(restez|restes) ancrée/g, '$1 ancré'],
  [/Vous avec des stratégies/g, 'Vous avez des stratégies'],
  [/projetctions/g, 'projections'],
  [/réaigir/g, 'réagir'],
  [/légereté/g, 'légèreté'],
  [/qu'on qu'on comprend/g, "qu'on comprend"],
  [/ce qui ce joue/g, 'ce qui se joue'],
  [/exploraration/g, 'exploration'],
  [/^• vous êtes capables de lier/gm, '• Vous êtes capables de lier'],
  [/etc\)/g, 'etc.)'],
  [/(êtes|es) capables de nommer/g, '$1 capable de nommer'],
  [/questions introspective\b/g, 'questions introspectives'],
  [/vision de monde/g, 'vision du monde'],
  [/, paradoxe\*, incoéhrence…\)/g, ', paradoxe*…)'],
  [/émotionnelement/g, 'émotionnellement'],
  [/en pratique délibérées dans ma pratique/g, 'en pratiques délibérées'],
  [/vous vous fixer une pratique/g, 'vous vous fixez une pratique'],
  [/l'enjeux\b/g, "l'enjeu"],
  [/son enjeux de départ/g, 'son enjeu de départ'],
  [/à toute les séances/g, 'à toutes les séances'],
  [/sais creusez au délà/g, 'sais creuser au-delà'],
  [/manière douce de cloturer/g, 'manière douce de clôturer'],
  [/savoir si il a tout/g, "savoir s'il a tout"],
  [/tu as intégrer des éléments créatifs/g, 'tu as intégré des éléments créatifs'],
  [/cette décisision/g, 'cette décision'],
  // Signalements de formulation, hors table de fautes.
  [/de manière embarquante mon expérience, les étapes/g, 'de manière engageante mon parcours, les étapes'],
  [/au service de mon client au sein du programme\./g, 'au service de mon client.'],
  [/structurer de manière efficace une manière de prendre du recul/g, 'structurer efficacement un temps de recul'],
  [/plusieurs fils\* et piste avant de resserer sur celle qui paraît le plus pertinent pour le client/g,
    'plusieurs fils* et pistes avant de resserrer sur la plus pertinente pour le client'],
  [/,? l’intersection de ma vision$/g, '.'],
  [/\(exploration, bascule\*, clôture\), et je n'improvise pas$/g,
    "(exploration, bascule*, clôture), et je n'improvise pas."],
];

// Fautes non remontées par la recette, repérées en relisant les 192 compétences.
// Elles sont comptées à part pour que la relecture puisse les accepter ou les refuser
// indépendamment de la liste d'origine.
const FAUTES_HORS_LISTE = [
  [/procéssus/g, 'processus'],
  [/quelque soit le profil/g, 'quel que soit le profil'],
  [/qu'l se sent/g, "qu'il se sent"],
  [/précédée ou suivi d'une justification/g, "précédée ou suivie d'une justification"],
  [/vis à vis/g, 'vis-à-vis'],
  [/situations relevent/g, 'situations relèvent'],
  [/maitrise une panoplie/g, 'maîtrise une panoplie'],
  [/une seconde voir une troisième/g, 'une seconde voire une troisième'],
  [/ton clien\b/g, 'ton client'],
  [/désagrable/g, 'désagréable'],
  [/sous formes de questions/g, 'sous forme de questions'],
  [/identiifer/g, 'identifier'],
  [/un sujet difficiles/g, 'un sujet difficile'],
  [/introspéctive/g, 'introspective'],
  [/les règles qui a éclaire/g, 'les règles qui éclairent'],
  [/d'unemplacement centralisé/g, "d'un emplacement centralisé"],
  [/clarté mental\b/g, 'clarté mentale'],
  [/t'appuyes dessus/g, "t'appuies dessus"],
  [/une processus éprouvé/g, 'un processus éprouvé'],
  [/qu 'il apporte/g, "qu'il apporte"],
  [/qu'il n'avait pas identifié avant la séance/g, "qu'il n'avait pas identifiée avant la séance"],
  [/le developpement d'un être humain/g, "le développement d'un être humain"],
  [/des exemples ou tu ne t'es pas laissé/g, "des exemples où tu ne t'es pas laissé"],
];

// Termes flous et anglicismes, arbitrés par le propriétaire. Ils ne relèvent pas de la
// faute : le texte est correct, il est seulement imprécis ou emprunté à l'anglais.
const SUBSTITUTIONS = [
  // Repères de temps : « récent » ne dit rien de vérifiable.
  [/\b(séance|métaphore) récente(?! \(moins)/g, '$1 récente (moins de 3 mois)'],
  [/\b(moment|cas) récent(?! \(moins)/g, '$1 récent (moins de 3 mois)'],
  [/très régulièrement/g, 'au moins une fois par trimestre'],
  [/une formulation type/g, "une formulation prête à l'emploi"],
  [/de faire de la psychoéducation en séance/g, "d'expliquer la théorie en séance"],
  [/après l'outil/g, "à l'issue de l'exercice"],
  [/Dans un enregistrement,/g, 'En réécoutant une séance,'],
  [/Dans une séance enregistrée,/g, 'En réécoutant une séance,'],
  [/Sur un enregistrement,/g, 'En réécoutant une séance,'],
  [/le vérifier sur un enregistrement/g, 'le vérifier en réécoutant une séance'],
  // Anglicismes traduits. « call découverte », « hook », « farming » et « lead magnet »
  // restent : ce sont les mots employés sur le terrain, ils sont définis au lexique.
  [/Je sais concevoir un surdelivery intentionnel qui augmente la valeur/g,
    'Je sais sur-délivrer intentionnellement pour augmenter la valeur'],
  [/Chaque élément de surdelivery répond/g, 'Chaque élément sur-délivré répond'],
  [/faire du surdelivery/g, 'sur-délivrer'],
  [/qualité du delivery/g, 'qualité de la prestation'],
  [/capacité de delivery/g, 'capacité de prestation'],
  [/au delivery/g, 'à la prestation'],
  [/le delivery/g, 'la prestation'],
  [/du delivery/g, 'de la prestation'],
  [/\bdelivery\b/g, 'prestation'],
  [/, timing,/g, ', moment,'],
  [/onboarding sans couture/g, 'intégration fluide'],
  [/et onboarding\./g, 'et intégration.'],
  [/\bonboarding\b/g, 'intégration'],
  // Un marqueur n'a pas à renvoyer à la séance de formation où l'exemple a été donné.
  [/\(exemple donné en atelier : /g, '('],
];

// Difficulté revue : une compétence qui repose sur un outil ou une grille propre à une
// approche relève du niveau avancé. Les autres compétences de ce type (ennéagramme,
// niveaux d'être, Dilts, Ken Wilber, IFS) y sont déjà.
const DIFFICULTES_REVUES = {
  // Le marqueur « tu ne coaches pas un client dont le niveau d'être ou de réflexion
  // dépasse le tien » applique une limite au sens de Flaherty.
  'FON-02-01': 'A-player',
};

// L'astérisque de renvoi au lexique se place après le mot entier : « basculer* », jamais
// « bascule*r », sans quoi le mot se coupe en deux à l'écran et le renvoi tombe à côté.
function normaliserAsterisques(texte) {
  return String(texte).replace(/([A-Za-zÀ-ÖØ-öø-ÿ]+)\*([A-Za-zÀ-ÖØ-öø-ÿ]+)/g, '$1$2*');
}

function appliquerTable(texte, table) {
  return table.reduce((acc, [motif, remplacement]) => acc.replace(motif, remplacement), texte);
}

function corrigerFautes(texte) {
  return appliquerTable(appliquerTable(texte, FAUTES_SIGNALEES), FAUTES_HORS_LISTE);
}

function corrigerTexte(texte) {
  return normaliserAsterisques(appliquerTable(corrigerFautes(texte), SUBSTITUTIONS));
}

function tableTouche(texte, table) {
  return table.some(([motif]) => {
    motif.lastIndex = 0;
    return motif.test(texte);
  });
}

// Ponctuation des marqueurs : une puce « • » suivie d'une espace, une phrase par puce,
// chacune terminée par un point. Le point final manquait sur 78 des 800 puces, ce qui
// se voyait à l'écran puisque les marqueurs s'affichent les uns sous les autres.
function normaliserPonctuation(texte) {
  return String(texte)
    .split('\n')
    .map((ligne) => {
      let l = ligne.replace(/\s+$/, '');
      if (!l.trim()) return '';
      // Puces hétérogènes et amorces parasites (« • . Tu vérifies… »).
      l = l.replace(/^\s*[•*–-]\s*\.?\s*/, '• ');
      l = l.replace(/ {2,}/g, ' ');
      l = l.replace(/\bmots clés\b/g, 'mots-clés').replace(/\bmot clé\b/g, 'mot-clé');
      // Seuls le point, l'exclamation, l'interrogation et les points de suspension
      // ferment une puce : une parenthèse ou un guillemet fermants n'en tiennent pas
      // lieu, et c'est exactement là que les points manquaient.
      if (!/[.!?…]$/.test(l)) l += '.';
      return l;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function motifs({ champ, avant, apres, tutoye }) {
  const liste = [];
  if (champ === 'difficulte') return ['difficulte'];
  if (tableTouche(avant, FAUTES_SIGNALEES)) liste.push('faute');
  if (tableTouche(avant, FAUTES_HORS_LISTE)) liste.push('faute-hors-liste');
  if (tableTouche(avant, SUBSTITUTIONS)) liste.push('substitution');
  if (normaliserAsterisques(avant) !== avant) liste.push('asterisque');
  if (champ === 'markers' && tutoye) liste.push('tutoiement');
  if (normaliserPonctuation(avant) !== avant && champ === 'markers') liste.push('ponctuation');
  if (liste.length === 0 && avant !== apres) liste.push('reformulation');
  return liste;
}

// Texte proposé pour un champ. Les marqueurs passent d'abord par leur version tutoyée
// quand elle existe, puis par les mêmes tables que les autres champs : une faute que la
// réécriture aurait laissée passer est ainsi rattrapée.
function proposerChamp(champ, valeur, tutoiement) {
  const base = champ === 'markers' && tutoiement ? tutoiement : valeur;
  const corrige = corrigerTexte(base);
  return champ === 'markers' ? normaliserPonctuation(corrige) : corrige.trim();
}

function construirePropositions(competences, tutoiements) {
  const propositions = [];
  for (const competence of competences) {
    for (const champ of CHAMPS) {
      const avant = competence[champ] || '';
      if (!avant) continue;
      const tutoye = champ === 'markers' ? tutoiements[competence.code] : null;
      const apres = champ === 'difficulte'
        ? (DIFFICULTES_REVUES[competence.code] || avant)
        : proposerChamp(champ, avant, tutoye);
      if (apres === avant) continue;
      propositions.push({
        code: competence.code,
        pageId: competence.pageId,
        theme: competence.theme,
        champ,
        avant,
        apres,
        motifs: motifs({ champ, avant, apres, tutoye: Boolean(tutoye) && tutoye !== avant }),
      });
    }
  }
  return propositions;
}

function resumer(propositions) {
  const parChamp = {};
  const parMotif = {};
  const codes = new Set();
  for (const p of propositions) {
    codes.add(p.code);
    parChamp[p.champ] = (parChamp[p.champ] || new Set()).add(p.code);
    for (const motif of p.motifs) parMotif[motif] = (parMotif[motif] || new Set()).add(p.code);
  }
  const compter = (registre) => Object.fromEntries(
    Object.entries(registre).map(([cle, set]) => [cle, set.size]).sort((a, b) => b[1] - a[1]),
  );
  return {
    competencesTouchees: codes.size,
    champsModifies: propositions.length,
    parChamp: compter(parChamp),
    parMotif: compter(parMotif),
  };
}

// Diff ligne à ligne, suffisant ici : les marqueurs sont des listes de puces et les
// énoncés tiennent sur une ligne, un diff par mot n'apporterait rien à la relecture.
function diffLisible(avant, apres) {
  const a = avant.split('\n');
  const b = apres.split('\n');
  const lignes = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    if (a[i] === b[i]) { if (a[i] !== undefined) lignes.push(`  ${a[i]}`); continue; }
    if (a[i] !== undefined) lignes.push(`- ${a[i]}`);
    if (b[i] !== undefined) lignes.push(`+ ${b[i]}`);
  }
  return lignes.join('\n');
}

function ecrireMarkdown(propositions, resume, chemin) {
  const parCode = new Map();
  for (const p of propositions) parCode.set(p.code, (parCode.get(p.code) || []).concat(p));
  const blocs = [...parCode.entries()].map(([code, liste]) => {
    const corps = liste.map((p) => [
      `**${p.champ}** — motifs : ${p.motifs.join(', ')}`,
      '',
      '```diff',
      diffLisible(p.avant, p.apres),
      '```',
    ].join('\n')).join('\n\n');
    return `## ${code} — ${liste[0].theme}\n\n${corps}`;
  });
  const entete = [
    '# Propositions de correction du référentiel',
    '',
    'Rien n’est écrit dans Notion à ce stade. Ce document sert à la relecture.',
    '',
    `- Compétences touchées : **${resume.competencesTouchees}** sur 192`,
    `- Champs modifiés : **${resume.champsModifies}**`,
    `- Par champ : ${Object.entries(resume.parChamp).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `- Par motif : ${Object.entries(resume.parMotif).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    '',
  ].join('\n');
  fs.writeFileSync(chemin, `${entete}\n${blocs.join('\n\n')}\n`, 'utf8');
}

function principal() {
  const competences = JSON.parse(
    fs.readFileSync(path.join(DOSSIER, 'competences.json'), 'utf8').normalize('NFC'),
  );
  const tutoiements = JSON.parse(
    fs.readFileSync(path.join(DOSSIER, 'tutoiement.json'), 'utf8').normalize('NFC'),
  );
  const manquants = competences.filter((c) => !tutoiements[c.code]).map((c) => c.code);
  if (manquants.length) throw new Error(`Marqueurs tutoyés manquants : ${manquants.join(', ')}`);

  const propositions = construirePropositions(competences, tutoiements);
  const resume = resumer(propositions);
  fs.writeFileSync(
    path.join(DOSSIER, 'propositions.json'),
    `${JSON.stringify({ resume, propositions }, null, 2)}\n`,
    'utf8',
  );
  ecrireMarkdown(propositions, resume, path.join(DOSSIER, 'propositions.md'));
  console.log(`${resume.competencesTouchees} compétences touchées, ${resume.champsModifies} champs modifiés`);
  console.log('par champ :', resume.parChamp);
  console.log('par motif :', resume.parMotif);
}

module.exports = {
  corrigerFautes, corrigerTexte, normaliserPonctuation, normaliserAsterisques,
  proposerChamp, construirePropositions, resumer,
};

if (require.main === module) {
  try {
    principal();
  } catch (erreur) {
    console.error('ÉCHEC :', erreur.message);
    process.exit(1);
  }
}
