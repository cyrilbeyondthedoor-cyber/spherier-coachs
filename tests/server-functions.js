const assert = require('node:assert/strict');

process.env.N8N_SPHERIER_WEBHOOK_URL = 'https://n8n.example/webhook';
process.env.N8N_SPHERIER_WEBHOOK_SECRET = 'secret-test';
process.env.PUBLIC_SITE_URL = 'https://spherier.example';

const UUID = '11111111-1111-4111-8111-111111111111';
const pages = new Map();
const misesAJour = [];
let appelsN8n = [];

const prospectsPath = require.resolve('../prospects-notion.js');
require.cache[prospectsPath] = {
  id: prospectsPath,
  filename: prospectsPath,
  loaded: true,
  exports: {
    morceaux: (texte) => texte ? [{ type: 'text', text: { content: texte } }] : [],
    obtenirOuCreerProspect: async ({ prenom, email }) => {
      if (!pages.has(email)) pages.set(email, { prenom, uuid: UUID, lien: `https://spherier.example/?c=${UUID}` });
      const prospect = pages.get(email);
      return { pageId: 'page-1', ...prospect, nouveau: pages.size === 1 };
    },
    trouverProspectParUuid: async (uuid) => uuid === UUID ? { id: 'page-1', properties: {} } : null,
    mettreAJourProspect: async (pageId, properties) => { misesAJour.push({ pageId, properties }); },
  },
};

global.fetch = async (url, options) => {
  appelsN8n.push({ url, options, body: JSON.parse(options.body) });
  return { ok: true, status: 202 };
};

const { handler: acces } = require('../netlify/functions/access.js');

async function testerAcces() {
  const invalide = await acces({ httpMethod: 'POST', body: JSON.stringify({ prenom: '', email: 'x', consentement: false }) });
  assert.equal(invalide.statusCode, 400);

  // Sans dureeMs, la demande est traitée comme un robot : 202 silencieux, aucun appel n8n.
  const sansDuree = await acces({ httpMethod: 'POST', body: JSON.stringify({ prenom: 'Bot', email: 'bot@example.com', consentement: true }) });
  assert.equal(sansDuree.statusCode, 202);
  assert.equal(appelsN8n.length, 0, 'un corps sans dureeMs ne doit pas atteindre n8n');

  const corps = { prenom: 'Camille', email: 'Camille@Example.com', consentement: true, source: 'webinaire', dureeMs: 2500 };
  const premier = await acces({ httpMethod: 'POST', body: JSON.stringify(corps) });
  const second = await acces({ httpMethod: 'POST', body: JSON.stringify(corps) });
  assert.equal(premier.statusCode, 202);
  assert.equal(second.statusCode, 202);
  assert.equal(appelsN8n.length, 2);
  assert.equal(appelsN8n[0].body.uuid, UUID);
  assert.equal(appelsN8n[1].body.uuid, UUID);
  assert.equal(appelsN8n[0].options.headers['x-spherier-secret'], 'secret-test');

  const avantPiege = appelsN8n.length;
  const piege = await acces({ httpMethod: 'POST', body: JSON.stringify({ ...corps, website: 'robot.example' }) });
  assert.equal(piege.statusCode, 202);
  assert.equal(appelsN8n.length, avantPiege);
}

const referentielPath = require.resolve('../referentiel-v2.js');
require.cache[referentielPath] = {
  id: referentielPath,
  filename: referentielPath,
  loaded: true,
  exports: {
    getReferentielV2: async () => ({
      competencies: [
        { id: 'FON-01-01', name: 'Poser le cadre' },
        { id: 'ALL-01-01', name: 'Créer la confiance' },
        { id: 'COM-01-01', name: 'Écouter avec précision' },
      ],
    }),
  },
};

const { handler: evenement } = require('../netlify/functions/prospect-event.js');

async function testerEvenements() {
  const started = await evenement({ httpMethod: 'POST', body: JSON.stringify({ uuid: UUID, type: 'started' }) });
  assert.equal(started.statusCode, 204);
  assert.ok(misesAJour.at(-1).properties['Audit commencé le']);

  const progress = await evenement({
    httpMethod: 'POST',
    body: JSON.stringify({
      uuid: UUID,
      type: 'progress',
      progression: 1,
      priorites: ['FON-01-01', 'ALL-01-01', 'INCONNU'],
    }),
  });
  assert.equal(progress.statusCode, 204);
  const proprietes = misesAJour.at(-1).properties;
  assert.equal(proprietes['Progression audit'].number, 1);
  assert.ok(proprietes['Audit terminé le']);
  assert.equal(proprietes['Priorité 1'].rich_text[0].text.content, 'FON-01-01 — Poser le cadre');
  assert.deepEqual(proprietes['Priorité 3'].rich_text, []);

  const agenda = await evenement({ httpMethod: 'POST', body: JSON.stringify({ uuid: UUID, type: 'agenda_clicked' }) });
  assert.equal(agenda.statusCode, 204);
  assert.ok(misesAJour.at(-1).properties['Agenda cliqué le']);
}

const { validerEtNormaliser, composerEtat } = require('../snapshot-v2.js');

// Référentiel minuscule et local : la validation ne dépend que des codes qu'on lui
// donne, inutile de faire tourner la lecture Notion pour l'éprouver.
const referentielAudit = {
  // Deux dimensions et trois thématiques : le minimum pour éprouver l'appartenance
  // d'un code à SA thématique et à SA dimension, que la validation des priorités vérifie.
  dimensions: [
    { id: 'FON', name: 'Fondations', category: 'COACH' },
    { id: 'ALL', name: 'Alliance', category: 'CLIENTS' },
  ],
  themes: [
    { id: 'theme-un', name: 'Thématique', dimension: 'Fondations', feeds: [] },
    { id: 'theme-deux', name: 'Seconde thématique', dimension: 'Fondations', feeds: [] },
    { id: 'theme-all', name: 'Thématique alliance', dimension: 'Alliance', feeds: [] },
  ],
  competencies: [
    { id: 'FON-01-01', theme: 'theme-un', name: 'Poser le cadre' },
    { id: 'FON-01-02', theme: 'theme-un', name: 'Tenir le cadre' },
    { id: 'FON-02-01', theme: 'theme-deux', name: 'Rendre le cadre lisible' },
    { id: 'ALL-01-01', theme: 'theme-all', name: 'Créer la confiance' },
  ],
};

const corpsDeBase = {
  uuid: UUID,
  referential_version: 1,
  levels: { 'FON-01-01': 2 },
  selections: { current: [], later: [] },
};

const valider = (audit) => validerEtNormaliser({
  referentiel: referentielAudit,
  corps: audit === undefined ? { ...corpsDeBase } : { ...corpsDeBase, audit },
});

async function testerAuditSnapshot() {
  // Un snapshot écrit avant l'audit modulaire reste valide : contexte vide, pas d'erreur.
  const sansAudit = valider(undefined);
  assert.deepEqual(sansAudit.erreurs, []);
  assert.deepEqual(sansAudit.blob.audit.passees, []);
  assert.equal(sansAudit.blob.audit.derniere, null);
  assert.ok(sansAudit.blob.audit.maj, 'la date de mise à jour est posée par le serveur');

  // Accepté, dédoublonné, repère de reprise conservé tel quel.
  const accepte = valider({
    passees: ['FON-01-02', 'FON-01-02'],
    derniere: { dimensionId: 'FON', themeId: 'theme-un', code: 'FON-01-01' },
  });
  assert.deepEqual(accepte.erreurs, []);
  assert.deepEqual(accepte.blob.audit.passees, ['FON-01-02']);
  assert.deepEqual(accepte.blob.audit.derniere, { dimensionId: 'FON', themeId: 'theme-un', code: 'FON-01-01' });

  // Un code absent du référentiel est refusé, pas filtré en silence.
  const inconnu = valider({ passees: ['ZZZ-99-99'] });
  assert.match(inconnu.erreurs.join(' '), /absents du référentiel/);

  // Borne dure : jamais plus de codes passés qu'il n'existe de compétences.
  const trop = valider({ passees: ['FON-01-01', 'FON-01-02', 'FON-02-01', 'ALL-01-01', 'FON-01-03'] });
  assert.ok(trop.erreurs.some((message) => /limité à 4 codes/.test(message)));

  // Mauvais type : refusé avant même de regarder les codes.
  const mauvaisType = valider({ passees: 'FON-01-01' });
  assert.match(mauvaisType.erreurs.join(' '), /tableau de codes/);
  const auditTableau = validerEtNormaliser({ referentiel: referentielAudit, corps: { ...corpsDeBase, audit: [] } });
  assert.match(auditTableau.erreurs.join(' '), /audit doit être un objet/);

  // Repère hors borne : abandonné, sans faire échouer l'enregistrement.
  const perime = valider({ passees: [], derniere: { dimensionId: 'x'.repeat(200), themeId: 'theme-un', code: 'FON-01-01' } });
  assert.deepEqual(perime.erreurs, []);
  assert.equal(perime.blob.audit.derniere, null);

  // Relecture : le contexte repart tel quel vers le navigateur, vide si le blob n'en a pas.
  const relu = composerEtat({ referentiel: referentielAudit, snapshot: { blob: accepte.blob } });
  assert.deepEqual(relu.audit.passees, ['FON-01-02']);
  assert.deepEqual(composerEtat({ referentiel: referentielAudit, snapshot: null }).audit.passees, []);
}

const validerPriorites = (priorites) => validerEtNormaliser({
  referentiel: referentielAudit,
  corps: { ...corpsDeBase, priorites },
});

async function testerPrioritesSnapshot() {
  // Champ absent : priorités vides, et les sélections envoyées passent telles quelles.
  const sans = validerEtNormaliser({ referentiel: referentielAudit, corps: { ...corpsDeBase, selections: { current: ['FON-01-01'], later: [] } } });
  assert.deepEqual(sans.erreurs, []);
  assert.deepEqual(sans.blob.priorites, { themes: {}, dimensions: {}, classement: [] });
  assert.deepEqual(sans.blob.selections.current, ['FON-01-01'], 'sans classement, les sélections envoyées font foi');

  // Accepté : trois par entrée au maximum, classement ordonné.
  const accepte = validerPriorites({
    themes: { 'theme-un': ['FON-01-01', 'FON-01-02'], 'theme-deux': ['FON-02-01'] },
    dimensions: { FON: ['FON-01-02', 'FON-02-01'], ALL: ['ALL-01-01'] },
    classement: ['ALL-01-01', 'FON-02-01', 'FON-01-02'],
  });
  assert.deepEqual(accepte.erreurs, []);
  assert.deepEqual(accepte.blob.priorites.dimensions.FON, ['FON-01-02', 'FON-02-01']);
  assert.deepEqual(accepte.blob.priorites.classement, ['ALL-01-01', 'FON-02-01', 'FON-01-02']);

  // Dérivation : les trois premières deviennent « maintenant », le reste « plus tard ».
  assert.deepEqual(accepte.blob.selections.current, ['ALL-01-01', 'FON-02-01', 'FON-01-02']);
  // FON-01-01 est une priorité de thématique non retenue au niveau dimension : elle
  // rejoint la file d'attente au lieu de disparaître.
  assert.deepEqual(accepte.blob.selections.later, ['FON-01-01']);

  // Quatrième dans le classement : elle bascule en « plus tard », pas en erreur.
  const quatre = validerPriorites({
    themes: {},
    dimensions: { FON: ['FON-01-01', 'FON-01-02', 'FON-02-01'], ALL: ['ALL-01-01'] },
    classement: ['FON-01-01', 'FON-01-02', 'FON-02-01', 'ALL-01-01'],
  });
  assert.deepEqual(quatre.erreurs, []);
  assert.deepEqual(quatre.blob.selections.current, ['FON-01-01', 'FON-01-02', 'FON-02-01']);
  assert.deepEqual(quatre.blob.selections.later, ['ALL-01-01']);

  // Un code inconnu est refusé, jamais filtré en silence.
  assert.match(validerPriorites({ themes: { 'theme-un': ['ZZZ-99-99'] } }).erreurs.join(' '), /absents du référentiel/);
  assert.match(validerPriorites({ classement: ['ZZZ-99-99'] }).erreurs.join(' '), /absents du référentiel/);

  // Un code rangé sous la mauvaise thématique ou la mauvaise dimension est refusé.
  assert.match(validerPriorites({ themes: { 'theme-un': ['FON-02-01'] } }).erreurs.join(' '), /n'en font pas partie/);
  assert.match(validerPriorites({ dimensions: { ALL: ['FON-01-01'] } }).erreurs.join(' '), /n'en font pas partie/);

  // Plus de trois par entrée : refusé. Le référentiel de base n'a que deux compétences
  // par thématique, on l'étend le temps de ce cas.
  const quatreDansUnTheme = validerEtNormaliser({
    referentiel: {
      ...referentielAudit,
      competencies: [...referentielAudit.competencies, { id: 'FON-01-03', theme: 'theme-un', name: 'Encore' }, { id: 'FON-01-04', theme: 'theme-un', name: 'Toujours' }],
    },
    corps: { ...corpsDeBase, priorites: { themes: { 'theme-un': ['FON-01-01', 'FON-01-02', 'FON-01-03', 'FON-01-04'] } } },
  });
  assert.match(quatreDansUnTheme.erreurs.join(' '), /limité à 3 compétences/);

  // Classement dédoublonné, et borné.
  const doublon = validerPriorites({ classement: ['FON-01-01', 'FON-01-01', 'FON-01-02'] });
  assert.deepEqual(doublon.blob.priorites.classement, ['FON-01-01', 'FON-01-02']);
  const long = validerPriorites({ classement: Array.from({ length: 101 }, () => 'FON-01-01') });
  assert.match(long.erreurs.join(' '), /limité à 100 codes/);

  // Mauvais types : refusés avant de regarder les codes.
  assert.match(validerPriorites([]).erreurs.join(' '), /priorites doit être un objet/);
  assert.match(validerPriorites({ themes: [] }).erreurs.join(' '), /priorites.themes doit être un objet/);
  assert.match(validerPriorites({ classement: 'FON-01-01' }).erreurs.join(' '), /tableau de codes/);

  // Relecture : la même dérivation s'applique, pour qu'un snapshot ancien relu
  // aujourd'hui donne le même « maintenant » qu'un snapshot écrit aujourd'hui.
  const relu = composerEtat({ referentiel: referentielAudit, snapshot: { blob: accepte.blob } });
  assert.deepEqual(relu.snapshot.blob.selections.current, ['ALL-01-01', 'FON-02-01', 'FON-01-02']);
  assert.deepEqual(relu.priorites.classement, ['ALL-01-01', 'FON-02-01', 'FON-01-02']);
  assert.deepEqual(composerEtat({ referentiel: referentielAudit, snapshot: null }).priorites.classement, []);
}

Promise.resolve()
  .then(testerAcces)
  .then(testerEvenements)
  .then(testerAuditSnapshot)
  .then(testerPrioritesSnapshot)
  .then(() => console.log('Fonctions accès, suivi prospect, contexte d\'audit et priorités : OK'))
  .catch((erreur) => {
    console.error(erreur);
    process.exit(1);
  });
