// Produit les deux documents d'arbitrage humain du référentiel :
//
//   scripts/texte/doublons.md                 — compétences signalées comme redondantes
//   scripts/texte/marqueurs-non-observables.md — marqueurs qui énoncent un résultat
//
// Rien n'est modifié ni proposé ici : ces fichiers servent à décider. Les regroupements
// viennent des retours de recette, repérés par leur position dans le parcours d'audit.
//
//   node scripts/texte/documenter-arbitrages.js

const fs = require('node:fs');
const path = require('node:path');

const DOSSIER = __dirname;

// Signalements de redondance. Chaque groupe cite les compétences côte à côte : la
// décision de fusionner, de préciser ou de garder les deux appartient au propriétaire.
const GROUPES_DOUBLONS = [
  {
    titre: '54 vs 55 — même niveau ?',
    signalement: 'Un testeur juge ces deux compétences de même niveau. Elles portent aujourd’hui deux difficultés différentes. Aucune reformulation proposée à ce stade.',
    codes: ['TRA-02-03', 'TRA-02-04'],
  },
  {
    titre: '53 et 55 — la première serait incluse dans la seconde',
    signalement: 'Les deux portent sur la construction de l’axe de travail du programme.',
    codes: ['TRA-02-02', 'TRA-02-04'],
  },
  {
    titre: '133 et les compétences antérieures sur le refus',
    signalement: 'Refuser ou réorienter une demande apparaît trois fois, dans deux dimensions différentes.',
    codes: ['ACT-06-03', 'FON-02-01', 'FON-02-02'],
  },
  {
    titre: '145 et les premières compétences sur l’éthique',
    signalement: 'Le cadre éthique en entreprise recouvre en partie le cadre et la déontologie posés au niveau fondamental.',
    codes: ['ENT-01-01', 'FON-01-03', 'FON-01-04'],
  },
  {
    titre: '176 et les compétences antérieures sur le silence',
    signalement: 'Le silence fait l’objet de trois compétences, dans trois dimensions.',
    codes: ['ETR-02-12', 'COM-03-01', 'ETR-02-08'],
  },
  {
    titre: '177 et la compétence antérieure sur l’impertinence',
    signalement: 'L’impertinence fait l’objet de deux compétences aux énoncés très proches.',
    codes: ['ETR-02-13', 'TRA-03-11'],
  },
];

// Signalement séparé : l'énoncé et le premier marqueur disent la même chose.
const TITRE_REPETE_DANS_MARQUEUR = ['TRA-01-16'];

function chargerJson(nom) {
  return JSON.parse(fs.readFileSync(path.join(DOSSIER, nom), 'utf8').normalize('NFC'));
}

// Texte tel qu'il sera dans Notion si les propositions sont appliquées : c'est sur ce
// texte-là qu'il faut arbitrer, pas sur la version fautive encore en ligne.
function versionProposee(competences, propositions) {
  const parCode = new Map(competences.map((c) => [c.code, { ...c }]));
  for (const p of propositions) {
    const c = parCode.get(p.code);
    if (c) c[p.champ] = p.apres;
  }
  return parCode;
}

function bloc(c) {
  return [
    `### ${c.code} — position ${c.position} — ${c.difficulte}`,
    '',
    `*${c.theme}*`,
    '',
    `**Énoncé.** ${c.name}`,
    '',
    '**Marqueurs.**',
    '',
    c.markers.split('\n').filter(Boolean).map((l) => l.replace(/^•\s*/, '- ')).join('\n'),
  ].join('\n');
}

function ecrireDoublons(parCode) {
  const sections = GROUPES_DOUBLONS.map((groupe) => {
    const blocs = groupe.codes.map((code) => {
      const c = parCode.get(code);
      if (!c) throw new Error(`Code inconnu dans GROUPES_DOUBLONS : ${code}`);
      return bloc(c);
    });
    return `## ${groupe.titre}\n\n${groupe.signalement}\n\n${blocs.join('\n\n')}`;
  });
  const entete = [
    '# Compétences signalées comme redondantes',
    '',
    'Document d’arbitrage. Rien n’a été fusionné, réécrit ni supprimé : chaque groupe',
    'rassemble les compétences citées, avec leur position dans le parcours d’audit, leur',
    'difficulté, leur énoncé et leurs marqueurs complets, pour décider sur pièces.',
    '',
    'Les textes sont ceux que `proposer-corrections.js` propose d’écrire dans Notion,',
    'corrections et tutoiement compris.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(DOSSIER, 'doublons.md'), `${entete}\n${sections.join('\n\n')}\n`, 'utf8');
  return sections.length;
}

// Un marqueur où le coach n'apparaît ni comme sujet, ni comme complément, ni par un
// possessif, ne décrit aucune action de sa part : il énonce un résultat chez le client,
// un critère de qualité ou un état de la relation. Observable, peut-être, mais pas
// imputable à un comportement du coach. Les marqueurs formulés sur sa pratique
// (« Tes questions restent courtes ») restent hors de cette liste.
function sansActionDuCoach(ligne) {
  return !/(^|[^a-zà-ÿ])(tu|te|toi|ton|ta|tes|t['’])([^a-zà-ÿ]|$)/i.test(ligne);
}

function ecrireNonObservables(parCode, competences) {
  const entrees = [];
  for (const source of competences) {
    const c = parCode.get(source.code);
    for (const ligne of c.markers.split('\n')) {
      const texte = ligne.replace(/^•\s*/, '').trim();
      if (!texte || !sansActionDuCoach(texte)) continue;
      const sujet = texte.split(/[\s,:;]/).slice(0, 3).join(' ');
      entrees.push({
        code: c.code,
        position: c.position,
        theme: c.theme,
        texte,
        pourquoi: `Aucune action du coach n’est décrite : le marqueur porte sur « ${sujet}… » et énonce un résultat ou un critère.`,
      });
    }
  }
  const repetes = TITRE_REPETE_DANS_MARQUEUR.map((code) => {
    const c = parCode.get(code);
    return [
      `### ${c.code} — position ${c.position}`,
      '',
      `**Énoncé.** ${c.name}`,
      '',
      `**Premier marqueur.** ${c.markers.split('\n')[0].replace(/^•\s*/, '')}`,
      '',
      'Le marqueur reformule l’énoncé sans rien ajouter d’observable.',
    ].join('\n');
  });

  const lignes = entrees
    .sort((a, b) => a.position - b.position)
    .map((e) => `| ${e.position} | ${e.code} | ${e.texte.replace(/\|/g, '\\|')} | ${e.pourquoi} |`);

  const contenu = [
    '# Marqueurs qui énoncent un résultat',
    '',
    'Document d’arbitrage. Ces marqueurs n’ont **pas** été réécrits : ils décrivent un',
    'résultat chez le client, un état de la relation ou un critère de qualité, là où les',
    'autres marqueurs décrivent un comportement du coach.',
    '',
    `Repérage : le coach n'apparaît dans le marqueur ni comme sujet, ni comme complément, ni par un possessif. ${entrees.length} marqueurs sur `
      + `${competences.reduce((n, c) => n + parCode.get(c.code).markers.split('\n').filter(Boolean).length, 0)}.`,
    '',
    '| Position | Code | Marqueur | Pourquoi il est listé |',
    '|---|---|---|---|',
    ...lignes,
    '',
    '## Énoncé répété dans son propre marqueur',
    '',
    ...repetes,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(DOSSIER, 'marqueurs-non-observables.md'), contenu, 'utf8');
  return entrees.length;
}

function principal() {
  const competences = chargerJson('competences.json');
  const { propositions } = chargerJson('propositions.json');
  const parCode = versionProposee(competences, propositions);
  const groupes = ecrireDoublons(parCode);
  const marqueurs = ecrireNonObservables(parCode, competences);
  console.log(`doublons.md : ${groupes} groupes`);
  console.log(`marqueurs-non-observables.md : ${marqueurs} marqueurs`);
}

if (require.main === module) {
  try {
    principal();
  } catch (erreur) {
    console.error('ÉCHEC :', erreur.message);
    process.exit(1);
  }
}
