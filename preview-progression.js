// Local preview. All data is fictional and all writes remain in memory.
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { startFixture, referential } = require('./tests/progression-fixture');
const reference = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : referential;
startFixture(reference).then(({ url, snapshots }) => {
  const user = '00000000-0000-4000-8000-000000000001';
  const wished = ['COM-02-01', 'COM-03-01', 'FON-01-03'];
  const codes = wished.every(id => reference.competencies.some(c => c.id === id)) ? wished : reference.competencies.slice(0, 3).map(c => c.id);
  const practice = {
    [codes[0]]: { action: 'Poser une seule question à la fois, sans préambule.', situation: 'Ma prochaine séance de coaching.', evidence: 'Je repère une question que j’ai raccourcie et ce que le client en a fait.', observation: 'J’ai raccourci deux questions. La seconde a ouvert un nouvel angle de réflexion.' },
    [codes[1]]: { action: 'Laisser au client le temps de réfléchir avant de relancer.', situation: 'Un moment où le client cherche ses mots.', evidence: 'Noter ce qui se passe avant sa reprise de parole.', observation: 'Je repère plus vite mon envie de combler le silence.' },
    [codes[2]]: { action: 'Relire ensemble les modalités et recueillir les questions.', situation: 'Début d’un nouvel accompagnement.', evidence: 'Le client peut reformuler les points qui comptent pour lui.', observation: '' },
  };
  const point = (date, label, values, kind) => ({ id: randomUUID(), cree_le: date, libelle: label, blob: {
    referential_version: reference.version, kind, levels: Object.fromEntries(codes.map((c, i) => [c, values[i]])),
    selections: { current: codes, later: [] }, priorites: { themes: {}, dimensions: {}, classement: codes, initialized: true },
    practice, audit: { passees: [], derniere: null },
  } });
  snapshots.set(user, [point('2026-08-25T09:00:00Z', 'Mon point de départ', [1, 1, 2], 'checkpoint'), point('2026-09-25T09:00:00Z', 'Bilan de septembre', [2, 2, 3], 'checkpoint')]);
  console.log(`Aperçu local, données fictives effacées à l’arrêt : ${url}/?c=${user}&vue=mois`);
});
