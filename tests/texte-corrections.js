// Vérifie les fonctions pures de scripts/texte/proposer-corrections.js sur des
// marqueurs en mémoire : ni Notion, ni fichier extrait. Ce sont elles qui décident du
// texte réellement écrit dans le référentiel, un test rapide vaut mieux qu'une
// relecture du diff à chaque passe.

const assert = require('node:assert/strict');
const {
  corrigerFautes,
  corrigerTexte,
  normaliserPonctuation,
  normaliserAsterisques,
  proposerChamp,
  construirePropositions,
  resumer,
} = require('../scripts/texte/proposer-corrections.js');

// 1. Une faute remontée par la recette est corrigée là où elle se trouve.
assert.equal(
  corrigerFautes('• Vous savez aller interroger votre marcé afin de comprendre les enjeux.'),
  '• Vous savez aller interroger votre marché afin de comprendre les enjeux.',
);
assert.equal(
  corrigerFautes('Je sais mesurer le volume et la qualité des leads générées par chaque canal.'),
  'Je sais mesurer le volume et la qualité des leads générés par chaque canal.',
);

// 2. Une puce sans point final en reçoit un, la puce garde sa forme « • ».
assert.equal(
  normaliserPonctuation('• Tu as une série de questions'),
  '• Tu as une série de questions.',
);
// Une parenthèse fermante ne tient pas lieu de point : c'est là que les points
// manquaient le plus souvent dans le référentiel.
assert.equal(
  normaliserPonctuation('• Tu as différents tarifs (junior, manager, dirigeant)'),
  '• Tu as différents tarifs (junior, manager, dirigeant).',
);
// Amorce parasite « • . » et espaces doubles laissés dans le texte source.
assert.equal(
  normaliserPonctuation('• . Tu vérifies  que  l\'objectif est concret.'),
  "• Tu vérifies que l'objectif est concret.",
);
// Les « mots clés » prennent le trait d'union partout.
assert.equal(
  normaliserPonctuation('• Tu sais percevoir les mots clés du narratif.'),
  '• Tu sais percevoir les mots-clés du narratif.',
);

// 3. Un marqueur déjà correct traverse la chaîne sans être modifié.
const dejaCorrect = '• Le client est traité en acteur : il choisit, propose, conteste.\n'
  + '• Chaque acteur comprend ce qui peut être partagé et ce qui reste confidentiel.';
assert.equal(corrigerFautes(dejaCorrect), dejaCorrect);
assert.equal(normaliserPonctuation(dejaCorrect), dejaCorrect);
assert.equal(proposerChamp('markers', dejaCorrect, null), dejaCorrect);

// 4. Chaîne complète : la version tutoyée fournie l'emporte sur le texte d'origine, et
// les tables passent quand même derrière pour rattraper ce qu'elle aurait laissé.
assert.equal(
  proposerChamp('markers', '• Vous savez interroger votre marcé', '• Tu sais interroger ton marcé'),
  '• Tu sais interroger ton marché.',
);

// 5. Les propositions portent le code, le champ et des motifs explicites.
const competences = [
  {
    code: 'ACT-03-01',
    pageId: 'page-1',
    theme: 'Comprendre un marché',
    name: 'Je sais interroger mon marché.',
    statement: 'Je sais interroger mon marché.',
    description: 'Je sais interroger mon marché.',
    markers: '• Vous savez aller interroger votre marcé',
  },
  {
    code: 'ENT-01-02',
    pageId: 'page-2',
    theme: 'Éthique et cadre en entreprise',
    name: 'Je sais poser un cadre.',
    statement: 'Je sais poser un cadre.',
    description: 'Je sais poser un cadre.',
    markers: '• Chaque acteur comprend ce qui reste confidentiel.',
  },
];
const propositions = construirePropositions(competences, {
  'ACT-03-01': '• Tu sais aller interroger ton marcé',
});
assert.equal(propositions.length, 1);
assert.equal(propositions[0].code, 'ACT-03-01');
assert.equal(propositions[0].champ, 'markers');
assert.equal(propositions[0].apres, '• Tu sais aller interroger ton marché.');
assert.deepEqual(propositions[0].motifs.sort(), ['faute', 'ponctuation', 'tutoiement']);

const resume = resumer(propositions);
assert.equal(resume.competencesTouchees, 1);
assert.equal(resume.champsModifies, 1);
assert.deepEqual(resume.parChamp, { markers: 1 });

// 6. L'astérisque de renvoi au lexique se replace après le mot entier.
assert.equal(normaliserAsterisques('équilibrer et bascule*r, ancrer*'), 'équilibrer et basculer*, ancrer*');
assert.equal(normaliserAsterisques('vous ancre*z le rêve'), 'vous ancrez* le rêve');
assert.equal(normaliserAsterisques('un fil* et un domino*'), 'un fil* et un domino*');

// 7. Termes flous et anglicismes : substitutions arbitrées, sans toucher au reste.
assert.equal(
  corrigerTexte('• Tu peux citer une séance récente où tu as utilisé cette technique.'),
  '• Tu peux citer une séance récente (moins de 3 mois) où tu as utilisé cette technique.',
);
// Déjà précisé : la substitution ne s'applique pas deux fois.
assert.equal(
  corrigerTexte('• Une séance récente (moins de 3 mois) suffit.'),
  '• Une séance récente (moins de 3 mois) suffit.',
);
assert.equal(
  corrigerTexte('ma capacité de delivery et mon modèle économique'),
  'ma capacité de prestation et mon modèle économique',
);
assert.equal(
  corrigerTexte('• Dans un enregistrement, tu reprends les mots du client.'),
  '• En réécoutant une séance, tu reprends les mots du client.',
);

console.log('Corrections de texte du référentiel : OK');
