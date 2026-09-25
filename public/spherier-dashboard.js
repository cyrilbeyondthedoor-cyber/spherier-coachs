let minuteurPratique;
let historiqueBilans = [];
let inclureAnciennesSauvegardes = false;
let curseurBilans = null;
let requeteBilans = 0;
let retourDashboard = false;
let dernierRetraitPriorite = null;

function initialiserProgression() {
  const media = matchMedia('(prefers-color-scheme: light)');
  const appliquer = (theme) => {
    document.documentElement.dataset.theme = theme;
    const bouton = document.getElementById('theme-toggle');
    if (bouton) { bouton.textContent = theme === 'light' ? 'Thème sombre' : 'Thème clair'; bouton.setAttribute('aria-label', `Activer le ${bouton.textContent.toLowerCase()}`); }
  };
  const memorise = memoLire('spherier-theme');
  appliquer(['light', 'dark'].includes(memorise) ? memorise : (media.matches ? 'light' : 'dark'));
  const bouton = document.createElement('button'); bouton.type = 'button'; bouton.id = 'theme-toggle'; bouton.className = 'btn-mois';
  document.querySelector('.header').appendChild(bouton); appliquer(document.documentElement.dataset.theme);
  bouton.onclick = () => { const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; memoEcrire('spherier-theme', theme); appliquer(theme); };
  media.addEventListener('change', () => { if (!memoLire('spherier-theme')) appliquer(media.matches ? 'light' : 'dark'); });
  document.getElementById('spherier-titre')?.after(document.getElementById('audit-depart'));
  // Definitions open on keyboard focus as well as on hover. The owning control keeps focus.
  document.getElementById('panneau').addEventListener('focusin', (event) => {
    const word = event.target.closest('.lex-mot'); if (word && !retourFocusLexique) ouvrirBulleLexique(word, { focus: false });
    else if (!word && !event.target.closest('.lex-bulle')) fermerBulleLexique({ rendreFocus: false });
  });
  document.getElementById('panneau').addEventListener('keydown', (event) => {
    const word = event.target.closest('.lex-mot');
    if (word && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); ouvrirBulleLexique(word); }
  });
  window.addEventListener('beforeunload', (event) => {
    const pending = [...sauvegardesNotes.values()].some(job => job.inFlight || job.conflict || job.pendingText?.trim() !== job.text.trim());
    const drafts = [...sauvegardesNotes.keys()].some(code => memoLire(cleNote(code)) !== null);
    if (pending || drafts || conflitSnapshot) { event.preventDefault(); event.returnValue = ''; }
  });
}

function champPratique(code, key, label, placeholder, value) {
  return `<label class="pratique-champ">${label}<textarea data-pratique="${key}" data-code="${echapper(code)}" maxlength="2000" rows="2" placeholder="${placeholder}">${echapper(value || '')}</textarea></label>`;
}

function afficherDashboard({ scroll = 0 } = {}) {
  if (conflitSnapshot) { ouvrirConflit(); return; }
  retourApresFiche = null;
  if (dernierRetraitPriorite && !SpherierCore.equal(dernierRetraitPriorite.apres, { current: brouillon.current, later: brouillon.later, priorites: etatPriorites() })) dernierRetraitPriorite = null;
  situer = null; competenceAffichee = null; themeAffiche = null; retourDashboard = false;
  preparerEcranAudit('#c9a661', { plein: true });
  const stats = scoreCodes(etat.referentiel.competencies.map(c => c.id));
  const mois = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const actifs = brouillon.current.filter(code => competenceParCode(code));
  const pratiques = brouillon.practice || {};
  const travail = actifs.map((code, rang) => {
    const c = competenceParCode(code), d = dimensionDe(c), pratique = pratiques[code] || {};
    const n = brouillon.levels[code] || 0;
    return `<article class="travail-priorite" data-travail="${echapper(code)}" style="--teinte:${TEINTES_HEX[d?.id] || '#c9a661'}">
      <div class="travail-repere"><span>Priorité ${rang + 1} · ${echapper(d?.name || '')}</span><span class="travail-niveau">${echapper(etat.referentiel.scale[n] || 'À évaluer')}</span></div>
      ${ligneSelection(code, { cible: true })}
      <div class="travail-commandes"><button type="button" data-reevaluer="${echapper(code)}">Actualiser mon niveau</button><button type="button" data-descendre="${echapper(code)}">Pour plus tard</button><button type="button" data-retirer-pratique="${echapper(code)}">${n === 3 ? 'Retirer cette priorité maîtrisée' : 'Retirer'}</button></div>
      ${n === 3 ? '<p class="travail-acquis">Tu te situes au niveau « Je maîtrise ». Tu peux poursuivre ce travail ou libérer une place.</p>' : ''}
      <details class="pratique-details" ${rang === 0 ? 'open' : ''}><summary>Mon travail et mes progrès</summary>
        <div class="pratique-plan">
          ${champPratique(code, 'action', 'Ce que je vais pratiquer', 'Une action précise à essayer', pratique.action)}
          ${champPratique(code, 'situation', 'Dans quelle situation', 'Une prochaine séance, un échange, une préparation…', pratique.situation)}
          ${champPratique(code, 'evidence', 'Comment je verrai le progrès', 'Un geste ou un résultat que je peux observer', pratique.evidence)}
        </div>
        ${champPratique(code, 'observation', 'Mes progrès et observations', 'Ce que j’ai essayé, ce qui a changé, ce que je veux ajuster', pratique.observation)}
      </details>
    </article>`;
  }).join('');
  const attente = [...new Set([...(etatPriorites().classement || []).slice(MAX_MAINTENANT), ...brouillon.later])]
    .filter(code => !actifs.includes(code) && competenceParCode(code));
  elPanneauTete.innerHTML = `<p class="panneau-fil">Ma pratique · ${echapper(mois)}</p><h2 id="panneau-titre" class="panneau-titre">Mon mois</h2><p class="panneau-def">Choisis ton prochain geste. Observe ce qui change. Ajuste tes priorités.</p>`;
  ecrireCorps(`<div class="dashboard">
    <div class="dashboard-reperes"><p><strong>${stats.evaluated} / ${stats.total}</strong> compétences évaluées</p><p><strong>${stats.percent === null ? 'Non évalué' : stats.percent + ' %'}</strong> maîtrisées parmi les évaluées</p><p><strong>${actifs.length} / ${MAX_MAINTENANT}</strong> priorités en cours</p></div>
    <div class="dashboard-actions"><button type="button" class="principal" id="pratique-enregistrer">Enregistrer mes progrès</button><button type="button" id="mois-reordonner">Retravailler mes priorités</button><button type="button" id="dashboard-evaluer">${stats.evaluated ? 'Poursuivre mon évaluation' : 'Choisir une thématique'}</button><button type="button" id="dashboard-imprimer">Préparer ma supervision</button></div>
    <p id="dashboard-etat" role="status">${estModifie() ? 'Des changements attendent d’être enregistrés.' : 'Tes derniers changements sont enregistrés.'}</p>
    ${dernierRetraitPriorite ? '<p class="retrait-annulable">Priorité retirée. <button type="button" id="retablir-priorite">Annuler ce retrait</button></p>' : ''}
    <div class="dashboard-layout"><section aria-label="Mes priorités"><h3 class="dashboard-section-titre">Ce mois-ci · ${actifs.length}/${MAX_MAINTENANT}</h3>
      ${travail || '<div class="dashboard-vide"><h3>Un premier axe de travail</h3><p>Évalue une thématique ou ouvre la synthèse pour choisir jusqu’à trois compétences à pratiquer.</p><button type="button" id="dashboard-choisir">Choisir mes priorités</button></div>'}
    </section><aside class="dashboard-suite"><section><h3>Pour plus tard <span>${attente.length}</span></h3>${attente.length ? attente.map(code => ligneSelection(code)).join('') : '<p>Les compétences que tu gardes pour la suite apparaîtront ici.</p>'}<div id="zone-remplacement"></div></section>
      <section class="dashboard-bilan"><h3>Faire le point</h3><p>Garde une trace datée de tes niveaux, de ton travail et de tes observations.</p><label>Nom du bilan<input id="bilan-libelle" maxlength="160" value="${echapper('Bilan de ' + mois)}"></label><button type="button" id="bilan-creer">Enregistrer mon bilan</button><p>Un point mérite un regard extérieur ?</p><button type="button" id="pratique-rdv">Réserver un échange</button></section>
    </aside></div>
    <section class="dashboard-historique"><h3>Mes bilans</h3><label class="bilans-anciens"><input type="checkbox" id="bilans-anciens" ${inclureAnciennesSauvegardes ? 'checked' : ''}> Inclure les anciennes sauvegardes</label><p id="bilans-etat" role="status">Chargement des bilans…</p><div id="bilans-liste"></div><div id="bilans-comparaison"></div></section>
  </div>`);
  elPanneauCorps.scrollTop = scroll;
  const etatPratique = (text) => { const el = document.getElementById('dashboard-etat'); if (el) el.textContent = text; };
  const sauver = async () => {
    clearTimeout(minuteurPratique); etatPratique('Enregistrement…');
    const ok = await enregistrer();
    etatPratique(ok ? (estModifie() ? 'Derniers changements en attente.' : 'Tes progrès sont enregistrés.') : `Enregistrement à reprendre. ${messageConservation()}`);
    return ok;
  };
  document.getElementById('pratique-enregistrer').onclick = sauver;
  elPanneauCorps.querySelectorAll('[data-pratique]').forEach(champ => champ.addEventListener('input', () => {
    const { code, pratique } = champ.dataset;
    brouillon.practice ||= {}; brouillon.practice[code] ||= {};
    brouillon.practice[code][pratique] = champ.value;
    enregistrerBrouillon(); majBarre(); etatPratique('Progrès en cours de saisie…');
    clearTimeout(minuteurPratique); minuteurPratique = setTimeout(sauver, 1800);
  }));
  document.getElementById('mois-reordonner').onclick = () => { initialiserClassementDepuisSelections(); ouvrirRecapDimension(null); };
  document.getElementById('dashboard-evaluer').onclick = reprendreAudit;
  document.getElementById('dashboard-choisir')?.addEventListener('click', () => ouvrirSynthese(false));
  elPanneauCorps.querySelectorAll('[data-aller],[data-reevaluer]').forEach(btn => btn.onclick = () => {
    retourDashboard = true; const code = btn.dataset.reevaluer || btn.dataset.aller; const c = competenceParCode(code); ouvrirCompetence(code, dimensionDe(c).id);
  });
  elPanneauCorps.querySelectorAll('[data-descendre]').forEach(btn => btn.onclick = () => {
    basculerPlusTard(btn.dataset.descendre); void enregistrer(); afficherDashboard({ scroll: elPanneauCorps.scrollTop });
  });
  elPanneauCorps.querySelectorAll('[data-retirer-pratique]').forEach(btn => btn.onclick = () => {
    dernierRetraitPriorite = { avant: SpherierCore.clone({ current: brouillon.current, later: brouillon.later, priorites: etatPriorites() }) };
    retirerDuClassement(btn.dataset.retirerPratique);
    dernierRetraitPriorite.apres = SpherierCore.clone({ current: brouillon.current, later: brouillon.later, priorites: etatPriorites() }); void enregistrer(); afficherDashboard({ scroll: elPanneauCorps.scrollTop });
  });
  document.getElementById('retablir-priorite')?.addEventListener('click', () => {
    Object.assign(brouillon, dernierRetraitPriorite.avant); dernierRetraitPriorite = null; appliquerChangement(() => {}); void enregistrer(); afficherDashboard();
  });
  elPanneauCorps.querySelectorAll('[data-promouvoir]').forEach(btn => btn.onclick = () => {
    const code = btn.dataset.promouvoir;
    if (brouillon.current.length >= MAX_MAINTENANT) proposerRemplacement(competenceParCode(code), () => { void enregistrer(); afficherDashboard(); });
    else { basculerMaintenant(code); void enregistrer(); afficherDashboard(); }
  });
  document.getElementById('bilan-creer').onclick = async (event) => {
    const label = document.getElementById('bilan-libelle').value.trim() || `Bilan de ${mois}`;
    event.currentTarget.disabled = true; clearTimeout(minuteurPratique);
    const ok = await enregistrer(label, 'checkpoint');
    if (document.getElementById('bilan-creer')) document.getElementById('bilan-creer').disabled = false;
    etatPratique(ok ? 'Bilan enregistré. Tu peux le retrouver et le comparer ci-dessous.' : `Le bilan n’a pas été enregistré. ${messageConservation()}`);
    if (ok) void chargerBilans();
  };
  document.getElementById('bilans-anciens').onchange = event => { inclureAnciennesSauvegardes = event.target.checked; curseurBilans = null; void chargerBilans(); };
  document.getElementById('pratique-rdv').onclick = ouvrirReservation;
  document.getElementById('dashboard-imprimer').onclick = imprimerPratique;
  afficherPanneau(); document.body.dataset.panneau = 'mois';
  void chargerBilans();
}

function initialiserClassementDepuisSelections() {
  const p = etatPriorites();
  if (!p.initialized && p.classement.length === 0) p.classement = [...brouillon.current];
  p.initialized = true; memoriserPriorites();
}

async function chargerBilans(suite = false) {
  const request = ++requeteBilans;
  const status = document.getElementById('bilans-etat'); if (!status) return;
  status.textContent = 'Chargement des bilans…';
  try {
    const data = await lireJson(`/api/history?uuid=${encodeURIComponent(CLIENT_ID)}${inclureAnciennesSauvegardes ? '&legacy=true' : ''}${suite && curseurBilans ? '&cursor=' + encodeURIComponent(curseurBilans) : ''}`);
    if (request !== requeteBilans || !document.getElementById('bilans-liste')) return;
    historiqueBilans = suite ? [...historiqueBilans, ...data.items] : data.items;
    curseurBilans = data.nextCursor;
    status.textContent = historiqueBilans.length ? 'Choisis deux bilans pour voir ce qui a changé.' : 'Ton premier bilan apparaîtra ici. Les sauvegardes courantes restent séparées de tes bilans.';
    rendreBilans();
  } catch {
    if (!status.isConnected) return;
    status.innerHTML = 'Les bilans ne sont pas disponibles. <button type="button" id="bilans-reessayer">Réessayer</button>';
    document.getElementById('bilans-reessayer').onclick = () => chargerBilans(suite);
  }
}

function rendreBilans() {
  const el = document.getElementById('bilans-liste'); if (!el) return;
  const options = historiqueBilans.map((item, i) => `<option value="${i}">${item.blob.kind !== 'checkpoint' ? 'Ancienne sauvegarde · ' : ''}${echapper(item.libelle || 'Bilan')} · ${new Date(item.cree_le).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}</option>`).join('');
  el.innerHTML = `${historiqueBilans.length ? `<div class="bilan-selecteurs"><label>Bilan de départ<select id="bilan-avant">${options}</select></label><label>Bilan d’arrivée<select id="bilan-apres">${options}</select></label><button type="button" id="bilans-comparer">Comparer</button></div><button type="button" id="bilan-lire">Lire le bilan sélectionné</button>` : ''}${curseurBilans ? '<button type="button" id="bilans-suite">Charger les bilans précédents</button>' : ''}`;
  if (historiqueBilans.length > 1) document.getElementById('bilan-avant').value = '1';
  document.getElementById('bilans-suite')?.addEventListener('click', () => chargerBilans(true));
  document.getElementById('bilan-lire')?.addEventListener('click', async () => {
    const selection = historiqueBilans[Number(document.getElementById('bilan-apres').value)];
    let item;
    const target = document.getElementById('bilans-comparaison');
    target.textContent = 'Chargement du bilan…';
    try { item = (await lireJson(`/api/history?uuid=${encodeURIComponent(CLIENT_ID)}&id=${encodeURIComponent(selection.id)}`)).snapshot; }
    catch { if (target.isConnected) target.textContent = 'Le bilan ne peut pas être chargé. Réessaie.'; return; }
    if (!target.isConnected) return;
    const practice = item.blob.practice || {};
    const codes = [...new Set([...(item.blob.selections?.current || []), ...Object.keys(practice)])];
    document.getElementById('bilans-comparaison').innerHTML = `<h4>${echapper(item.libelle || 'Bilan')}</h4>${codes.map(code => `<article class="bilan-detail"><h5>${echapper(competenceParCode(code)?.name || code)}</h5><p>${echapper(item.blob.referential_version === etat.referentiel.version ? (etat.referentiel.scale[item.blob.levels?.[code]] || 'Non évalué') : ('Niveau enregistré : ' + (item.blob.levels?.[code] || 0) + ' (ancien référentiel)'))}</p>${Object.entries(practice[code] || {}).map(([key, value]) => `<p><strong>${({ action: 'Action', situation: 'Situation', evidence: 'Repère de progrès', observation: 'Observation' })[key] || echapper(key)}</strong> ${echapper(value)}</p>`).join('')}</article>`).join('') || '<p>Aucune priorité ni observation dans ce bilan.</p>'}`;
  });
  document.getElementById('bilans-comparer')?.addEventListener('click', () => {
    const before = historiqueBilans[Number(document.getElementById('bilan-avant').value)];
    const after = historiqueBilans[Number(document.getElementById('bilan-apres').value)];
    const target = document.getElementById('bilans-comparaison');
    if (before.id === after.id) { target.textContent = 'Choisis deux bilans différents.'; return; }
    if (before.cree_le > after.cree_le) { target.textContent = 'Le bilan de départ doit précéder le bilan d’arrivée.'; return; }
    if (before.blob.referential_version !== after.blob.referential_version) { target.textContent = 'Ces bilans utilisent deux versions différentes du référentiel. Tu peux les lire séparément.'; return; }
    const changes = SpherierCore.compare(before.blob.levels || {}, after.blob.levels || {}, etat.referentiel.competencies.map(c => c.id));
    const changed = changes.filter(c => c.delta !== 0);
    target.innerHTML = `<p>${changes.length} compétences évaluées aux deux dates. ${changed.length} changements de niveau.</p>${changed.length ? `<ul class="bilan-changements">${changed.map(c => `<li><strong>${echapper(competenceParCode(c.code).name)}</strong><span>${echapper(etat.referentiel.scale[c.before])} → ${echapper(etat.referentiel.scale[c.after])}</span></li>`).join('')}</ul>` : '<p>Aucun changement de niveau sur les compétences comparables.</p>'}`;
  });
}

function imprimerPratique() {
  document.getElementById('fiche-impression')?.remove();
  const fiche = document.createElement('section'); fiche.id = 'fiche-impression';
  fiche.innerHTML = `<h1>Ma pratique de coach</h1><p>Point du ${new Date().toLocaleDateString('fr-FR')}</p>${brouillon.current.map(code => {
    const c = competenceParCode(code); if (!c) return '';
    const p = brouillon.practice?.[code] || {};
    return `<article><h2>${echapper(c.name)}</h2><p>${echapper(etat.referentiel.scale[brouillon.levels[code]] || 'Non évalué')}</p>${[['Action', p.action], ['Situation', p.situation], ['Repère de progrès', p.evidence], ['Observations', p.observation]].map(([label, value]) => `<h3>${label}</h3><p>${echapper(value || 'À préciser')}</p>`).join('')}</article>`;
  }).join('')}<h2>Question pour ma supervision</h2><p>................................................................................</p>`;
  document.body.appendChild(fiche); window.print();
}
