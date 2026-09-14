const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const {
  CATEGORIES,
  DIMENSIONS,
  DIFFICULTES,
  ECHELLE,
  NIVEAU_ACQUIS,
  MAX_CIBLES_MAINTENANT,
  BOOKING_URL,
  LEXIQUE,
} = require('../club.config.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'spherier-v2.html'));

const themes = DIMENSIONS.map((dimension, index) => ({
  id: `theme-${dimension.id}`,
  code: `${dimension.id}-01`,
  name: `Thématique ${dimension.id}`,
  dimension: dimension.name,
  definition: `Définition ${dimension.id}`,
  feeds: [],
  x: 180,
  y: 140,
  order: 1,
}));

// La première dimension porte DEUX thématiques : c'est le minimum pour éprouver
// l'audit modulaire — le sous-compteur « Thématique 1 / 2 », l'enchaînement d'une
// thématique à la suivante, et le résultat de dimension qui n'arrive qu'une fois les
// deux complètes.
const DIM_MULTI = DIMENSIONS[0];
themes.push({
  id: `theme-${DIM_MULTI.id}-2`,
  code: `${DIM_MULTI.id}-02`,
  name: `Seconde thématique ${DIM_MULTI.id}`,
  dimension: DIM_MULTI.name,
  definition: `Seconde définition ${DIM_MULTI.id}`,
  feeds: [],
  x: 420,
  y: 260,
  order: 2,
});

// Un mot du lexique dans l'énoncé et deux dans les marqueurs : le renvoi au lexique
// doit fonctionner aux deux endroits où le membre lit du texte. Le code complet de la
// compétence apparaît dans les deux textes, pour qu'une assertion distingue une
// compétence d'une autre au sein d'une même dimension.
function competence(codeTheme, code, index) {
  return {
    id: code,
    theme: codeTheme,
    name: `Je sais mobiliser la compétence ${code}.`,
    definition: `Je sais mobiliser la compétence ${code}.`,
    statement: `Je sais provoquer la bascule* : agir sur la compétence ${code}.`,
    markers: `Un exemple observable pour ${code}. Tu sais suivre les fils* et tenir l'ancrage*. Tu relis ces fils* à la séance suivante.`,
    difficulty: DIFFICULTES[index % DIFFICULTES.length].nom,
    order: index + 1,
    resources: [],
  };
}

const competencies = DIMENSIONS.map((dimension, index) =>
  competence(`theme-${dimension.id}`, `${dimension.id}-01-01`, index));

// La compétence de la deuxième dimension est calée sur la TAILLE RÉELLE d'une
// compétence du référentiel Notion : énoncé de trois lignes, quatre marqueurs de deux
// lignes chacun. C'est ce qui manquait au faux référentiel précédent, dont les énoncés
// tenaient sur une ligne : le contrôle de recouvrement du pied passait alors qu'en
// production le pied recouvrait 9 marches sur 10 en 1280×700 (revue finale, bloquant 1).
// Sa thématique ne contient qu'elle, l'écran d'évaluation s'ouvre donc directement dessus.
const DIM_LISIBILITE = DIMENSIONS[1];
const compLisibilite = competencies.find((c) => c.id === `${DIM_LISIBILITE.id}-01-01`);
compLisibilite.statement = 'Je sais créer et entretenir une relation de travail suffisamment solide, sûre et vraie pour que le client ose se montrer tel qu’il est, même quand ce qu’il traverse est difficile à dire, et je sais la réparer quand elle se fissure.';
compLisibilite.markers = [
  '• Je nomme ce que je perçois dans la relation sans l’interpréter, et je laisse au client le dernier mot sur ce qu’il en fait.',
  '• Je repère les moments où le client se retire, je le lui dis simplement et je lui propose de regarder ensemble ce qui vient de se passer.',
  '• Je tiens le cadre que nous avons posé même quand le client me demande de le déplacer, et j’explique pourquoi je le tiens.',
  '• Je reviens sur une maladresse de ma part à la séance suivante plutôt que de la laisser s’installer en silence entre nous.',
].join('\n');

// Lot 6.4 c : la thématique de la deuxième dimension porte des mots du lexique dans son
// titre, sa définition et l'énoncé de sa compétence. Le titre prend « ancrage » en
// premier, la définition n'en garde qu'un rappel, et la liste garde « fils » à elle.
const themeLexique = themes.find((theme) => theme.id === `theme-${DIM_LISIBILITE.id}`);
themeLexique.name = `Ancrage* de ${DIM_LISIBILITE.name}`;
themeLexique.definition = "Définition de la thématique, tournée vers l'ancrage*.";
compLisibilite.name = "Je sais tenir l'ancrage* et suivre les fils*.";

// Quatre compétences dans la première thématique : de quoi passer, évaluer, et lire
// un pourcentage qui ne soit pas un simple 0 ou 100.
competencies.push(
  competence(`theme-${DIM_MULTI.id}`, `${DIM_MULTI.id}-01-02`, 1),
  competence(`theme-${DIM_MULTI.id}`, `${DIM_MULTI.id}-01-03`, 2),
  competence(`theme-${DIM_MULTI.id}`, `${DIM_MULTI.id}-01-04`, 3),
  competence(`theme-${DIM_MULTI.id}-2`, `${DIM_MULTI.id}-02-01`, 0),
  competence(`theme-${DIM_MULTI.id}-2`, `${DIM_MULTI.id}-02-02`, 1),
);

const referential = {
  club: 'coachs',
  version: 1,
  categories: CATEGORIES,
  dimensions: DIMENSIONS,
  difficulties: DIFFICULTES,
  scale: ECHELLE,
  limites: { maxCiblesMaintenant: MAX_CIBLES_MAINTENANT, niveauAcquis: NIVEAU_ACQUIS },
  bookingUrl: BOOKING_URL,
  lexique: LEXIQUE,
  themes,
  competencies,
  resources: [],
};

const niveauxVides = Object.fromEntries(competencies.map((competence) => [competence.id, 0]));
const etatThemes = Object.fromEntries(themes.map((theme) => [theme.id, { status: 'open', unlock_hint: '' }]));
let dernierSnapshot = null;
// Panne simulée du serveur, pour éprouver le message d'échec et le bouton Réessayer.
let echecSnapshot = false;
// Latence simulée, pour voir l'écran d'attente de fin de thématique.
let delaiSnapshot = 0;
let nbSnapshots = 0;

function json(reponse, valeur, statut = 200) {
  reponse.writeHead(statut, { 'Content-Type': 'application/json; charset=utf-8' });
  reponse.end(JSON.stringify(valeur));
}

const serveur = http.createServer((requete, reponse) => {
  if (requete.url.startsWith('/api/referential')) return json(reponse, referential);
  if (requete.url.startsWith('/api/state')) {
    const auditComplet = requete.url.includes('00000000-0000-4000-8000-000000000002');
    // Membre 0004 : audit partiel. Une thématique complète, une autre entamée dont une
    // compétence n'a jamais été située — le cas où le choix des priorités pouvait
    // proposer une compétence que le membre n'a jamais regardée.
    if (requete.url.includes('00000000-0000-4000-8000-000000000004')) {
      const partiels = {
        ...niveauxVides,
        [`${DIM_MULTI.id}-01-01`]: 1,
        [`${DIM_MULTI.id}-01-02`]: 2,
        [`${DIM_MULTI.id}-01-03`]: 1,
        [`${DIM_MULTI.id}-01-04`]: 2,
        [`${DIM_MULTI.id}-02-01`]: 1,
      };
      return json(reponse, {
        snapshot: null,
        audit: { passees: [], derniere: null, maj: null },
        computed: { levels: partiels, themes: etatThemes },
        notes: {},
      });
    }
    // Le membre 0003 relit ce qui a été enregistré : c'est le seul moyen d'éprouver le
    // contexte de reprise après un rechargement complet de la page.
    const relecture = requete.url.includes('00000000-0000-4000-8000-000000000003') && dernierSnapshot;
    if (relecture) {
      const audit = {
        passees: dernierSnapshot.audit?.passees ?? [],
        derniere: dernierSnapshot.audit?.derniere ?? null,
        maj: new Date().toISOString(),
      };
      return json(reponse, {
        snapshot: { id: 'snapshot-relu', cree_le: new Date().toISOString(), libelle: dernierSnapshot.label || null,
          blob: { levels: dernierSnapshot.levels, selections: dernierSnapshot.selections, audit } },
        audit,
        computed: { levels: { ...niveauxVides, ...dernierSnapshot.levels }, themes: etatThemes },
        notes: {},
      });
    }
    const levels = auditComplet
      ? Object.fromEntries(competencies.map((competence, index) => [competence.id, (index % 3) + 1]))
      : niveauxVides;
    return json(reponse, {
      snapshot: null,
      audit: { passees: [], derniere: null, maj: null },
      computed: { levels, themes: etatThemes },
      notes: {},
    });
  }
  if (requete.url === '/api/access' && requete.method === 'POST') {
    let corps = '';
    requete.on('data', (morceau) => { corps += morceau; });
    requete.on('end', () => {
      const donnees = JSON.parse(corps);
      // Deux adresses réservées au test déclenchent les réponses d'erreur réelles du
      // serveur (limiteur, panne d'envoi) sans dépendre de l'implémentation d'access.js.
      if (donnees.email === 'trop-de-demandes@example.com') {
        return json(reponse, { erreur: 'Trop de demandes. Réessaie plus tard.' }, 429);
      }
      if (donnees.email === 'envoi-impossible@example.com') {
        return json(reponse, { erreur: "L'envoi du lien n'a pas abouti" }, 502);
      }
      // Le vrai `access.js` répond toujours 202, succès réel ou accusé silencieux
      // anti-spam confondus : le front doit traiter les deux comme une réussite.
      return json(reponse, { accepte: Boolean(donnees.email) }, 202);
    });
    return;
  }
  if (requete.url === '/api/snapshot' && requete.method === 'POST') {
    let corps = '';
    requete.on('data', (morceau) => { corps += morceau; });
    requete.on('end', () => {
      if (echecSnapshot) {
        reponse.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        reponse.end(JSON.stringify({ erreur: 'Panne simulée du serveur.' }));
        return;
      }
      nbSnapshots += 1;
      dernierSnapshot = JSON.parse(corps);
      const audit = {
        passees: dernierSnapshot.audit?.passees ?? [],
        derniere: dernierSnapshot.audit?.derniere ?? null,
        maj: new Date().toISOString(),
      };
      const repondre = () => json(reponse, {
        snapshot: {
          id: 'snapshot-test',
          cree_le: new Date().toISOString(),
          libelle: dernierSnapshot.label || null,
          blob: {
            levels: dernierSnapshot.levels,
            selections: dernierSnapshot.selections,
            audit,
          },
        },
        audit,
        computed: { levels: dernierSnapshot.levels, themes: etatThemes },
      });
      if (delaiSnapshot > 0) setTimeout(repondre, delaiSnapshot);
      else repondre();
    });
    return;
  }
  reponse.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  reponse.end(html);
});

// Géométrie réelle des deux colonnes d'un écran de résultat : la boîte de la colonne
// gauche, le bord droit de ce qu'elle peint vraiment, et le bord gauche du bloc
// Poursuivre. Une comparaison directe, seul moyen d'attraper un recouvrement.
async function mesurerColonnes(page) {
  return page.locator('#panneau-corps').evaluate((corps) => {
    const gauche = corps.querySelector('.audit-bilan-colonne');
    const suite = corps.querySelector('.audit-bilan-suite');
    const boite = gauche.getBoundingClientRect();
    let contenu = boite.left;
    gauche.querySelectorAll('*').forEach((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) contenu = Math.max(contenu, rect.right);
    });
    const rectSuite = suite.getBoundingClientRect();
    return {
      boiteGauche: boite.right,
      contenuGauche: contenu,
      suiteGauche: rectSuite.left,
      empilees: rectSuite.top >= boite.bottom - 1,
    };
  });
}

async function capturer(page, dossier, nom, options = {}) {
  if (!dossier) return;
  await page.addStyleTag({ content: '#bar:not(.visible) { display: none !important; }' });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(dossier, nom), ...options });
}

async function principal() {
  await new Promise((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  const adresse = serveur.address();
  const url = `http://127.0.0.1:${adresse.port}/?c=00000000-0000-4000-8000-000000000001`;
  const navigateur = await chromium.launch({ headless: true });

  try {
    const screenshotDir = process.env.SCREENSHOT_DIR || null;
    if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
    // 1280x700 : le format de recette. L'écran de résultat doit y montrer son choix
    // principal sans défilement, c'est ce que vérifie le parcours d'audit plus bas.
    const page = await navigateur.newPage({ viewport: { width: 1280, height: 700 } });
    await page.goto(url);
    await page.locator('#ciel:not([hidden])').waitFor();

    await page.getByRole('heading', { name: 'Le sphérier de compétences de coach' }).waitFor();
    const comprendre = page.getByRole('button', { name: 'Comprendre comment fonctionne le sphérier' });
    await comprendre.waitFor();
    assert.equal(await page.locator('#presentation-details').isVisible(), false);
    await comprendre.click();
    await page.getByRole('heading', { name: 'À quoi sert le sphérier ?' }).waitFor();
    await page.getByRole('heading', { name: 'Comment utiliser le sphérier ?' }).waitFor();
    await page.getByRole('button', { name: 'Consulter le lexique' }).click();
    await page.getByRole('heading', { name: "Lexique de l'approche des Sommets" }).waitFor();
    const termesLexique = await page.locator('#lexique-liste dt').allTextContents();
    assert.ok(termesLexique.includes('Professionnel établi'));
    assert.ok(termesLexique.includes('A-player'));
    assert.equal(await page.getByText('Niveau TTC', { exact: true }).count(), 0);
    // Tri alphabétique français, accents ignorés : le lexique se parcourt à l'œil.
    const sansAccent = (texte) => texte.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    assert.deepEqual(
      termesLexique,
      [...termesLexique].sort((x, y) => sansAccent(x).localeCompare(sansAccent(y), 'fr')),
    );
    assert.ok(await page.locator('#lexique-recherche').evaluate((el) => getComputedStyle(el.parentElement).position === 'sticky'));
    await page.locator('#panneau-fermer').click();
    await page.getByRole('button', { name: 'Refermer le mode d’emploi' }).click();
    await page.getByText('Tu choisis par où commencer, thématique par thématique.', { exact: false }).waitFor();
    assert.equal(await page.getByText('marque une pause toutes les 30 compétences.').count(), 0);
    await page.getByRole('button', { name: 'Réserver un échange', exact: true }).waitFor();
    assert.equal(await page.locator('#audit-synthese').isVisible(), false, 'pas de synthèse tant qu\'aucune thématique n\'est complète');
    assert.equal(await page.locator('.niveau-accueil').count(), 3);
    assert.equal(await page.getByText('Évalue au moins une thématique pour voir ton score', { exact: true }).count(), 3);
    assert.equal(await page.locator('#bar.visible').count(), 0);
    await capturer(page, screenshotDir, 'accueil-desktop.png', { fullPage: true });

    // --- Parcours modulaire : dimension → thématique → évaluation → résultat -----
    await page.getByRole('button', { name: 'Commencer mon audit' }).dispatchEvent('click');
    await page.locator('body[data-panneau="choix-dimension"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.choix-groupe').count(), 3);
    assert.equal(await page.locator('.choix-carte').count(), DIMENSIONS.length);
    await capturer(page, screenshotDir, 'choix-dimension-desktop.png');
    await page.locator(`[data-choix-dimension="${DIM_MULTI.id}"]`).dispatchEvent('click');
    await page.locator('body[data-panneau="choix-theme"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.choix-theme').count(), 2);
    await page.getByRole('button', { name: 'Évaluer toute la dimension' }).waitFor();
    await capturer(page, screenshotDir, 'choix-theme-desktop.png');
    await page.locator(`[data-evaluer-theme="theme-${DIM_MULTI.id}"]`).dispatchEvent('click');

    const compteurAudit = page.locator('.situer-compte');
    await compteurAudit.waitFor();
    assert.equal((await compteurAudit.textContent()).trim(), '1 / 4', 'compteur de section, pas de référentiel entier');
    assert.equal((await page.locator('.audit-sous-compteur').textContent()).trim(),
      `Thématique 1 / 2 de ${DIM_MULTI.name}`);
    // La difficulté n'est pas montrée pendant l'évaluation : la lire avant de se
    // positionner oriente la réponse.
    assert.equal(await page.locator('.situer-difficulte').count(), 0);
    assert.equal(await page.locator('#panneau .pastille-diff').count(), 0);
    await page.getByText('Je ne maîtrise pas du tout', { exact: true }).waitFor();
    await page.getByText("Je dois m'améliorer", { exact: true }).waitFor();
    await page.getByText('Je maîtrise', { exact: true }).waitFor();
    assert.equal(await page.locator('.situer-layout .audit-mini-sphere').count(), 3);
    await capturer(page, screenshotDir, 'audit-mini-carte-desktop.png');
    await page.getByRole('button', { name: 'Agrandir la carte' }).click();
    assert.equal(await page.locator('#audit-carte-overlay').isVisible(), true);
    await page.getByRole('button', { name: 'Revenir à la question' }).click();

    // Trois évaluations et une compétence passée : 3 + 2 + 1 sur 12 possibles = 50 %.
    // Le retour visuel est lu dans le même tour de boucle que le clic : il ne dure que
    // 250 ms, un `waitFor` arriverait après le passage à la compétence suivante.
    const retourVisuel = await page.evaluate(() => {
      const marche = document.querySelector('.marche[data-niveau="3"]');
      marche.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return {
        confirmee: marche.classList.contains('audit-marche-confirmee'),
        astuce: document.getElementById('situer-astuce').textContent.trim(),
      };
    });
    assert.equal(retourVisuel.confirmee, true, 'la marche cochée se colore avant le passage');
    assert.equal(retourVisuel.astuce, 'Enregistré, compétence suivante.');
    await page.locator('.situer-compte', { hasText: '2 / 4' }).waitFor();
    await page.locator('.marche[data-niveau="2"]').dispatchEvent('click');
    await page.locator('.situer-compte', { hasText: '3 / 4' }).waitFor();
    await page.locator('.marche[data-niveau="1"]').dispatchEvent('click');
    await page.locator('.situer-compte', { hasText: '4 / 4' }).waitFor();
    await page.getByRole('button', { name: 'Suivante →' }).dispatchEvent('click');

    // --- Lot 6.2 : l'écran d'encouragement s'intercale avant le résultat --------
    await page.locator('.encourage-passees').waitFor();
    await page.getByText('Il te reste 1 compétence passée dans cette thématique.').waitFor();
    await page.getByText('Le score est plus juste quand tout est évalué.').waitFor();
    await capturer(page, screenshotDir, 'encouragement-passees-desktop.png');
    // « Terminer la thématique » rouvre la compétence passée, là où elle a été laissée.
    await page.getByRole('button', { name: 'Terminer la thématique' }).dispatchEvent('click');
    await page.locator('body[data-panneau="situer"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.situer-nom').textContent(),
      `Je sais mobiliser la compétence ${DIM_MULTI.id}-01-04.`);
    await page.getByText('Tu avais passé cette compétence.', { exact: false }).waitFor();
    // Repassée : la proposition ne revient pas une seconde fois, on va au résultat.
    await page.getByRole('button', { name: 'Suivante →' }).dispatchEvent('click');

    await page.locator('body[data-panneau="resultat-theme"]').waitFor({ state: 'attached' });
    await page.getByRole('heading', { name: 'Résultat de la thématique' }).waitFor();
    assert.equal((await page.locator('.audit-bilan-score .syn-pct').textContent()).trim(), '50 %');

    // --- Lot 6.3 : la thématique finie replace le score dans sa dimension -------
    assert.equal((await page.locator('.encourage-progression').textContent()).trim(),
      `${DIM_MULTI.name} : 1 thématique sur 2 évaluée`);
    assert.equal(await page.locator('.encourage-segment').count(), 2);
    assert.equal(await page.locator('.encourage-segment.faite').count(), 1);
    assert.equal((await page.locator('.encourage-suite').textContent()).trim(),
      `Encore 1 thématique et tu auras ta carte complète de ${DIM_MULTI.name}.`);
    // Le premier choix de Poursuivre nomme la thématique suivante et son coût.
    const primaire = page.locator('.audit-suite-choix.principal');
    assert.equal(await primaire.count(), 1);
    assert.match(await primaire.textContent(), /^Continuer avec la suite de cette dimension/);
    assert.equal((await primaire.locator('small').textContent()).trim(),
      `Seconde thématique ${DIM_MULTI.id} · ~2 compétences, environ 1 min`);
    assert.deepEqual(dernierSnapshot.audit.passees, [`${DIM_MULTI.id}-01-04`],
      'la compétence passée part bien dans le payload');
    assert.match(dernierSnapshot.label, /^Thématique FON, \d+ \S+ \d{4}$/,
      'libellé automatique de fin de thématique');
    assert.equal(await page.locator('#barre-libelle').inputValue(), '',
      'le libellé automatique ne s\'écrit pas dans le champ visible');
    assert.equal(dernierSnapshot.audit.derniere.themeId, `theme-${DIM_MULTI.id}`);
    assert.equal(await page.getByRole('button', { name: 'Évaluer maintenant' }).count(), 1);
    // Elle revient sur le résultat, une pastille par compétence listée : deux à
    // travailler, plus la compétence passée.
    assert.equal(await page.locator('.audit-ligne .pastille-diff').count(), 3);
    assert.ok((await page.locator('.audit-ligne .pastille-diff').allTextContents())
      .includes('Socle fondamental'));
    await capturer(page, screenshotDir, 'resultat-theme-desktop.png');

    // Le bouton principal de « Poursuivre » doit être atteignable sans défiler.
    const hauteurPanneau = await page.locator('#panneau-corps').evaluate((element) => ({
      visible: element.clientHeight,
      total: element.scrollHeight,
      principal: element.querySelector('.audit-suite-choix.principal').getBoundingClientRect().bottom
        - element.getBoundingClientRect().top,
    }));
    assert.ok(hauteurPanneau.principal <= hauteurPanneau.visible,
      `le choix principal doit tenir sans scroll (${Math.round(hauteurPanneau.principal)} > ${hauteurPanneau.visible})`);

    // Et les deux colonnes ne doivent pas se marcher dessus. La hauteur seule ne voyait
    // rien : un débordement latéral reste à l'intérieur du corps du panneau, il ne crée
    // aucun défilement.
    const colonnes = await mesurerColonnes(page);
    assert.ok(colonnes.contenuGauche <= colonnes.boiteGauche + 1,
      `le contenu de la colonne gauche déborde de sa boîte de ${Math.round(colonnes.contenuGauche - colonnes.boiteGauche)} px`);
    assert.equal(colonnes.empilees, false, 'en 1280x700 le résultat tient bien en deux colonnes');
    assert.ok(colonnes.contenuGauche <= colonnes.suiteGauche + 1,
      `la colonne gauche recouvre le bloc Poursuivre de ${Math.round(colonnes.contenuGauche - colonnes.suiteGauche)} px`);

    // Poursuivre vers la thématique suivante de la dimension.
    await page.locator('[data-suite="continuer"]').dispatchEvent('click');
    await page.locator('.audit-sous-compteur', { hasText: `Thématique 2 / 2 de ${DIM_MULTI.name}` }).waitFor();
    assert.equal((await page.locator('.situer-compte').textContent()).trim(), '1 / 2');

    // Fermeture par la croix, puis reprise : on revient sur la bonne compétence.
    await page.locator('#panneau-fermer').dispatchEvent('click');
    await page.locator('#audit-reprise:not([hidden])').waitFor();
    assert.match(await page.locator('#audit-reprise').textContent(), /dernière thématique : Seconde thématique/);
    assert.equal(await page.locator('#audit-synthese').isVisible(), true,
      'la synthèse s\'ouvre dès une thématique complète');
    await page.getByRole('button', { name: 'Reprendre mon audit' }).dispatchEvent('click');
    await page.locator('body[data-panneau="situer"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.situer-nom').textContent(), `Je sais mobiliser la compétence ${DIM_MULTI.id}-02-01.`);
    await page.locator('#panneau-fermer').dispatchEvent('click');

    assert.equal(await page.locator('.ciel-categorie').count(), 3);
    assert.deepEqual(await page.locator('.ciel-categorie-titre').allTextContents(), [
      'Moi en tant que coach',
      'Moi et mes clients',
      'Moi et mon activité',
    ]);
    assert.equal(await page.locator('.ciel-dimension').count(), 7);
    const territoires = await page.locator('.ciel-categorie').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        overflowX: element.scrollWidth - element.clientWidth,
        overflowY: element.scrollHeight - element.clientHeight,
      };
    }));
    assert.ok(territoires.every((territoire) => territoire.height >= 380));
    assert.ok(territoires.every((territoire) => territoire.overflowX === 0 && territoire.overflowY === 0));
    assert.equal(await page.locator('.ciel-dimension-astre').count(), 7);
    assert.equal(await page.locator('.ciel-guide').count(), 0);
    await page.locator('[data-ouvrir="FON"]').dispatchEvent('click');
    await page.locator('body[data-vue="categorie"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.dimension.ouverte').count(), 2);
    assert.equal(await page.locator('.constellation').count(), 2);
    await page.locator('#detail-retour').dispatchEvent('click');
    await page.locator('#ciel:not([hidden])').waitFor();
    await page.locator('[data-categorie="COACH"]').dispatchEvent('click');
    await page.getByRole('heading', { name: 'Moi en tant que coach' }).waitFor();
    assert.equal(await page.locator('.dimension').count(), 2);
    assert.equal(await page.locator('.dimension.ouverte').count(), 2);
    assert.equal(await page.locator('.constellation').count(), 2);
    const espacementsProgression = await page.locator('.theme-nom').evaluateAll((noms) => noms.map((nom) => {
      const progression = nom.parentElement.querySelector('.theme-progression');
      return progression.getBoundingClientRect().top - nom.getBoundingClientRect().bottom;
    }));
    assert.ok(espacementsProgression.every((espace) => espace >= 4));
    await capturer(page, screenshotDir, 'zoom-categorie-desktop.png', { fullPage: true });
    await page.locator('[data-tab-categorie="CLIENTS"]').dispatchEvent('click');
    assert.equal(await page.locator('.dimension').count(), 3);
    await page.locator('[data-tab-categorie="COACH"]').dispatchEvent('click');
    await page.locator('[data-toggle="FON"]').dispatchEvent('click');
    await page.locator('[data-dimension="FON"].ouverte').waitFor();
    assert.equal(await page.locator('#presentation').isVisible(), false);
    assert.equal(await page.getByText('Thématique à débloquer').count(), 0);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const scrollAvantTheme = await page.evaluate(() => window.scrollY);
    await page.locator('[data-dimension="FON"] .theme[data-theme]').first().dispatchEvent('click');
    await page.locator('body[data-panneau^="theme:"]').waitFor({ state: 'attached' });
    await page.waitForTimeout(50);
    const scrollApresTheme = await page.evaluate(() => window.scrollY);
    assert.ok(Math.abs(scrollAvantTheme - scrollApresTheme) <= 1);
    await page.locator('#panneau-fermer').dispatchEvent('click');
    assert.equal(await page.locator('.etoile[data-competence="FON-01-01"] title').textContent(), 'Je sais provoquer la bascule* : agir sur la compétence FON-01-01.');
    await page.locator('.etoile[data-competence="FON-01-01"]').dispatchEvent('pointerenter', { pointerType: 'mouse', clientX: 300, clientY: 300 });
    await page.locator('#etoile-tooltip:not([hidden])').waitFor();
    assert.equal(await page.locator('#etoile-tooltip').textContent(), 'Je sais provoquer la bascule* : agir sur la compétence FON-01-01.');
    await page.locator('.etoile[data-competence="FON-01-01"]').dispatchEvent('pointerleave');
    // Compétence restée intacte pendant l'audit : la cocher depuis la carte doit
    // encore fonctionner, c'est l'usage « exploration libre » du même panneau.
    await page.locator('.etoile[data-competence="FON-02-02"]').dispatchEvent('click');
    await page.getByText('Un exemple observable pour FON-02-02.').waitFor();
    assert.equal(await page.locator('.marche[data-niveau]').count(), 3);
    // La fiche ouverte depuis la carte garde sa pastille de difficulté.
    assert.equal(await page.locator('#panneau .pastille-diff.panneau-diff').count(), 1);

    // Renvois au lexique : le mot astérisqué devient un bouton, son clic ouvre la
    // définition sur place, et l'infobulle mène au lexique complet.
    assert.equal(await page.locator('.panneau-def .lex-mot').textContent(), 'bascule*');
    // Typographie : une espace insécable tient le deux-points sur la ligne du mot.
    const definitionAffichee = await page.locator('.panneau-def').textContent();
    assert.equal(/ :/.test(definitionAffichee), false);
    assert.ok(/\u00a0:/.test(definitionAffichee));
    const motFils = page.locator('.marche-enonce .lex-mot').first();
    assert.equal(await motFils.textContent(), 'fils*');
    // Élision : seul « ancrage » est souligné, l'article reste du texte courant.
    assert.deepEqual(await page.locator('.marche-enonce .lex-mot').allTextContents(), ['fils*', 'ancrage*']);
    assert.match(await page.locator('.marche-enonce').textContent(), /tenir l'ancrage\*\./);
    // Lot 6.4 b : « fils* » revient dans le même marqueur, en rappel discret, pas en lien.
    assert.equal(await page.locator('.marche-enonce .lex-rappel').count(), 1);
    assert.equal(await page.locator('.marche-enonce .lex-rappel').textContent(), '*');
    await motFils.click();
    await page.locator('.lex-bulle[role="dialog"]').waitFor();
    assert.equal(await page.locator('.lex-bulle-terme').textContent(), 'Fils');
    assert.ok((await page.locator('.lex-bulle-def').textContent()).startsWith('Éléments repérés pendant une conversation'));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.lex-bulle').count(), 0);
    // Échap ne referme que l'infobulle : le panneau de la compétence reste ouvert.
    assert.equal(await page.locator('#voile.visible').count(), 1);
    await motFils.click();
    await page.getByRole('button', { name: 'Voir tout le lexique' }).click();
    await page.locator('#lexique-liste').waitFor();
    assert.equal(await page.locator('.lex-bulle').count(), 0);
    await page.locator('#panneau-fermer').dispatchEvent('click');
    // Retour sur la compétence après un détour par le lexique : ses marqueurs se
    // réaffichent, et c'est elle que l'on positionne juste après.
    await page.locator('.etoile[data-competence="FON-02-02"]').dispatchEvent('click');
    await page.getByText('Un exemple observable pour FON-02-02.').waitFor();

    await page.locator('.marche[data-niveau="3"]').dispatchEvent('click');
    await page.locator('#panneau-fermer').dispatchEvent('click');
    await page.locator('#btn-enregistrer').dispatchEvent('click');
    await page.getByText('Ton sphérier est enregistré.').waitFor();
    assert.equal(dernierSnapshot.levels['FON-02-02'], 3);
    // Les compétences passées survivent à un enregistrement déclenché ailleurs.
    assert.deepEqual(dernierSnapshot.audit.passees, [`${DIM_MULTI.id}-01-04`]);

    await page.locator('#btn-synthese').dispatchEvent('click');
    assert.equal(await page.locator('.syn-categorie-item').count(), 3);
    assert.deepEqual(await page.locator('.syn-categorie-nom').allTextContents(), [
      'Moi en tant que coach',
      'Moi et mes clients',
      'Moi et mon activité',
    ]);
    assert.equal(await page.locator('.syn-maitrise-item').count(), 3);
    await page.locator('.syn-maitrise-nom', { hasText: 'Socle fondamental' }).waitFor();
    await page.locator('.syn-maitrise-nom', { hasText: 'Professionnel établi' }).waitFor();
    assert.equal(await page.locator('[data-filtre="ouvertes"]').count(), 0);
    assert.equal(await page.locator('[data-filtre^="diff:"]').count(), 0);
    assert.ok(await page.locator('.syn-compte', { hasText: '3/4 évaluées' }).count() >= 1);
    assert.equal(await page.locator('.syn-theme').count(), 8);

    // Synthèse accessible avec une seule thématique complète : plus besoin d'avoir
    // évalué les 192 compétences pour lire ce qui est déjà là.
    await page.locator('#panneau-fermer').dispatchEvent('click');
    await page.locator('#detail-retour').dispatchEvent('click');
    await page.locator('#detail-retour').dispatchEvent('click');
    await page.locator('#audit-synthese:not([hidden])').waitFor();
    assert.equal(await page.getByText('Évalue au moins une thématique pour voir ton score').count(), 0,
      'le score des niveaux ne dépend plus d\'un audit terminé');
    await page.getByText('maîtrisées sur 1 thématique évaluée sur 8', { exact: false }).first().waitFor();
    await page.locator('#audit-synthese').dispatchEvent('click');
    await page.getByRole('heading', { name: 'Ton sphérier en un regard' }).waitFor();
    await page.getByText('sur 8 évaluée', { exact: false }).waitFor();
    // Le texte promet des pourcentages : la carte doit en porter, même sur un audit
    // partiel, et dire sur combien de thématiques ils reposent.
    assert.ok(await page.locator('.carte-resultat .ciel-score').count() >= 2,
      'la carte de la synthèse partielle affiche des pourcentages');
    await page.locator('.carte-resultat .ciel-dimension-compte', { hasText: 'maîtrisées sur 1/2 thématiques' }).waitFor();
    await page.locator('.carte-resultat .ciel-categorie-meta', { hasText: 'maîtrisées sur 1/3 thématiques' }).waitFor();
    // Un territoire dont rien n'est évalué le dit, au lieu d'afficher 0 %.
    assert.ok(await page.locator('.carte-resultat .ciel-dimension-compte', { hasText: 'Pas encore évalué' }).count() >= 1);
    await capturer(page, screenshotDir, 'synthese-partielle-desktop.png');

    // Le zoom de catégorie doit dire exactement la même chose que la carte : deux
    // écrans qui s'enchaînent et se contredisaient sur un audit partiel, l'un annonçant
    // un score et l'autre rien.
    const scoreCarte = (await page.locator('.carte-resultat [data-ouvrir="FON"] .ciel-dimension-compte')
      .textContent()).trim();
    assert.match(scoreCarte, /^\d+ % maîtrisées sur 1\/2 thématiques · \d+\/6 évaluées$/);
    await page.locator('#panneau-fermer').dispatchEvent('click');
    await page.locator('#ciel [data-explorer-categorie="COACH"]').dispatchEvent('click');
    await page.locator('[data-dimension="FON"]').waitFor();
    const scoreZoom = (await page.locator('.dimension[data-dimension="FON"] .dimension-compte')
      .textContent()).trim();
    assert.equal(scoreZoom, scoreCarte,
      'le zoom de catégorie et la carte affichent le même score');
    // Le pourcentage remonte aussi sur l'onglet de la catégorie et sur son en-tête.
    assert.equal(await page.locator('[data-tab-categorie="COACH"] .syn-pct').count(), 1);
    await page.locator('.categorie-detail-entete small', { hasText: 'maîtrisées sur 1/3 thématiques' }).waitFor();
    await capturer(page, screenshotDir, 'zoom-categorie-partiel-desktop.png');
    await page.locator('#detail-retour').dispatchEvent('click');
    await page.locator('#ciel:not([hidden])').waitFor();

    const publicPage = await navigateur.newPage({ viewport: { width: 1280, height: 900 } });
    await publicPage.goto(`http://127.0.0.1:${adresse.port}/`);
    await publicPage.getByRole('heading', { name: 'Accède au sphérier de compétences du coach' }).waitFor();
    await publicPage.locator('#acces-prenom').fill('Camille');
    await publicPage.locator('#acces-email').fill('camille@example.com');
    await publicPage.locator('#acces-consentement').check();
    const [reponseInscription] = await Promise.all([
      publicPage.waitForResponse('**/api/access'),
      publicPage.getByRole('button', { name: 'Recevoir mon lien personnel' }).click(),
    ]);
    // Le serveur répond 202 (accusé silencieux ou succès réel, indistinguables côté
    // front) : la confirmation normale doit s'afficher, pas une erreur.
    assert.equal(reponseInscription.status(), 202);
    await publicPage.getByRole('heading', { name: 'Ton lien personnel est en route' }).waitFor();
    assert.ok(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    // --- Lot 1 : réponse 429 sur le portail d'inscription -----------------------
    const page429 = await navigateur.newPage({ viewport: { width: 1280, height: 900 } });
    await page429.goto(`http://127.0.0.1:${adresse.port}/`);
    await page429.getByRole('heading', { name: 'Accède au sphérier de compétences du coach' }).waitFor();
    await page429.locator('#acces-prenom').fill('Dana');
    await page429.locator('#acces-email').fill('trop-de-demandes@example.com');
    await page429.locator('#acces-consentement').check();
    const [reponse429] = await Promise.all([
      page429.waitForResponse('**/api/access'),
      page429.getByRole('button', { name: 'Recevoir mon lien personnel' }).click(),
    ]);
    assert.equal(reponse429.status(), 429);
    await page429.getByText('Trop de demandes', { exact: false }).waitFor();
    assert.equal(await page429.getByRole('heading', { name: 'Ton lien personnel est en route' }).count(), 0);
    await page429.close();

    // --- Lot 1 : message serveur sans ponctuation finale (502) -------------------
    // Le message d'access.js pour ce cas ("L'envoi du lien n'a pas abouti") ne se
    // termine pas par un point : on vérifie qu'il en reçoit un avant la suite.
    const page502 = await navigateur.newPage({ viewport: { width: 1280, height: 900 } });
    await page502.goto(`http://127.0.0.1:${adresse.port}/`);
    await page502.getByRole('heading', { name: 'Accède au sphérier de compétences du coach' }).waitFor();
    await page502.locator('#acces-prenom').fill('Eve');
    await page502.locator('#acces-email').fill('envoi-impossible@example.com');
    await page502.locator('#acces-consentement').check();
    const [reponse502] = await Promise.all([
      page502.waitForResponse('**/api/access'),
      page502.getByRole('button', { name: 'Recevoir mon lien personnel' }).click(),
    ]);
    assert.equal(reponse502.status(), 502);
    await page502.getByText("L'envoi du lien n'a pas abouti. Réessaie dans quelques instants.").waitFor();
    await page502.close();

    // --- Lot 1 : mémorisation de l'UUID et reprise d'audit sur le même appareil -
    const repriseUuid = '00000000-0000-4000-8000-000000000001';
    const reprisePage = await navigateur.newPage({ viewport: { width: 1280, height: 900 } });
    await reprisePage.goto(`${url}`);
    await reprisePage.locator('#ciel:not([hidden])').waitFor();
    const memorise = await reprisePage.evaluate(() => localStorage.getItem('spherier-coachs:client'));
    assert.deepEqual(JSON.parse(memorise), { uuid: repriseUuid });

    // Retour à la racine, sans ?c= : le bloc « Reprendre mon audit » doit apparaître
    // au-dessus du formulaire d'inscription, qui reste accessible en dessous.
    await reprisePage.goto(`http://127.0.0.1:${adresse.port}/`);
    await reprisePage.getByRole('button', { name: 'Reprendre mon audit' }).waitFor();
    await reprisePage.getByRole('heading', { name: 'Accède au sphérier de compétences du coach' }).waitFor();
    await reprisePage.getByRole('button', { name: 'Reprendre mon audit' }).click();
    await reprisePage.locator('#ciel:not([hidden])').waitFor();
    assert.equal(reprisePage.url(), `http://127.0.0.1:${adresse.port}/?c=${repriseUuid}`);

    // « Ce n'est pas moi » efface la mémorisation et laisse le formulaire seul visible.
    await reprisePage.goto(`http://127.0.0.1:${adresse.port}/`);
    await reprisePage.getByRole('button', { name: 'Ce n’est pas moi' }).click();
    assert.equal(await reprisePage.locator('#acces-reprise').isVisible(), false);
    assert.equal(await reprisePage.evaluate(() => localStorage.getItem('spherier-coachs:client')), null);
    await reprisePage.getByRole('heading', { name: 'Accède au sphérier de compétences du coach' }).waitFor();

    // --- Lot 1 : mode « J'ai déjà un lien mais je ne le retrouve plus » ---------
    await reprisePage.getByRole('button', { name: 'J’ai déjà mon lien mais je ne le retrouve plus' }).click();
    await reprisePage.getByRole('heading', { name: 'Recevoir à nouveau mon lien' }).waitFor();
    await reprisePage.locator('#acces-prenom').fill('Camille');
    await reprisePage.locator('#acces-email').fill('camille@example.com');
    await reprisePage.locator('#acces-consentement').check();
    const [reponseRenvoi] = await Promise.all([
      reprisePage.waitForResponse('**/api/access'),
      reprisePage.getByRole('button', { name: 'Me renvoyer mon lien' }).click(),
    ]);
    assert.equal(reponseRenvoi.status(), 202);
    await reprisePage.getByRole('heading', { name: 'Ton lien est en route' }).waitFor();
    await reprisePage.getByText('Ouvre le mail envoyé à', { exact: false }).waitFor();
    await reprisePage.close();

    // --- Lot 1 : timeout réseau sur /api/access ----------------------------------
    // AbortSignal.timeout() rejette avec name: 'TimeoutError' (vérifié en Node), pas
    // 'AbortError' ni une TypeError : on le simule en stubbant fetch pour rester
    // rapide et déterministe plutôt que d'attendre un vrai timeout de 15 s.
    const timeoutPage = await navigateur.newPage({ viewport: { width: 1280, height: 900 } });
    await timeoutPage.addInitScript(() => {
      const fetchOriginal = window.fetch.bind(window);
      window.fetch = (entree, options) => {
        const cible = typeof entree === 'string' ? entree : entree?.url;
        if (cible && cible.includes('/api/access')) {
          return Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
        }
        return fetchOriginal(entree, options);
      };
    });
    await timeoutPage.goto(`http://127.0.0.1:${adresse.port}/`);
    await timeoutPage.getByRole('heading', { name: 'Accède au sphérier de compétences du coach' }).waitFor();
    await timeoutPage.locator('#acces-prenom').fill('Iris');
    await timeoutPage.locator('#acces-email').fill('iris@example.com');
    await timeoutPage.locator('#acces-consentement').check();
    await timeoutPage.getByRole('button', { name: 'Recevoir mon lien personnel' }).click();
    await timeoutPage.getByText('Le réseau a coupé, réessaie.').waitFor();
    assert.equal(await timeoutPage.getByRole('heading', { name: 'Ton lien personnel est en route' }).count(), 0);
    await timeoutPage.close();

    const resultatPage = await navigateur.newPage({ viewport: { width: 1280, height: 900 } });
    await resultatPage.goto(`http://127.0.0.1:${adresse.port}/?c=00000000-0000-4000-8000-000000000002`);
    await resultatPage.locator('#audit-cta').dispatchEvent('click');
    await resultatPage.getByRole('heading', { name: 'Ton sphérier en un regard' }).waitFor();
    assert.equal(await resultatPage.locator('.carte-resultat .ciel-categorie').count(), 3);
    assert.equal(await resultatPage.locator('.carte-resultat .niveau-accueil').count(), 3);
    await capturer(resultatPage, screenshotDir, 'resultat-avant-priorites-desktop.png');
    await resultatPage.getByRole('button', { name: 'Choisir mes trois priorités' }).click();
    await resultatPage.getByRole('heading', { name: 'Sélectionne tes principales zones de progression' }).waitFor();
    assert.equal(await resultatPage.locator('.audit-zone').count(), 5);
    const options = resultatPage.locator('.audit-competence');
    await options.nth(0).dispatchEvent('click');
    await options.nth(1).dispatchEvent('click');
    await options.nth(2).dispatchEvent('click');
    await resultatPage.locator('#audit-suite').dispatchEvent('click');
    await resultatPage.getByRole('heading', { name: 'Ton sphérier en un regard' }).waitFor();
    assert.equal(await resultatPage.locator('.priorite-marque').count() > 0, true);
    await resultatPage.getByRole('button', { name: 'Ouvrir la vue d’ensemble linéaire' }).click();
    assert.equal(await resultatPage.locator('.syn-categorie-item').count(), 3);
    assert.equal(await resultatPage.locator('.syn-maitrise-item').count(), 3);
    assert.equal(await resultatPage.locator('.syn-dim').count(), 7);
    assert.equal(await resultatPage.locator('.syn-theme').count(), 8);
    assert.equal(await resultatPage.locator('.audit-priorite').count(), 3);
    assert.equal(await resultatPage.locator('[data-audit-rdv]').count(), 2);
    assert.equal(await resultatPage.locator('#panneau.plein-ecran').count(), 1);
    await resultatPage.locator('#panneau-plein-ecran').dispatchEvent('click');
    assert.equal(await resultatPage.locator('#panneau.plein-ecran').count(), 0);
    await resultatPage.locator('#panneau-plein-ecran').dispatchEvent('click');
    assert.equal(await resultatPage.locator('#panneau.plein-ecran').count(), 1);
    assert.equal(await resultatPage.locator('#bar.visible').count(), 0);

    await resultatPage.locator('[data-scope-categorie="CLIENTS"]').dispatchEvent('click');
    await resultatPage.locator('#panneau-titre', { hasText: 'Moi et mes clients' }).waitFor();
    assert.equal(await resultatPage.locator('.syn-comp').count(), 2);
    assert.equal(await resultatPage.locator('.syn-comp-niveau', { hasText: 'Je maîtrise' }).count(), 0);
    await resultatPage.locator('#syn-voir-maitrisees').dispatchEvent('click');
    assert.equal(await resultatPage.locator('.syn-comp').count(), 3);
    await resultatPage.locator('#syn-retour').dispatchEvent('click');
    await resultatPage.locator('[data-scope-difficulte="Professionnel établi"]').dispatchEvent('click');
    await resultatPage.locator('#panneau-titre', { hasText: 'Professionnel établi' }).waitFor();
    assert.ok(await resultatPage.locator('.syn-comp').count() > 0);

    // --- Priorités : seulement des compétences réellement situées ---------------
    const priorites = await navigateur.newPage({ viewport: { width: 1280, height: 700 } });
    await priorites.goto(`http://127.0.0.1:${adresse.port}/?c=00000000-0000-4000-8000-000000000004`);
    await priorites.locator('#audit-synthese:not([hidden])').waitFor();
    await priorites.locator('#audit-synthese').dispatchEvent('click');
    await priorites.getByRole('button', { name: 'Choisir mes trois priorités' }).click();
    await priorites.getByRole('heading', { name: 'Sélectionne tes principales zones de progression' }).waitFor();
    // Deux thématiques entamées, cinq compétences situées entre 1 et 2. La sixième,
    // jamais évaluée, ne doit pas être proposée comme priorité.
    assert.equal(await priorites.locator('.audit-zone').count(), 2);
    assert.equal(await priorites.locator('.audit-competence').count(), 5);
    assert.equal(await priorites.locator('.audit-competence-niveau', { hasText: 'À évaluer' }).count(), 0,
      'une compétence jamais située ne peut pas devenir une priorité');
    assert.equal(await priorites.getByText(`Je sais mobiliser la compétence ${DIM_MULTI.id}-02-02.`).count(), 0);

    // --- Lot 7 : priorités de thématique ---------------------------------------
    // Le membre 0004 a quatre compétences situées entre 1 et 2 dans sa première
    // thématique : de quoi cocher trois priorités et se voir refuser la quatrième.
    const prioTheme = await navigateur.newPage({ viewport: { width: 1280, height: 900 } });
    await prioTheme.goto(`http://127.0.0.1:${adresse.port}/?c=00000000-0000-4000-8000-000000000004`);
    await prioTheme.locator('#ciel:not([hidden])').waitFor();
    await prioTheme.locator('#audit-cta').dispatchEvent('click');
    await prioTheme.locator(`[data-choix-dimension="${DIM_MULTI.id}"]`).dispatchEvent('click');
    await prioTheme.locator(`[data-evaluer-theme="theme-${DIM_MULTI.id}"]`).dispatchEvent('click');
    // La thématique est déjà complète : on arrive droit sur son résultat.
    await prioTheme.getByRole('heading', { name: 'Résultat de la thématique' }).waitFor();
    await prioTheme.getByText('Tes priorités pour cette thématique', { exact: true }).waitFor();
    const casesTheme = prioTheme.locator('#priorites-theme .audit-priorite-case');
    assert.equal(await casesTheme.count(), 4, 'les quatre compétences non maîtrisées sont proposées');
    // De la moins maîtrisée à la plus maîtrisée : les deux « Je ne maîtrise pas du
    // tout » passent devant les deux « Je dois m'améliorer ».
    assert.deepEqual(
      (await prioTheme.locator('#priorites-theme .audit-priorite-niveau').allTextContents()).map((t) => t.trim()),
      ['Je ne maîtrise pas du tout', 'Je ne maîtrise pas du tout', "Je dois m'améliorer", "Je dois m'améliorer"],
    );
    await casesTheme.nth(0).check();
    assert.match(await prioTheme.locator('#priorites-theme-compteur').textContent(), /^1 \/ 3/);
    await casesTheme.nth(1).check();
    await casesTheme.nth(2).check();
    assert.match(await prioTheme.locator('#priorites-theme-compteur').textContent(), /^3 \/ 3/);
    // La quatrième est refusée, la case revient d'elle-même et le message le dit.
    // `.check()` exigerait que la case reste cochée : ici elle doit revenir seule.
    await casesTheme.nth(3).click();
    assert.equal(await casesTheme.nth(3).isChecked(), false, 'la quatrième coche est refusée');
    await prioTheme.getByText('Trois priorités au maximum.', { exact: false }).waitFor();
    assert.match(await prioTheme.locator('#priorites-theme-compteur').textContent(), /^3 \/ 3/);
    // La fiche se déplie sur place, sans quitter l'écran de résultat.
    await prioTheme.locator('#priorites-theme summary').first().click();
    await prioTheme.getByRole('heading', { name: 'Résultat de la thématique' }).waitFor();
    assert.ok(await prioTheme.locator('#priorites-theme .audit-priorite-detail').first().isVisible());
    await capturer(prioTheme, screenshotDir, 'priorites-theme-desktop.png', { fullPage: true });
    // « Je choisirai plus tard » replie la section sans perdre les coches.
    await prioTheme.getByRole('button', { name: 'Je choisirai plus tard' }).click();
    assert.equal(await prioTheme.locator('#priorites-theme .audit-priorite-case').count(), 0);
    await prioTheme.getByRole('button', { name: 'Choisir maintenant' }).click();
    assert.equal(await prioTheme.locator('#priorites-theme .audit-priorite-case:checked').count(), 3);

    // Poursuivre déclenche l'enregistrement sans attendre le délai de deux secondes.
    const avantPriorites = nbSnapshots;
    await prioTheme.locator('[data-suite="theme"]').dispatchEvent('click');
    await prioTheme.waitForTimeout(500);
    assert.ok(nbSnapshots > avantPriorites, 'poursuivre enregistre les priorités cochées');
    assert.equal(dernierSnapshot.priorites.themes[`theme-${DIM_MULTI.id}`].length, 3);
    assert.deepEqual(dernierSnapshot.priorites.classement.slice().sort(),
      dernierSnapshot.priorites.themes[`theme-${DIM_MULTI.id}`].slice().sort(),
      'le classement reprend les priorités de thématique tant qu\'aucune dimension n\'est consolidée');
    assert.deepEqual(dernierSnapshot.selections.current.slice().sort(),
      dernierSnapshot.priorites.classement.slice().sort(),
      'les trois du classement deviennent les trois cibles du mois');

    const publicMobile = await navigateur.newPage({ viewport: { width: 390, height: 844 } });
    await publicMobile.goto(`http://127.0.0.1:${adresse.port}/`);
    await publicMobile.getByRole('heading', { name: 'Accède au sphérier de compétences du coach' }).waitFor();
    assert.equal(await publicMobile.locator('#header-etat').isVisible(), false);
    assert.ok(await publicMobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    const resultatMobile = await navigateur.newPage({ viewport: { width: 390, height: 844 } });
    await resultatMobile.goto(`http://127.0.0.1:${adresse.port}/?c=00000000-0000-4000-8000-000000000002`);
    await resultatMobile.locator('#audit-cta').dispatchEvent('click');
    await resultatMobile.getByRole('heading', { name: 'Ton sphérier en un regard' }).waitFor();
    await resultatMobile.getByRole('button', { name: 'Choisir mes trois priorités' }).waitFor();
    assert.ok(await resultatMobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    const mobile = await navigateur.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto(url);
    await mobile.locator('#ciel:not([hidden])').waitFor();
    await mobile.getByRole('button', { name: 'Comprendre comment fonctionne le sphérier' }).waitFor();
    assert.equal(await mobile.getByRole('heading', { name: 'À quoi sert le sphérier ?' }).isVisible(), false);
    assert.equal(await mobile.locator('.ciel-categorie').count(), 3);
    assert.equal(await mobile.locator('#bar.visible').count(), 0);
    await capturer(mobile, screenshotDir, 'accueil-mobile.png', { fullPage: true });
    await mobile.locator('[data-categorie="COACH"]').dispatchEvent('click');
    assert.equal(await mobile.locator('.dimension').count(), 2);
    assert.equal(await mobile.locator('.amas-mobile-piste').count(), 2);
    await mobile.locator('[data-toggle="FON"]').dispatchEvent('click');
    await mobile.locator('[data-dimension="FON"].ouverte .amas-mobile-piste').waitFor();
    assert.equal(await mobile.locator('[data-dimension="FON"].ouverte .amas-mobile').count(), 2);
    assert.equal(await mobile.locator('#ciel').isVisible(), false);
    await capturer(mobile, screenshotDir, 'detail-mobile.png');

    // --- Le parcours d'audit sur un téléphone --------------------------------
    await mobile.locator('#detail-retour').dispatchEvent('click');
    await mobile.locator('#detail-retour').dispatchEvent('click');
    await mobile.locator('#audit-cta').dispatchEvent('click');
    await mobile.locator('body[data-panneau="choix-dimension"]').waitFor({ state: 'attached' });
    assert.equal(await mobile.locator('.choix-carte').count(), DIMENSIONS.length);
    await capturer(mobile, screenshotDir, 'choix-dimension-mobile.png');
    await mobile.locator(`[data-choix-dimension="${DIM_MULTI.id}"]`).dispatchEvent('click');
    await mobile.locator('body[data-panneau="choix-theme"]').waitFor({ state: 'attached' });
    await capturer(mobile, screenshotDir, 'choix-theme-mobile.png');
    await mobile.locator(`[data-evaluer-theme="theme-${DIM_MULTI.id}"]`).dispatchEvent('click');
    await mobile.locator('.situer-compte', { hasText: '1 / 4' }).waitFor();
    await capturer(mobile, screenshotDir, 'evaluation-mobile.png');
    await mobile.locator('.marche[data-niveau="3"]').dispatchEvent('click');
    await mobile.locator('.situer-compte', { hasText: '2 / 4' }).waitFor();
    await mobile.locator('.marche[data-niveau="2"]').dispatchEvent('click');
    await mobile.locator('.situer-compte', { hasText: '3 / 4' }).waitFor();
    await mobile.locator('.marche[data-niveau="1"]').dispatchEvent('click');
    await mobile.locator('.situer-compte', { hasText: '4 / 4' }).waitFor();
    await mobile.getByRole('button', { name: 'Suivante →' }).dispatchEvent('click');
    // Une compétence passée : l'encouragement s'intercale, ici on choisit le résultat.
    await mobile.locator('.encourage-passees').waitFor();
    await capturer(mobile, screenshotDir, 'encouragement-passees-mobile.png');
    await mobile.getByRole('button', { name: 'Voir mon résultat quand même' }).dispatchEvent('click');
    await mobile.locator('body[data-panneau="resultat-theme"]').waitFor({ state: 'attached' });
    await mobile.getByRole('heading', { name: 'Résultat de la thématique' }).waitFor();
    // Le fil d'Ariane s'arrête avant « Agrandir » et la croix au lieu de passer dessous.
    const filMobile = await mobile.locator('.audit-fil').evaluate((fil) => {
      const bascule = document.getElementById('panneau-plein-ecran').getBoundingClientRect();
      const fermer = document.querySelector('.panneau-fermer').getBoundingClientRect();
      let droite = fil.getBoundingClientRect().left;
      fil.querySelectorAll('b, span').forEach((segment) => {
        const rect = segment.getBoundingClientRect();
        if (rect.width > 0) droite = Math.max(droite, rect.right);
      });
      return { droite, obstacle: Math.min(bascule.left, fermer.left) };
    });
    assert.ok(filMobile.droite <= filMobile.obstacle + 1,
      `le fil passe sous les boutons du panneau de ${Math.round(filMobile.droite - filMobile.obstacle)} px`);
    await capturer(mobile, screenshotDir, 'resultat-theme-mobile.png');
    // Les quatre suites restent atteignables, empilées, sans débordement latéral.
    assert.equal(await mobile.locator('.audit-suite-choix').count(), 4);
    const colonnesMobile = await mesurerColonnes(mobile);
    assert.equal(colonnesMobile.empilees, true, 'en 390x844 le résultat s\'empile en une colonne');
    assert.ok(colonnesMobile.contenuGauche <= colonnesMobile.boiteGauche + 1,
      'le contenu ne déborde pas de sa colonne sur mobile');
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.ok(await mobile.locator('#panneau-corps').evaluate((element) => element.scrollWidth <= element.clientWidth),
      'le corps du panneau ne défile pas horizontalement');
    await mobile.locator('[data-suite="dimension"]').dispatchEvent('click');
    await mobile.locator('body[data-panneau="choix-dimension"]').waitFor({ state: 'attached' });

    // Une thématique dont toutes les compétences sont passées part quand même vers le
    // serveur : sans cela, la reprise sur un autre appareil les redemanderait toutes.
    await mobile.locator(`[data-choix-dimension="${DIM_MULTI.id}"]`).dispatchEvent('click');
    await mobile.locator(`[data-evaluer-theme="theme-${DIM_MULTI.id}-2"]`).dispatchEvent('click');
    await mobile.getByRole('button', { name: 'Suivante →' }).dispatchEvent('click');
    await mobile.locator('.situer-compte', { hasText: '2 / 2' }).waitFor();
    await mobile.getByRole('button', { name: 'Suivante →' }).dispatchEvent('click');
    await mobile.getByText('Il te reste 2 compétences passées dans cette thématique.').waitFor();
    await mobile.getByRole('button', { name: 'Voir mon résultat quand même' }).dispatchEvent('click');
    await mobile.getByRole('heading', { name: 'Résultat de la thématique' }).waitFor();
    assert.deepEqual(dernierSnapshot.audit.passees.slice().sort(),
      [`${DIM_MULTI.id}-01-04`, `${DIM_MULTI.id}-02-01`, `${DIM_MULTI.id}-02-02`].sort());

    // Les deux thématiques sont complètes : le résultat de la dimension s'intercale
    // avant l'écran de suite.
    await mobile.getByRole('button', { name: /^Voir mon résultat de dimension/ }).click();
    await mobile.locator('body[data-panneau="resultat-dimension"]').waitFor({ state: 'attached' });
    await mobile.getByRole('heading', { name: 'Résultat de la dimension' }).waitFor();
    assert.equal(await mobile.locator('.audit-classement-ligne').count(), 2);
    assert.equal(await mobile.locator('.audit-suite-choix').count(), 3,
      'dimension bouclée : plus de « continuer avec la suite »');
    assert.equal((await mesurerColonnes(mobile)).empilees, true);
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await capturer(mobile, screenshotDir, 'resultat-dimension-mobile.png');

    // --- Reprise après un rechargement complet -------------------------------
    // Même parcours, nouvel onglet, aucun brouillon local : le contexte doit venir
    // du snapshot relu. C'est le cas qui ramenait les testeurs à la mauvaise question.
    const reprise = await navigateur.newPage({ viewport: { width: 1280, height: 700 } });
    await reprise.goto(`http://127.0.0.1:${adresse.port}/?c=00000000-0000-4000-8000-000000000003`);
    await reprise.locator('#ciel:not([hidden])').waitFor();
    await reprise.getByRole('button', { name: 'Reprendre mon audit' }).waitFor();
    assert.match(await reprise.locator('#audit-reprise').textContent(), /dernière thématique : Seconde thématique/);
    await reprise.getByRole('button', { name: 'Reprendre mon audit' }).dispatchEvent('click');
    // La dernière thématique n'a plus rien « à faire » : plutôt qu'un point de reprise
    // arbitraire, on repose la question du départ.
    await reprise.locator('body[data-panneau="choix-dimension"]').waitFor({ state: 'attached' });
    await reprise.locator(`[data-choix-dimension="${DIM_MULTI.id}"]`).dispatchEvent('click');
    await reprise.getByText('2 passées', { exact: false }).waitFor();
    // Entièrement passée : rouvrir la thématique démarre sur la première passée, pas
    // au début de la liste, et le rappel dit pourquoi.
    await reprise.locator(`[data-evaluer-theme="theme-${DIM_MULTI.id}-2"]`).dispatchEvent('click');
    await reprise.locator('.situer-nom').waitFor();
    assert.equal(await reprise.locator('.situer-nom').textContent(),
      `Je sais mobiliser la compétence ${DIM_MULTI.id}-02-01.`);
    await reprise.getByText('Tu avais passé cette compétence.', { exact: false }).waitFor();

    // --- Annuler ne remet pas en jeu les compétences passées ------------------
    // « Passée » est une décision de parcours, pas une modification en attente :
    // annuler des positionnements ne doit pas la reprendre au membre.
    const annulation = await navigateur.newPage({ viewport: { width: 1280, height: 700 } });
    await annulation.goto(url);
    await annulation.locator('#ciel:not([hidden])').waitFor();
    await annulation.getByRole('button', { name: 'Commencer mon audit' }).dispatchEvent('click');
    await annulation.locator(`[data-choix-dimension="${DIM_MULTI.id}"]`).dispatchEvent('click');
    await annulation.locator(`[data-evaluer-theme="theme-${DIM_MULTI.id}"]`).dispatchEvent('click');
    await annulation.locator('.situer-compte', { hasText: '1 / 4' }).waitFor();
    await annulation.getByRole('button', { name: 'Suivante →' }).dispatchEvent('click');
    await annulation.locator('.situer-compte', { hasText: '2 / 4' }).waitFor();
    await annulation.locator('.marche[data-niveau="2"]').dispatchEvent('click');
    await annulation.locator('.situer-compte', { hasText: '3 / 4' }).waitFor();

    await annulation.locator('#btn-annuler').dispatchEvent('click');
    await annulation.locator('#panneau-fermer').dispatchEvent('click');
    await annulation.getByRole('button', { name: 'Reprendre mon audit' }).dispatchEvent('click');
    await annulation.locator('.situer-nom').waitFor();
    // Le positionnement de la deuxième compétence est bien annulé, donc c'est elle qui
    // est à faire ; la première reste passée, sinon la reprise ouvrirait sur elle.
    assert.equal(await annulation.locator('.situer-nom').textContent(),
      `Je sais mobiliser la compétence ${DIM_MULTI.id}-01-02.`);
    assert.match((await annulation.locator('#situer-astuce').textContent()).trim(),
      /^Coche une marche, ou passe pour l'instant : tu pourras y revenir\./);
    // L'astuce clavier accompagne l'invitation sur desktop.
    assert.equal((await annulation.locator('.tinder-clavier').textContent()).trim(), '1, 2 ou 3 au clavier');

    // --- Enregistrement en échec, puis Réessayer -----------------------------
    // Le résultat reste affiché depuis le brouillon local, et le libellé automatique
    // ne laisse aucune trace dans le champ de la barre.
    echecSnapshot = true;
    await annulation.locator('.marche[data-niveau="3"]').dispatchEvent('click');
    await annulation.locator('.situer-compte', { hasText: '3 / 4' }).waitFor();
    await annulation.locator('.marche[data-niveau="3"]').dispatchEvent('click');
    await annulation.locator('.situer-compte', { hasText: '4 / 4' }).waitFor();
    await annulation.locator('.marche[data-niveau="3"]').dispatchEvent('click');
    // La première compétence est restée passée : l'encouragement passe avant le résultat.
    await annulation.getByRole('button', { name: 'Voir mon résultat quand même' }).dispatchEvent('click');
    await annulation.locator('body[data-panneau="resultat-theme"]').waitFor({ state: 'attached' });
    await annulation.locator('.audit-echec').waitFor();
    await annulation.getByRole('button', { name: "Réessayer l'enregistrement" }).waitFor();
    await annulation.getByRole('heading', { name: 'Résultat de la thématique' }).waitFor();
    assert.equal(await annulation.locator('#barre-libelle').inputValue(), '',
      'le champ de libellé reste vide quand l\'enregistrement échoue');

    echecSnapshot = false;
    await annulation.locator('#audit-reessayer').dispatchEvent('click');
    await annulation.locator('.audit-echec').waitFor({ state: 'detached' });
    assert.match(dernierSnapshot.label, /^Thématique FON, /,
      'le libellé automatique survit au Réessayer');

    // --- Résultat de la dimension, en 1280x700 --------------------------------
    // On termine la seconde thématique pour boucler la dimension.
    await annulation.locator('[data-suite="continuer"]').dispatchEvent('click');
    await annulation.locator('.situer-compte', { hasText: '1 / 2' }).waitFor();
    await annulation.locator('.marche[data-niveau="3"]').dispatchEvent('click');
    await annulation.locator('.situer-compte', { hasText: '2 / 2' }).waitFor();
    await annulation.locator('.marche[data-niveau="2"]').dispatchEvent('click');
    await annulation.locator('body[data-panneau="resultat-theme"]').waitFor({ state: 'attached' });
    assert.equal((await annulation.locator('.encourage-progression').textContent()).trim(),
      `${DIM_MULTI.name} : 2 thématiques sur 2 évaluées`);
    assert.equal((await annulation.locator('.encourage-suite').textContent()).trim(),
      'Dimension complète ! Tu peux voir ton résultat de dimension.');
    assert.equal(await annulation.locator('.encourage-segment.faite').count(), 2);
    await annulation.getByRole('button', { name: /^Voir mon résultat de dimension/ }).click();
    await annulation.locator('body[data-panneau="resultat-dimension"]').waitFor({ state: 'attached' });
    await annulation.getByRole('heading', { name: 'Résultat de la dimension' }).waitFor();

    // Thématiques classées de la moins à la plus maîtrisée.
    const classement = (await annulation.locator('.audit-classement-ligne .syn-pct').allTextContents())
      .map((texte) => parseInt(texte, 10));
    assert.equal(classement.length, 2);
    assert.deepEqual(classement, [...classement].sort((a, b) => a - b));
    // Et les deux colonnes ne se marchent pas dessus non plus sur cet écran.
    const colonnesDimension = await mesurerColonnes(annulation);
    assert.equal(colonnesDimension.empilees, false);
    assert.ok(colonnesDimension.contenuGauche <= colonnesDimension.suiteGauche + 1,
      'le classement recouvre le bloc Poursuivre');
    await capturer(annulation, screenshotDir, 'resultat-dimension-desktop.png');

    // --- Une compétence passée survit à deux rechargements ---------------------
    // `estModifie()` ignore les compétences passées : sans garde, le brouillon local
    // était effacé à la première relecture et la passée disparaissait à la suivante.
    const rechargement = await navigateur.newPage({ viewport: { width: 1280, height: 700 } });
    await rechargement.goto(url);
    await rechargement.locator('#ciel:not([hidden])').waitFor();
    await rechargement.getByRole('button', { name: 'Commencer mon audit' }).dispatchEvent('click');
    await rechargement.locator(`[data-choix-dimension="${DIM_MULTI.id}"]`).dispatchEvent('click');
    await rechargement.locator(`[data-evaluer-theme="theme-${DIM_MULTI.id}"]`).dispatchEvent('click');
    await rechargement.locator('.situer-compte', { hasText: '1 / 4' }).waitFor();
    await rechargement.getByRole('button', { name: 'Suivante →' }).dispatchEvent('click');
    await rechargement.locator('.situer-compte', { hasText: '2 / 4' }).waitFor();
    await rechargement.locator('#panneau-fermer').dispatchEvent('click');
    for (const passe of [1, 2]) {
      await rechargement.reload();
      await rechargement.locator('#ciel:not([hidden])').waitFor();
      await rechargement.getByRole('button', { name: 'Reprendre mon audit' })
        .waitFor({ timeout: 5000 })
        .catch(() => { throw new Error(`la compétence passée a été perdue au rechargement ${passe}`); });
    }
    await rechargement.getByRole('button', { name: 'Reprendre mon audit' }).dispatchEvent('click');
    assert.equal(await rechargement.locator('.situer-nom').textContent(),
      `Je sais mobiliser la compétence ${DIM_MULTI.id}-01-02.`,
      'la reprise saute la compétence passée');

    // --- Mobile : la barre de sauvegarde ne bloque pas « Reprendre mon audit » --
    // Empilée sur trois lignes, elle occupait 372 px de bas d'écran : même défilé tout
    // en bas, le bouton de reprise restait dessous et `elementFromPoint` renvoyait le
    // champ de saisie. C'est le critère de sortie du lot 1, en mobile.
    const mobileBarre = await navigateur.newPage({ viewport: { width: 390, height: 844 } });
    await mobileBarre.goto(url);
    await mobileBarre.locator('#ciel:not([hidden])').waitFor();
    await mobileBarre.getByRole('button', { name: /^(Commencer|Reprendre) mon audit$/ }).dispatchEvent('click');
    await mobileBarre.locator(`[data-choix-dimension="${DIM_MULTI.id}"]`).dispatchEvent('click');
    await mobileBarre.locator(`[data-evaluer-theme="theme-${DIM_MULTI.id}"]`).dispatchEvent('click');
    await mobileBarre.locator('.situer-compte').first().waitFor();
    // Un positionnement non enregistré, puis on quitte la thématique en cours : c'est
    // l'état que le rechargement doit restaurer, barre de sauvegarde comprise.
    await mobileBarre.locator('.marche[data-niveau="2"]').first().dispatchEvent('click');
    await mobileBarre.waitForTimeout(400);
    await mobileBarre.reload();
    await mobileBarre.locator('#ciel:not([hidden])').waitFor();
    await mobileBarre.locator('.barre-sauvegarde.visible').waitFor();

    const hauteurBarre = (await mobileBarre.locator('.barre-sauvegarde').boundingBox()).height;
    assert.ok(hauteurBarre < 110,
      `la barre de sauvegarde occupe ${Math.round(hauteurBarre)} px en 390x844, elle doit tenir sur une ligne`);

    const cible = mobileBarre.getByRole('button', { name: 'Reprendre mon audit' });
    await cible.waitFor();
    await mobileBarre.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await mobileBarre.waitForTimeout(80);
    const atteignable = await mobileBarre.evaluate(() => {
      const bouton = document.getElementById('audit-cta');
      const r = bouton.getBoundingClientRect();
      const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { trouve: dessus === bouton || bouton.contains(dessus), haut: Math.round(r.top), bas: Math.round(r.bottom) };
    });
    assert.ok(atteignable.trouve,
      `« Reprendre mon audit » est recouvert en 390x844 (haut=${atteignable.haut}, bas=${atteignable.bas})`);
    // Et le clic réel ouvre bien le parcours, sans interception.
    await cible.click({ timeout: 3000 });
    await mobileBarre.locator('#voile:not([hidden])').waitFor();
    await mobileBarre.close();

    // --- « M'évaluer sur cette dimension » depuis le zoom de catégorie ----------
    // Ce bouton ouvrait les compétences de la dimension d'un bloc, hors du parcours
    // modulaire : aucune frontière de thématique, donc aucun enregistrement, et l'écran
    // « Rien n'est encore enregistré » au bout. Il passe maintenant par
    // `evaluerDimension`, comme « Évaluer toute la dimension ».
    const avantZoom = nbSnapshots;
    const zoom = await navigateur.newPage({ viewport: { width: 1280, height: 700 } });
    await zoom.goto(url);
    await zoom.locator('#ciel:not([hidden])').waitFor();
    // Les trois boutons « Explorer cette catégorie → » portaient le même nom
    // accessible : un lecteur d'écran listait trois entrées identiques.
    const nomsExplorer = await zoom.locator('#ciel [data-explorer-categorie]')
      .evaluateAll((boutons) => boutons.map((b) => b.getAttribute('aria-label')));
    assert.equal(nomsExplorer.length, CATEGORIES.length);
    assert.equal(new Set(nomsExplorer).size, nomsExplorer.length,
      `noms accessibles en double sur « Explorer cette catégorie » : ${JSON.stringify(nomsExplorer)}`);
    await zoom.locator(`#ciel [data-explorer-categorie="${DIM_MULTI.category}"]`).dispatchEvent('click');
    await zoom.locator(`[data-situer="${DIM_MULTI.id}"]:visible`).first().dispatchEvent('click');
    await zoom.locator('body[data-panneau="situer"]').waitFor({ state: 'attached' });
    // Le contexte de thématique est là : sous-compteur présent et compteur borné à la
    // thématique, pas à la dimension entière.
    await zoom.locator('.audit-sous-compteur', { hasText: /^Thématique 1 \/ 2 de / }).waitFor();
    for (const rang of [1, 2, 3, 4]) {
      await zoom.locator('.situer-compte', { hasText: `${rang} / 4` }).waitFor();
      await zoom.locator('.marche[data-niveau="2"]').dispatchEvent('click');
    }
    await zoom.getByRole('heading', { name: 'Résultat de la thématique' }).waitFor();
    assert.equal(nbSnapshots - avantZoom, 1,
      'la fin de thématique lancée depuis le zoom de catégorie doit enregistrer');

    // Le bandeau de confirmation se pose sous l'en-tête du panneau : il recouvrait le
    // titre « Résultat de la thématique », le fil d'Ariane et la croix de fermeture
    // pendant ses quatre secondes. Et il annonce la thématique, pas la fin de la visite.
    await zoom.locator('.bandeau.visible').waitFor();
    assert.match(await zoom.locator('.bandeau.visible b').textContent(),
      /^Thématique enregistrée · \d+ % de maîtrise$/);
    const bandeauVsTete = await zoom.evaluate(() => {
      const b = document.getElementById('bandeau').getBoundingClientRect();
      const t = document.getElementById('panneau-tete').getBoundingClientRect();
      return { recouvre: !(b.bottom <= t.top || b.top >= t.bottom), bandeauHaut: Math.round(b.top), teteBas: Math.round(t.bottom) };
    });
    assert.ok(!bandeauVsTete.recouvre,
      `le bandeau recouvre l'en-tête du panneau (bandeau ${bandeauVsTete.bandeauHaut}, en-tête jusqu'à ${bandeauVsTete.teteBas})`);
    await zoom.close();

    // --- Écran d'attente pendant l'enregistrement de fin de thématique ----------
    delaiSnapshot = 400;
    const avantAttente = nbSnapshots;
    const attente = await navigateur.newPage({ viewport: { width: 1280, height: 700 } });
    await attente.goto(url);
    await attente.locator('#ciel:not([hidden])').waitFor();
    await attente.getByRole('button', { name: 'Commencer mon audit' }).dispatchEvent('click');
    await attente.locator(`[data-choix-dimension="${DIM_MULTI.id}"]`).dispatchEvent('click');
    await attente.locator(`[data-evaluer-theme="theme-${DIM_MULTI.id}-2"]`).dispatchEvent('click');
    await attente.locator('.situer-compte', { hasText: '1 / 2' }).waitFor();
    await attente.locator('.marche[data-niveau="3"]').dispatchEvent('click');
    await attente.locator('.situer-compte', { hasText: '2 / 2' }).waitFor();
    await attente.locator('.marche[data-niveau="3"]').dispatchEvent('click');
    // L'écran d'attente remplace la question : plus aucune marche à recliquer pendant
    // l'appel réseau, donc pas de second enregistrement de la même thématique.
    await attente.locator('.audit-attente').waitFor();
    assert.equal(await attente.locator('.marche[data-niveau]').count(), 0);
    await attente.getByRole('heading', { name: 'Résultat de la thématique' }).waitFor();
    assert.equal(nbSnapshots - avantAttente, 1, 'une seule fin de thématique enregistrée');
    delaiSnapshot = 0;

    // Principe 2.3 : sur l'écran d'évaluation, avec un énoncé de 3 lignes et 3
    // marqueurs (la compétence de DIM_LISIBILITE, voir plus haut), les boutons Précédente/Passer
    // restent dans le viewport sans scroll (pied ancré), et les 3 astres de l'escalier
    // ont la même taille — la progression se lit par la couleur, pas par la taille.
    for (const viewport of [{ width: 1280, height: 700 }, { width: 390, height: 844 }]) {
      const pageLisibilite = await navigateur.newPage({ viewport });
      await pageLisibilite.goto(url);
      await pageLisibilite.locator('#ciel:not([hidden])').waitFor();
      await pageLisibilite.getByRole('button', { name: 'Commencer mon audit' }).dispatchEvent('click');
      await pageLisibilite.locator('body[data-panneau="choix-dimension"]').waitFor({ state: 'attached' });
      await pageLisibilite.locator(`[data-choix-dimension="${DIM_LISIBILITE.id}"]`).dispatchEvent('click');
      await pageLisibilite.locator('body[data-panneau="choix-theme"]').waitFor({ state: 'attached' });
      await pageLisibilite.locator(`[data-evaluer-theme="theme-${DIM_LISIBILITE.id}"]`).dispatchEvent('click');
      await pageLisibilite.locator('.situer-compte').waitFor();
      await pageLisibilite.getByText('relation de travail suffisamment solide', { exact: false }).waitFor();

      for (const id of ['#situer-precedent', '#situer-passer']) {
        const boite = await pageLisibilite.locator(id).boundingBox();
        assert.ok(boite, `${id} introuvable (${viewport.width}x${viewport.height})`);
        assert.ok(
          boite.y >= 0 && boite.y + boite.height <= viewport.height,
          `${id} hors du viewport ${viewport.width}x${viewport.height} sans scroll (y=${boite.y}, hauteur=${boite.height})`
        );
        assert.ok(
          boite.x >= 0 && boite.x + boite.width <= viewport.width,
          `${id} hors du viewport en largeur ${viewport.width}x${viewport.height}`
        );
      }

      const hauteursConteneur = await pageLisibilite.locator('.marche-astre').evaluateAll(
        (elements) => elements.map((element) => element.getBoundingClientRect().height)
      );
      assert.equal(hauteursConteneur.length, 3);
      assert.ok(
        hauteursConteneur.every((h) => Math.abs(h - hauteursConteneur[0]) < 0.5),
        `Les 3 .marche-astre n'ont pas la même hauteur (${viewport.width}x${viewport.height}) : ${hauteursConteneur}`
      );

      // Contrôle plus strict : le point coloré lui-même (dernier cercle du svg, celui
      // du remplissage) doit avoir la même taille aux 3 crans — la taille ne doit
      // jamais porter la progression, seule la couleur/opacité le fait.
      const taillesAstres = await pageLisibilite.locator('.marche-astre svg circle:last-child').evaluateAll(
        (elements) => elements.map((element) => element.getBoundingClientRect().width)
      );
      assert.equal(taillesAstres.length, 3);
      assert.ok(
        taillesAstres.every((t) => Math.abs(t - taillesAstres[0]) < 0.5),
        `Les 3 points colorés de l'escalier n'ont pas la même taille (${viewport.width}x${viewport.height}) : ${taillesAstres}`
      );

      // Le pied vit hors de la zone qui défile : sur une compétence de taille réelle,
      // il ne doit recouvrir AUCUNE marche, ni à l'affichage initial ni une fois défilé
      // tout en bas. C'est la garantie que le pied sticky interne ne donnait pas.
      // On compare la partie VISIBLE de chaque marche (son rectangle rogné par la zone
      // qui défile) au rectangle du pied : une marche simplement sortie par le haut ou
      // par le bas du corps n'est pas recouverte, elle attend qu'on défile.
      const chevauchement = async () => pageLisibilite.evaluate(() => {
        const pied = document.querySelector('.situer-pied').getBoundingClientRect();
        const corps = document.getElementById('panneau-corps').getBoundingClientRect();
        return [...document.querySelectorAll('.marche')].map((marche) => {
          const m = marche.getBoundingClientRect();
          const haut = Math.max(m.top, corps.top);
          const bas = Math.min(m.bottom, corps.bottom);
          if (bas <= haut) return false; // marche entièrement hors de la zone visible
          return !(bas <= pied.top || haut >= pied.bottom);
        });
      });
      assert.deepEqual(
        await chevauchement(), [false, false, false],
        `Le pied recouvre au moins une marche à l'affichage initial (${viewport.width}x${viewport.height})`
      );
      await pageLisibilite.evaluate(() => {
        const corps = document.getElementById('panneau-corps');
        corps.scrollTop = corps.scrollHeight;
      });
      await pageLisibilite.waitForTimeout(50);
      assert.deepEqual(
        await chevauchement(), [false, false, false],
        `Le pied recouvre au moins une marche après scroll en bas (${viewport.width}x${viewport.height})`
      );
      // Une fois en bas du corps, les 3 marches doivent être entièrement dégagées :
      // dans le viewport ET dans la zone visible du corps. Une compétence longue impose
      // de défiler, jamais de renoncer à voir une marche.
      const marchesEnBas = await pageLisibilite.evaluate(() => {
        const corps = document.getElementById('panneau-corps').getBoundingClientRect();
        return [...document.querySelectorAll('.marche')].map((marche) => {
          const m = marche.getBoundingClientRect();
          return { top: Math.round(m.top), bottom: Math.round(m.bottom), corpsHaut: Math.round(corps.top), corpsBas: Math.round(corps.bottom) };
        });
      });
      assert.equal(marchesEnBas.length, 3);
      assert.ok(
        marchesEnBas.every((m) => m.top >= m.corpsHaut - 1 && m.bottom <= m.corpsBas + 1
          && m.top >= 0 && m.bottom <= viewport.height),
        `Les 3 marches ne sont pas toutes dégagées après scroll en bas (${viewport.width}x${viewport.height}) : ${JSON.stringify(marchesEnBas)}`
      );
      // Les boutons restent visibles quel que soit le défilement : le pied ne bouge pas.
      for (const id of ['#situer-precedent', '#situer-passer']) {
        const boite = await pageLisibilite.locator(id).boundingBox();
        assert.ok(
          boite && boite.y >= 0 && boite.y + boite.height <= viewport.height,
          `${id} hors du viewport après scroll en bas (${viewport.width}x${viewport.height})`
        );
      }

      await pageLisibilite.close();
    }

    // --- Lot 6.4 : lexique au survol, sans répétition, au niveau du dessus -----
    const lexique = await navigateur.newPage({ viewport: { width: 1280, height: 700 } });
    await lexique.bringToFront();
    await lexique.goto(`http://127.0.0.1:${adresse.port}/?c=00000000-0000-4000-8000-000000000009`);
    await lexique.locator('#ciel:not([hidden])').waitFor();
    await lexique.locator(`[data-ouvrir="${DIM_LISIBILITE.id}"]`).dispatchEvent('click');
    await lexique.locator('body[data-vue="categorie"]').waitFor({ state: 'attached' });
    await lexique.locator(`[data-dimension="${DIM_LISIBILITE.id}"] .theme[data-theme]`).first().dispatchEvent('click');
    await lexique.locator('body[data-panneau^="theme:"]').waitFor({ state: 'attached' });

    // c) Le titre de la thématique est cliquable.
    const titreMot = lexique.locator('#panneau-titre .lex-mot');
    assert.equal(await titreMot.count(), 1);
    assert.equal(await titreMot.textContent(), 'Ancrage*');
    // b) La définition répète le terme : rappel discret, pas un second lien.
    assert.equal(await lexique.locator('.panneau-def .lex-mot').count(), 0);
    assert.equal(await lexique.locator('.panneau-def .lex-rappel').count(), 1);
    // c) L'énoncé de la liste porte son propre terme, rendu en span : un bouton dans un
    // bouton n'est pas du HTML valide et le navigateur le sortirait de son parent.
    const motListe = lexique.locator('.comp-nom .lex-mot');
    assert.equal(await motListe.count(), 1);
    assert.equal(await motListe.textContent(), 'fils*');
    assert.equal(await motListe.evaluate((el) => el.tagName), 'SPAN');
    assert.equal(await lexique.locator('.comp-nom .lex-rappel').count(), 1,
      "« ancrage » est déjà pris par le titre : la liste n'en garde qu'un rappel");
    await capturer(lexique, screenshotDir, 'lexique-theme-desktop.png');

    // Le clic sur le mot ouvre la définition, pas la fiche de la compétence.
    const panneauAvant = await lexique.locator('body').getAttribute('data-panneau');
    await motListe.click();
    await lexique.locator('.lex-bulle[role="dialog"]').waitFor();
    assert.equal(await lexique.locator('.lex-bulle-terme').textContent(), 'Fils');
    assert.equal(await lexique.locator('body').getAttribute('data-panneau'), panneauAvant,
      'un mot du lexique cliqué dans la liste n\'ouvre pas la fiche de la compétence');
    await lexique.keyboard.press('Escape');
    await lexique.locator('.lex-bulle').waitFor({ state: 'detached' });

    // a) Survol : la définition s'ouvre sans clic, puis se referme quand on s'éloigne.
    await titreMot.hover();
    await lexique.locator('.lex-bulle[role="dialog"]').waitFor({ timeout: 5000 });
    assert.equal(await lexique.locator('.lex-bulle-terme').textContent(), 'Ancrage');
    await capturer(lexique, screenshotDir, 'lexique-survol-desktop.png');
    await lexique.mouse.move(5, 5);
    await lexique.locator('.lex-bulle').waitFor({ state: 'detached', timeout: 5000 });

    // c) Les listes de l'écran de résultat sont cliquables elles aussi, et suivent la
    // même règle : le titre du bilan prend « ancrage », la liste garde « fils ».
    await lexique.locator('#theme-evaluer').dispatchEvent('click');
    await lexique.locator('body[data-panneau="situer"]').waitFor({ state: 'attached' });
    await lexique.locator('.marche[data-niveau="1"]').dispatchEvent('click');
    await lexique.locator('body[data-panneau="resultat-theme"]').waitFor({ state: 'attached' });
    assert.equal(await lexique.locator('.audit-bilan-nom .lex-mot').count(), 1);
    const motResultat = lexique.locator('.audit-ligne-nom .lex-mot');
    assert.equal(await motResultat.count(), 1);
    assert.equal(await motResultat.textContent(), 'fils*');
    assert.equal(await motResultat.evaluate((el) => el.tagName), 'BUTTON',
      'hors conteneur cliquable, le mot reste un vrai bouton');
    await capturer(lexique, screenshotDir, 'lexique-resultat-desktop.png');
    await lexique.close();

    // a) Pointeur grossier : pas de survol, le tap reste le seul geste.
    const tactile = await navigateur.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await tactile.goto(`http://127.0.0.1:${adresse.port}/?c=00000000-0000-4000-8000-000000000010`);
    await tactile.locator('#ciel:not([hidden])').waitFor();
    assert.equal(
      await tactile.evaluate(() => window.matchMedia('(hover: hover) and (pointer: fine)').matches),
      false,
      'le contexte tactile doit bien se déclarer en pointeur grossier');
    await tactile.locator(`[data-categorie="${DIM_LISIBILITE.category}"]`).dispatchEvent('click');
    await tactile.locator(`[data-dimension="${DIM_LISIBILITE.id}"] .theme[data-theme]`).first().dispatchEvent('click');
    await tactile.locator('body[data-panneau^="theme:"]').waitFor({ state: 'attached' });
    await tactile.locator('#panneau-titre .lex-mot').dispatchEvent('mouseover');
    await tactile.waitForTimeout(600);
    assert.equal(await tactile.locator('.lex-bulle').count(), 0,
      'aucune bulle au survol sur pointeur grossier');
    await tactile.locator('#panneau-titre .lex-mot').dispatchEvent('click');
    await tactile.locator('.lex-bulle[role="dialog"]').waitFor();
    await tactile.close();

    // --- Lot 6.5 : la constellation ouvre le parcours modulaire ---------------
    // Depuis la carte : dimension → thématique → bouton primaire → évaluation avec
    // contexte, enregistrement automatique, résultat et écran Poursuivre.
    const constellation = await navigateur.newPage({ viewport: { width: 1280, height: 700 } });
    await constellation.goto(`http://127.0.0.1:${adresse.port}/?c=00000000-0000-4000-8000-000000000008`);
    await constellation.locator('#ciel:not([hidden])').waitFor();
    await constellation.locator(`[data-ouvrir="${DIM_MULTI.id}"]`).dispatchEvent('click');
    await constellation.locator('body[data-vue="categorie"]').waitFor({ state: 'attached' });
    await constellation.locator(`[data-dimension="${DIM_MULTI.id}"] .theme[data-theme]`).first().dispatchEvent('click');
    await constellation.locator('body[data-panneau^="theme:"]').waitFor({ state: 'attached' });
    const lancer = constellation.locator('#theme-evaluer');
    await lancer.waitFor();
    assert.match((await lancer.textContent()).trim(), /^Évaluer cette thématique · 4 compétences/);
    // La liste reste consultable à côté du bouton : c'est le mode exploration.
    assert.equal(await constellation.locator('.comp-item[data-competence]').count(), 4);
    const avantConstellation = nbSnapshots;
    await lancer.dispatchEvent('click');
    await constellation.locator('body[data-panneau="situer"]').waitFor({ state: 'attached' });
    // Contexte complet : fil d'Ariane et sous-compteur du parcours modulaire.
    await constellation.locator('.audit-sous-compteur', { hasText: `Thématique 1 / 2 de ${DIM_MULTI.name}` }).waitFor();
    assert.match(await constellation.locator('.panneau-fil').textContent(), new RegExp(DIM_MULTI.name));
    for (const rang of [1, 2, 3, 4]) {
      await constellation.locator('.situer-compte', { hasText: `${rang} / 4` }).waitFor();
      await constellation.locator('.marche[data-niveau="2"]').dispatchEvent('click');
    }
    await constellation.locator('body[data-panneau="resultat-theme"]').waitFor({ state: 'attached' });
    assert.equal(nbSnapshots - avantConstellation, 1,
      'une thématique lancée depuis la constellation enregistre en fin de parcours');
    await constellation.locator('.encourage-progression').waitFor();
    await constellation.locator('[data-suite="continuer"]').waitFor();
    await capturer(constellation, screenshotDir, 'resultat-depuis-constellation-desktop.png');
    await constellation.close();

    // --- Lot 6.2 : clavier, compteur enrichi, transition ----------------------
    const tinder = await navigateur.newPage({ viewport: { width: 1280, height: 700 } });
    await tinder.goto(`http://127.0.0.1:${adresse.port}/?c=00000000-0000-4000-8000-000000000006`);
    await tinder.locator('#ciel:not([hidden])').waitFor();
    await tinder.getByRole('button', { name: 'Commencer mon audit' }).dispatchEvent('click');
    await tinder.locator(`[data-choix-dimension="${DIM_MULTI.id}"]`).dispatchEvent('click');
    await tinder.locator(`[data-evaluer-theme="theme-${DIM_MULTI.id}"]`).dispatchEvent('click');
    await tinder.locator('.situer-compte', { hasText: '1 / 4' }).waitFor();
    assert.equal((await tinder.locator('.tinder-reste').textContent()).trim(), '· plus que 3');
    // Le lien discret remplace le grand bouton « Passer » du pied.
    await tinder.locator('#situer-passer-lien').waitFor();
    assert.equal(await tinder.getByRole('button', { name: 'Suivante →' }).count(), 1);

    // Les touches 1, 2 et 3 cochent les marches, la flèche gauche revient en arrière.
    await tinder.keyboard.press('2');
    await tinder.locator('.situer-compte', { hasText: '2 / 4' }).waitFor();
    await tinder.keyboard.press('3');
    await tinder.locator('.situer-compte', { hasText: '3 / 4' }).waitFor();
    await tinder.keyboard.press('ArrowLeft');
    await tinder.locator('.situer-compte', { hasText: '2 / 4' }).waitFor();
    assert.equal(await tinder.locator('.marche[data-niveau="3"][aria-pressed="true"]').count(), 1,
      'la compétence revue porte bien le niveau saisi au clavier');
    // La carte qui arrive porte l'animation d'entrée, côté d'où l'on vient.
    assert.equal(await tinder.locator('.situer.tinder-entree-gauche').count(), 1);
    await tinder.keyboard.press('1');
    await tinder.locator('.situer-compte', { hasText: '3 / 4' }).waitFor();
    await tinder.keyboard.press('1');
    await tinder.locator('.situer-compte', { hasText: '4 / 4' }).waitFor();
    assert.equal((await tinder.locator('.tinder-reste').textContent()).trim(),
      '· Dernière compétence de la thématique');
    // Rien n'a été passé : on va droit au résultat, sans écran d'encouragement.
    await tinder.keyboard.press('1');
    await tinder.locator('body[data-panneau="resultat-theme"]').waitFor({ state: 'attached' });
    assert.equal(await tinder.locator('.encourage-passees').count(), 0);
    await tinder.close();

    // Mouvement réduit : la transition ne translate plus rien.
    const calme = await navigateur.newPage({ viewport: { width: 1280, height: 700 }, reducedMotion: 'reduce' });
    await calme.goto(`http://127.0.0.1:${adresse.port}/?c=00000000-0000-4000-8000-000000000007`);
    await calme.locator('#ciel:not([hidden])').waitFor();
    await calme.getByRole('button', { name: 'Commencer mon audit' }).dispatchEvent('click');
    await calme.locator(`[data-choix-dimension="${DIM_MULTI.id}"]`).dispatchEvent('click');
    await calme.locator(`[data-evaluer-theme="theme-${DIM_MULTI.id}"]`).dispatchEvent('click');
    await calme.locator('.situer-compte', { hasText: '1 / 4' }).waitFor();
    await calme.locator('.marche[data-niveau="2"]').dispatchEvent('click');
    await calme.locator('.situer-compte', { hasText: '2 / 4' }).waitFor();
    const carteCalme = await calme.locator('.situer').evaluate((el) => ({
      classes: el.className,
      transform: getComputedStyle(el).transform,
    }));
    assert.equal(/tinder-(entree|sortie)/.test(carteCalme.classes), false,
      `aucune classe de transition en mouvement réduit (${carteCalme.classes})`);
    assert.equal(carteCalme.transform, 'none');
    await calme.close();

    // --- Lot 6.1 : la catégorie est évaluable ---------------------------------
    // L'en-tête de catégorie est une carte : elle enchaîne les dimensions de la
    // catégorie, et l'écran Poursuivre propose la suivante une fois la première finie.
    const categorie = await navigateur.newPage({ viewport: { width: 1280, height: 700 } });
    await categorie.goto(`http://127.0.0.1:${adresse.port}/?c=00000000-0000-4000-8000-000000000005`);
    await categorie.locator('#ciel:not([hidden])').waitFor();
    // Sur le ciel, le second bouton discret existe à côté d'« Explorer cette catégorie ».
    assert.equal(await categorie.locator('#ciel [data-evaluer-categorie]').count(), CATEGORIES.length);
    await categorie.getByRole('button', { name: 'Commencer mon audit' }).dispatchEvent('click');
    await categorie.locator('body[data-panneau="choix-dimension"]').waitFor({ state: 'attached' });
    assert.equal(await categorie.locator('.cat-carte').count(), CATEGORIES.length);
    const carteCoach = categorie.locator('.cat-carte[data-evaluer-categorie="COACH"]');
    const aide = carteCoach.locator('.cat-carte-aide');
    assert.match((await aide.textContent()).trim(), /^Évaluer cette catégorie · 2 dimensions · \d+ compétences$/);
    // Le texte d'aide est masqué au repos et se révèle au survol, sans disparaître du
    // flux : c'est l'opacité qui porte la révélation.
    assert.equal(await aide.evaluate((el) => getComputedStyle(el).opacity), '0');
    // Onglet au premier plan : une page d'arrière-plan ne produit plus d'images, et la
    // transition d'opacité y reste figée sur sa valeur de départ.
    await categorie.bringToFront();
    await carteCoach.hover();
    await categorie.waitForFunction(() => {
      const cible = document.querySelector('.cat-carte[data-evaluer-categorie="COACH"] .cat-carte-aide');
      return cible && getComputedStyle(cible).opacity === '1';
    }, null, { timeout: 4000 });
    // La flèche apparaît avec l'aide, et la carte s'élève.
    assert.equal(await carteCoach.locator('.cat-carte-fleche').evaluate((el) => getComputedStyle(el).opacity), '1');
    assert.notEqual(await carteCoach.evaluate((el) => getComputedStyle(el).transform), 'none');
    await capturer(categorie, screenshotDir, 'categorie-survol-desktop.png');

    // Clic sur l'en-tête : l'écran se resserre sur les dimensions de la catégorie, il ne
    // lance rien tout seul. Le membre choisit sa dimension, puis sa thématique.
    await carteCoach.dispatchEvent('click');
    await categorie.locator('.choix-carte').first().waitFor();
    assert.equal(await categorie.locator('body').getAttribute('data-panneau'), 'choix-dimension');
    assert.equal(await categorie.locator('#panneau-titre').textContent(), 'Moi en tant que coach');
    assert.equal(await categorie.locator('.choix-carte').count(), 2);
    assert.deepEqual(await categorie.locator('.choix-carte-nom').allTextContents(),
      ['Fondations du coach', 'Être du coach']);
    assert.equal(await categorie.locator('.cat-carte').count(), 0,
      'une fois dans la catégorie, plus de cartes de catégorie');
    await capturer(categorie, screenshotDir, 'categorie-resserree-desktop.png');
    // Aucune file : l'écran Poursuivre ne propose jamais « la suite de cette catégorie ».
    await categorie.locator(`[data-choix-dimension="${DIM_MULTI.id}"]`).dispatchEvent('click');
    await categorie.locator(`[data-evaluer-theme="theme-${DIM_MULTI.id}"]`).dispatchEvent('click');
    for (const rang of [1, 2, 3, 4]) {
      await categorie.locator('.situer-compte', { hasText: `${rang} / 4` }).waitFor();
      await categorie.locator('.marche[data-niveau="2"]').dispatchEvent('click');
    }
    await categorie.locator('body[data-panneau="resultat-theme"]').waitFor({ state: 'attached' });
    assert.equal(await categorie.locator('[data-suite="categorie"]').count(), 0);
    // « Toutes les dimensions » ramène à l'écran complet.
    await categorie.locator('[data-suite="dimension"]').dispatchEvent('click');
    await categorie.locator('.cat-carte').first().waitFor();
    await categorie.locator('.cat-carte[data-evaluer-categorie="CLIENTS"]').dispatchEvent('click');
    await categorie.locator('#choix-toutes-dimensions').dispatchEvent('click');
    assert.equal(await categorie.locator('#panneau-titre').textContent(), 'Choisis une dimension');
    assert.equal(await categorie.locator('.choix-carte').count(), DIMENSIONS.length);
    await categorie.close();

    console.log('UI desktop, mobile et sauvegarde simulée : OK');
  } finally {
    await Promise.race([
      navigateur.close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    serveur.closeAllConnections();
    await new Promise((resolve) => serveur.close(resolve));
  }
}

principal()
  .then(() => process.exit(0))
  .catch((erreur) => {
    console.error(erreur);
    process.exit(1);
  });
