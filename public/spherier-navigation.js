// Navigation et reprise. Le repère de lecture ne transporte aucune réponse.

  function persisterAudit() {
    memoEcrire(cleNavigation(), JSON.stringify({ derniere: brouillon.derniere || null,
      passees: brouillon.passees || [], baseSnapshotId: etat.snapshot?.id || null }));
    enregistrerBrouillon();
  }

  function noterDerniere(contexte, code) {
    if (!contexte) return;
    const avant = brouillon.derniere;
    if (avant && avant.themeId === contexte.themeId && avant.code === code && avant.mode === (contexte.enchaine ? 'dimension' : 'theme')) return;
    brouillon.derniere = { dimensionId: contexte.dimensionId, themeId: contexte.themeId, code, mode: contexte.enchaine ? 'dimension' : 'theme' };
    // Simple signet : pas de redessin. Le bloc d'accueil est masqué tant que le panneau
    // est ouvert, le rafraîchir à chaque question ne servait à personne.
    persisterAudit();
  }

  function evaluerTheme(dimensionId, themeId, suite = 'theme', { depart = null } = {}) {
    const dimension = dimensionParId(dimensionId);
    const theme = themeParId(themeId);
    if (!dimension || !theme) { ouvrirChoixDimension(); return; }
    ouvrirMeSituer({
      codes: codesDeTheme(theme.id),
      titre: theme.name,
      teinte: TEINTES_HEX[dimension.id] || '#c9a661',
      depart,
      contexte: { dimensionId: dimension.id, themeId: theme.id, suite },
    });
  }

  function evaluerDimension(dimensionId) {
    const dimension = dimensionParId(dimensionId);
    if (!dimension) { ouvrirChoixDimension(); return; }
    const suivante = themesDeDimension(dimension).find((theme) => !etatTheme(theme).complete);
    if (!suivante) { ouvrirResultatDimension(dimension.id); return; }
    evaluerTheme(dimension.id, suivante.id, 'dimension');
  }

  function reprendreAudit() {
    const repere = brouillon.derniere;
    const theme = repere ? themeParId(repere.themeId) : null;
    const dimension = repere ? dimensionParId(repere.dimensionId) : null;
    if (theme && dimension && !etatTheme(theme).complete) {
      if (repere.mode === 'dimension') evaluerDimensionEnchainee(dimension.id, { code: repere.code });
      else { const rang = codesDeTheme(theme.id).indexOf(repere.code); evaluerTheme(dimension.id, theme.id, 'theme', { depart: rang >= 0 ? rang : null }); }
      return;
    }
    ouvrirChoixDimension();
  }

  function codesEnchaines(dimension) {
    return themesDeDimension(dimension)
      .filter((theme) => !etatTheme(theme).complete)
      .flatMap((theme) => codesDeTheme(theme.id));
  }

  function evaluerDimensionEnchainee(dimensionId, { code = null } = {}) {
    const dimension = dimensionParId(dimensionId);
    if (!dimension) { ouvrirChoixDimension(); return; }
    const codes = codesEnchaines(dimension);
    if (codes.length === 0) { ouvrirResultatDimension(dimension.id, 'dimension'); return; }
    const premier = competenceParCode(codes[0]);
    ouvrirMeSituer({
      codes,
      titre: dimension.name,
      depart: code && codes.includes(code) ? codes.indexOf(code) : null,
      teinte: TEINTES_HEX[dimension.id] || '#c9a661',
      contexte: {
        dimensionId: dimension.id,
        themeId: premier ? premier.theme : null,
        suite: 'dimension',
        // Ce drapeau est tout ce qui distingue les deux modes : même écran, même
        // enregistrement, seule la longueur de la liste et les bornes changent.
        enchaine: true,
      },
    });
  }

  function suivreThemeEnchaine() {
    const contexte = situer && situer.contexte;
    if (!contexte || !contexte.enchaine) return null;
    const competence = competenceParCode(situer.codes[situer.index]);
    const courant = competence ? competence.theme : contexte.themeId;
    if (!courant || courant === contexte.themeId) return null;
    const precedent = contexte.themeId;
    contexte.themeId = courant;
    return precedent;
  }
