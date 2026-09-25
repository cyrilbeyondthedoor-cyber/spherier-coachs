let ongletSpherier;
try {
  ongletSpherier = sessionStorage.getItem('spherier-onglet') || crypto.randomUUID();
  sessionStorage.setItem('spherier-onglet', ongletSpherier);
} catch { ongletSpherier = crypto.randomUUID(); }
function cleParOnglet(base) { return `${base}:onglet:${ongletSpherier}`; }
function lireCopieOnglet(base) {
  const propre = memoLire(cleParOnglet(base));
  if (propre !== null) return propre;
  const ancien = memoLire(base);
  if (ancien !== null) return ancien;
  try {
    const keys = Object.keys(localStorage).filter(key => key.startsWith(base + ':onglet:') && !key.endsWith('-base'));
    return keys.length ? memoLire(keys.at(-1)) : null;
  } catch { signalerStockageIndisponible(); return null; }
}
function effacerBrouillon() {
  const propre = memoLire(cleParOnglet(cleBrouillon()));
  memoRetirer(cleParOnglet(cleBrouillon()));
  if (memoLire(cleBrouillon()) === propre) memoRetirer(cleBrouillon());
}
let stockageDisponible = true;
let conflitSnapshot = null;
const sauvegardesNotes = new Map();

function signalerStockageIndisponible() {
  stockageDisponible = false;
  if (document.getElementById('stockage-alerte')) return;
  const message = document.createElement('p');
  message.id = 'stockage-alerte';
  message.className = 'stockage-alerte';
  message.setAttribute('role', 'alert');
  message.textContent = 'Ce navigateur ne peut pas conserver de brouillon. Enregistre tes changements avant de fermer cette page.';
  document.body.prepend(message);
}
function memoLire(key) { try { return localStorage.getItem(key); } catch { signalerStockageIndisponible(); return null; } }
function memoEcrire(key, value) { try { localStorage.setItem(key, value); return true; } catch { signalerStockageIndisponible(); return false; } }
function memoRetirer(key) { try { localStorage.removeItem(key); } catch { signalerStockageIndisponible(); } }
function apiFetch(url, options = {}) {
  return fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(15000) });
}
function messageConservation() {
  return stockageDisponible ? 'Ton brouillon reste sur cet appareil.' : 'Garde cette page ouverte : le navigateur ne peut pas conserver de brouillon.';
}

function referenceDepuisEtat(data) {
  const blob = data.snapshot?.blob || {};
  const selection = blob.selections || { current: [], later: [] };
  return {
    levels: { ...data.computed.levels }, current: [...selection.current], later: [...selection.later],
    priorites: SpherierCore.clone(data.priorites || blob.priorites || { themes: {}, dimensions: {}, classement: [] }),
    practice: SpherierCore.clone(blob.practice || {}),
  };
}

function restaurerTravailLocal(repris, serveur) {
  if (!repris?.levels) return;
  // Old drafts have no baseline. Never assume they are newer than the server.
  if (!repris.base) {
    if (['levels', 'current', 'later', 'priorites', 'practice'].some(key => repris[key] !== undefined && !SpherierCore.equal(repris[key], serveur[key]))) {
      conflitSnapshot = { local: repris, remote: serveur, conflicts: ['ancien brouillon'] };
      annoncerConflit();
    }
    return;
  }
  const fusion = SpherierCore.merge(repris.base, repris, serveur);
  if (fusion.conflicts.length) {
    conflitSnapshot = { local: repris, remote: serveur, merged: fusion.state, conflicts: fusion.conflicts };
    annoncerConflit();
    return;
  }
  brouillon = { ...brouillon, ...fusion.state };
  if (repris.baseSnapshotId === (etat.snapshot?.id || null)) {
    brouillon.passees = repris.passees || brouillon.passees;
    brouillon.derniere = repris.derniere || brouillon.derniere;
  }
  brouillonRestaure = estModifie();
}

function annoncerConflit() {
  let notice = document.getElementById('conflit-notice');
  if (!notice) {
    notice = document.createElement('div'); notice.id = 'conflit-notice'; notice.className = 'stockage-alerte';
    notice.setAttribute('role', 'alert');
    notice.innerHTML = '<span>Des changements existent sur cet appareil et dans ton espace.</span> <button type="button">Comparer les versions</button>';
    notice.querySelector('button').onclick = ouvrirConflit;
    document.body.prepend(notice);
  }
}

function ouvrirConflit() {
  if (!conflitSnapshot) return;
  const { local, remote } = conflitSnapshot;
  const codeNom = (code) => competenceParCode(code)?.name || code;
  const liste = (codes) => (codes || []).map(codeNom).join(', ') || 'Aucune';
  const differences = [];
  for (const code of new Set([...Object.keys(local.levels || {}), ...Object.keys(remote.levels || {})])) {
    if ((local.levels?.[code] || 0) !== (remote.levels?.[code] || 0)) differences.push(`<tr><th>${echapper(codeNom(code))}</th><td>${echapper(etat.referentiel.scale[local.levels?.[code]] || 'Non évalué')}</td><td>${echapper(etat.referentiel.scale[remote.levels?.[code]] || 'Non évalué')}</td></tr>`);
  }
  if (!SpherierCore.equal(local.priorites, remote.priorites) || !SpherierCore.equal(local.current, remote.current)) differences.push(`<tr><th>Priorités et classement</th><td>${echapper(liste(local.priorites?.classement?.length ? local.priorites.classement : local.current))}</td><td>${echapper(liste(remote.priorites?.classement?.length ? remote.priorites.classement : remote.current))}</td></tr>`);
  for (const code of new Set([...Object.keys(local.practice || {}), ...Object.keys(remote.practice || {})])) {
    if (!SpherierCore.equal(local.practice?.[code], remote.practice?.[code])) differences.push(`<tr><th>Pratique : ${echapper(codeNom(code))}</th><td>${echapper(Object.values(local.practice?.[code] || {}).join('\n'))}</td><td>${echapper(Object.values(remote.practice?.[code] || {}).join('\n'))}</td></tr>`);
  }
  preparerEcranAudit('#c9a661', { plein: true });
  elPanneauTete.innerHTML = '<h2 id="panneau-titre" class="panneau-titre">Retrouver tes changements</h2><p>Compare les versions avant de reprendre. Tes changements restent conservés jusqu’à ton choix.</p>';
  ecrireCorps(`<div class="comparaison-scroll"><table class="comparaison"><thead><tr><th>Élément</th><th>Cet appareil</th><th>Ton espace</th></tr></thead><tbody>${differences.join('')}</tbody></table></div><div class="dashboard-actions"><button id="conflit-local" type="button">Garder mes changements sur cet appareil</button><button id="conflit-serveur" type="button">Charger la version de mon espace</button></div>`);
  const resoudre = (garder) => {
    const choix = conflitSnapshot;
    const copie = SpherierCore.clone(choix.local);
    // Archive both versions before an explicit choice, including legacy drafts.
    memoEcrire(`spherier-recuperation-${CLIENT_ID}`, JSON.stringify(choix));
    brouillon = { ...brouillon, ...(garder ? (choix.merged || copie) : choix.remote) };
    reference = SpherierCore.clone(choix.remote);
    conflitSnapshot = null; document.getElementById('conflit-notice')?.remove();
    etat.computed.levels = { ...brouillon.levels };
    enregistrerBrouillon(); majBarre(); majAuditInitial(); majBoutonMois(); redessinerConstellations();
    if (garder) void enregistrer();
    ouvrirMois();
  };
  document.getElementById('conflit-local').onclick = () => resoudre(true);
  document.getElementById('conflit-serveur').onclick = () => resoudre(false);
  afficherPanneau();
}

async function traiterConflitSnapshot(local) {
  const data = await lireJson(`/api/state?uuid=${encodeURIComponent(CLIENT_ID)}`);
  const remote = referenceDepuisEtat(data);
  const merged = SpherierCore.merge(reference, local, remote);
  etat.snapshot = data.snapshot;
  conflitSnapshot = { local: SpherierCore.clone(local), remote, merged: merged.state, conflicts: merged.conflicts };
  annoncerConflit();
  return false;
}

function brancherNoteFiable(competence) {
  const bloc = document.getElementById('note-bloc'), champ = document.getElementById('note-champ');
  const bouton = document.getElementById('note-btn'), compteur = document.getElementById('note-compteur');
  if (!bloc || !champ) return;
  const code = competence.id;
  const ancienneCle = `spherier-v2-note-${CLIENT_ID}-${code}`;
  if (memoLire(cleNote(code)) === null) {
    try {
      const source = memoLire(ancienneCle) !== null ? ancienneCle : Object.keys(localStorage).find(key => key.startsWith(ancienneCle + ':onglet:') && !key.endsWith('-base'));
      if (source) {
        memoEcrire(cleNote(code), memoLire(source));
        const meta = memoLire(source + '-base'); if (meta !== null) memoEcrire(cleNote(code) + '-base', meta);
      }
    } catch { signalerStockageIndisponible(); }
  }
  const cleBase = cleNote(code) + '-base';
  let job = sauvegardesNotes.get(code);
  if (!job) {
    job = { revision: etat.notes?.[code]?.revision ?? null, text: texteNote(code), inFlight: false, queued: false, conflict: null };
    const draft = memoLire(cleNote(code));
    if (draft !== null) champ.value = draft;
    const rawBase = memoLire(cleBase);
    let base;
    try { base = rawBase === null ? undefined : JSON.parse(rawBase).revision; } catch { base = undefined; }
    if (draft !== null && draft.trim() !== job.text.trim() && base !== job.revision) job.conflict = etat.notes?.[code] || { texte: '', revision: null };
    job.pendingText = draft ?? champ.value;
    sauvegardesNotes.set(code, job);
  }
  // The request owns its code. A late response must not update a different open note.
  const current = () => competenceAffichee?.code === code && document.getElementById('note-champ') === champ;
  const status = (message, variant) => { if (current()) etatNote(message, variant); };
  const update = () => {
    if (!current()) return;
    bouton.disabled = champ.value.trim() === job.text.trim() || job.inFlight;
    compteur.textContent = `${champ.value.length} / ${NOTE_MAX}`;
  };
  document.getElementById('note-entete').onclick = () => {
    const open = bloc.classList.toggle('ouverte');
    document.getElementById('note-entete').setAttribute('aria-expanded', String(open));
    if (open) champ.focus();
  };
  const showConflict = () => {
    if (!current() || document.getElementById('note-conflit')) return;
    const zone = document.createElement('div'); zone.id = 'note-conflit'; zone.className = 'note-conflit';
    zone.innerHTML = `<p>Une autre version de cette note existe.</p><p><strong>Ton espace</strong></p><pre>${echapper(job.conflict?.texte || '(note vide)')}</pre><button type="button" data-note-local>Enregistrer mon texte à la place</button><button type="button" data-note-remote>Reprendre le texte de mon espace</button>`;
    bloc.appendChild(zone);
    zone.querySelector('[data-note-local]').onclick = () => { job.revision = job.conflict?.revision ?? null; job.conflict = null; memoEcrire(cleBase, JSON.stringify({ revision: job.revision })); zone.remove(); save(); };
    zone.querySelector('[data-note-remote]').onclick = () => {
      job.revision = job.conflict?.revision ?? null; job.text = job.conflict?.texte || '';
      etat.notes[code] = job.conflict || { texte: '', revision: null };
      job.conflict = null; champ.value = job.text; job.pendingText = job.text; memoRetirer(cleNote(code)); memoRetirer(cleBase); zone.remove(); update(); status('Version de ton espace chargée', '');
    };
  };
  const save = async () => {
    clearTimeout(job.timer);
    if (job.inFlight) { job.queued = true; return; }
    if (job.conflict) { showConflict(); return; }
    const text = job.pendingText;
    if (text.trim() === job.text.trim()) { update(); return; }
    job.inFlight = true; update(); status('Enregistrement…', 'encours');
    try {
      const response = await apiFetch('/api/note', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid: CLIENT_ID, code, texte: text, base_revision: job.revision }) });
      const data = await response.json();
      if (response.status === 409) { job.conflict = data.current || {}; showConflict(); throw new Error('Compare les deux versions avant d’enregistrer.'); }
      if (!response.ok) throw new Error(data.erreur || 'Enregistrement impossible.');
      job.revision = data.note.revision; job.text = data.note.texte;
      etat.notes[code] = data.note;
      if (memoLire(cleNote(code)) === text) { memoRetirer(cleNote(code)); memoRetirer(cleBase); }
      else if (memoLire(cleNote(code)) !== null) memoEcrire(cleBase, JSON.stringify({ revision: job.revision }));
      const newer = job.pendingText.trim() !== text.trim();
      status(newer ? 'Derniers mots en attente d’enregistrement' : 'Enregistrée', newer ? '' : 'enregistree');
      if (newer) job.queued = true;
    } catch (error) {
      status(`Non enregistrée. ${error.message} ${messageConservation()}`, 'echec');
      job.queued = false;
    } finally {
      job.inFlight = false; update();
      if (job.queued && !job.conflict) { job.queued = false; void save(); }
    }
  };
  champ.addEventListener('input', () => {
    if (memoLire(cleBase) === null) memoEcrire(cleBase, JSON.stringify({ revision: job.revision }));
    job.pendingText = champ.value; memoEcrire(cleNote(code), champ.value); update(); status('Pas encore enregistrée', '');
    clearTimeout(job.timer); job.timer = setTimeout(save, NOTE_DELAI_MS);
  });
  champ.addEventListener('blur', save); bouton.onclick = save;
  update();
  if (job.conflict) showConflict();
  else if (memoLire(cleNote(code)) !== null) status('Brouillon retrouvé sur cet appareil', '');
}
