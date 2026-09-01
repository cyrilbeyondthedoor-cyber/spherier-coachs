// ============================================================================
// CONFIGURATION DU CLUB — le seul fichier à relire pour monter une instance.
// ============================================================================
//
// Le sphérier a deux instances : `b2c` (Les Sommets, club de dev perso) et `coachs`
// (club de coachs). Même socle, contenus et référentiels différents, évolutions
// indépendantes ensuite.
//
// Tout ce qui distingue une instance de l'autre est ICI. Le reste du code ne connaît
// aucune dimension, aucun libellé, aucun seuil : il les lit dans ce fichier, et le
// navigateur les reçoit dans la réponse de `/api/referential`.
//
// Ce qui n'est PAS ici, et n'a pas à y être :
//   — le contenu (dimensions détaillées, thématiques, compétences, énoncés,
//     ressources) : il vit dans Notion et se modifie sans déploiement ;
//   — les secrets : ils vivent dans les variables d'environnement ;
//   — la géométrie du ciel (positions X/Y) : elle vit dans Notion aussi.
//
// Une chose IMPORTANTE, vérifiée sur le code : les préfixes des codes de compétences
// (`MOI-01`, `AUT-58`…) ne portent AUCUNE logique. Une compétence est rattachée à sa
// dimension par sa thématique, jamais par son code. Une autre instance peut donc
// choisir les préfixes qu'elle veut, ou n'en pas mettre.

// --- Quelle instance ? ------------------------------------------------------------
//
// Garde-fou contre une configuration croisée : si la variable CLUB de l'environnement
// ne correspond pas à ce que ce fichier déclare, c'est que le dépôt d'une instance
// tourne avec les secrets de l'autre. Sans ce contrôle, l'erreur serait silencieuse —
// on lirait le Notion d'un club en écrivant dans le Supabase de l'autre.
const CLUB = 'coachs';

const CLUBS_CONNUS = ['b2c', 'coachs'];

function verifierClub() {
  const attendu = CLUB;
  const declare = process.env.CLUB;
  if (!CLUBS_CONNUS.includes(attendu)) {
    throw new Error(`club.config.js : CLUB « ${attendu} » inconnu (attendus : ${CLUBS_CONNUS.join(', ')})`);
  }
  // La variable d'environnement est facultative en local ; si elle est posée, elle doit
  // correspondre. C'est en production qu'elle compte, où les deux instances existent.
  if (declare && declare !== attendu) {
    throw new Error(
      `CONFIGURATION CROISÉE : le code est celui du club « ${attendu} » mais la variable `
      + `d'environnement CLUB vaut « ${declare} ». Les secrets Notion et Supabase sont `
      + `probablement ceux de l'autre instance. On s'arrête plutôt que d'écrire au mauvais endroit.`
    );
  }
  return attendu;
}

// --- Version du référentiel -------------------------------------------------------
//
// À ne pas confondre avec le « v2 » des noms de fichiers, qui désigne la réécriture de
// l'application. Un snapshot d'une autre version est IGNORÉ et non relu : sans ce
// garde-fou, ses codes seraient tous filtrés comme inconnus et le membre apparaîtrait
// remis à zéro sans que rien ne le signale.
//
// À incrémenter à chaque changement de codes. Cette instance est neuve : elle part
// de 1, et n'a aucun rapport avec la version du club b2c.
const VERSION_REFERENTIEL = 1;

// --- Les dimensions ---------------------------------------------------------------
//
// Ces définitions n'existent PAS dans Notion : elles sont câblées ici. L'ordre du
// tableau est l'ORDRE CANONIQUE — celui de l'API, de la vue d'ensemble, de l'accordéon
// et des parcours d'évaluation. Le ciel a son propre ordre visuel (plus bas).
//
// Deux définitions par dimension :
//   definition     — version longue, pour le référentiel (Notion, Excel, documents)
//   definition_ui  — version courte et au TUTOIEMENT, pour l'interface
// Le tutoiement est la règle dans tout ce qui s'adresse au membre.
//
// `couleur` est la teinte de la dimension. Elle voyage jusqu'au navigateur, qui en
// fabrique ses variables CSS : aucun identifiant de dimension n'est écrit dans la
// feuille de style.
const DIMENSIONS = [
  // ---------------------------------------------------------------------------
  // À REMPLACER par les dimensions du club de coachs.
  //
  // Ce qui compte :
  //   `id`      court, stable, en MAJUSCULES. Il sert de clé partout dans le code et
  //             de préfixe conventionnel aux codes de compétences. Le changer après
  //             coup casse les teintes et l'ordre du ciel, jamais les données.
  //   `name`    DOIT correspondre EXACTEMENT à l'option du select `Dimension` de la
  //             base Thèmes dans Notion : c'est par ce nom que les thématiques sont
  //             rattachées à leur dimension. Une faute de frappe vide la dimension
  //             sans le moindre message d'erreur.
  //   `couleur` teinte de la dimension ; le navigateur en fabrique ses variables CSS.
  //             Éviter le doré (#c9a661), réservé à la sélection « ce mois ».
  //
  // L'ordre du tableau est l'ordre canonique : API, vue d'ensemble, accordéon,
  // parcours d'évaluation. Le ciel a son propre ordre visuel, plus bas.
  // ---------------------------------------------------------------------------
  {
    id: 'DIM1',
    name: 'Première dimension',
    definition: "Version longue, pour le référentiel et les documents.",
    definition_ui: "Version courte et au TUTOIEMENT, pour l'interface : c'est ce que le membre lit.",
    couleur: '#d97a4a',
  },
];



// --- L'échelle d'auto-évaluation --------------------------------------------------
//
// Les trois énoncés d'une compétence SONT l'échelle : le membre lit trois phrases en
// escalier et coche la plus haute qui est vraie pour lui. Le niveau 0 n'y figure pas :
// c'est l'absence d'énoncé coché, pas un palier nommé.
const ECHELLE = {
  1: 'Je découvre',
  2: "J'expérimente",
  3: "J'incarne",
};

// --- La difficulté d'une compétence -----------------------------------------------
//
// Propriété `Difficulté` dans Notion. Les NOMS doivent correspondre exactement aux
// options du select Notion : c'est la clé de correspondance.
//
// Le mot qualifie la COMPÉTENCE, pas la personne — un membre à « J'incarne » sur une
// compétence dite « Débutant » y lisait une contradiction avec l'échelle ci-dessus.
//
// Le vert et l'orange sont sémantiques : ils ne concurrencent ni les teintes de
// dimension ni le doré de la sélection.
const DIFFICULTES = [
  { nom: 'Fondamental', couleur: '#7c9c6e' },
  { nom: 'Avancé', couleur: '#d08b3f' },
];

// --- Règles de progression --------------------------------------------------------
//
// NIVEAU_ACQUIS : le palier à partir duquel une compétence compte pour ouvrir la
// thématique suivante. « J'expérimente », pas « J'incarne » : ouvrir doit rester
// atteignable.
//
// MAX_CIBLES_MAINTENANT : plafond des compétences travaillées « ce mois ». Contrainte
// pédagogique, appliquée par le SERVEUR autant que par l'interface.
//
// seuilDOuverture : combien de compétences d'une thématique source doivent atteindre
// NIVEAU_ACQUIS pour ouvrir ce qu'elle nourrit. `max(1, floor(n/2))` — la moitié, et
// jamais zéro. Conséquence à connaître : enrichir fortement une thématique la rend
// mécaniquement plus lente à ouvrir.
const NIVEAU_MIN = 0;
const NIVEAU_MAX = 3;
const NIVEAU_ACQUIS = 2;
const MAX_CIBLES_MAINTENANT = 3;

function seuilDOuverture(nombreDeCompetences) {
  return Math.max(1, Math.floor(nombreDeCompetences / 2));
}

// --- Le ciel (page d'accueil desktop) ---------------------------------------------
//
// `ordre` est l'ordre VISUEL des blocs, délibérément distinct de l'ordre canonique.
// « Moi » est le centre du modèle : les deux autres dimensions sont nommées par rapport
// à lui. Une disposition radiale dit cette structure, une disposition linéaire
// suggérerait un ordre de lecture qui n'existe pas.
//
// `centre` est le bloc sur lequel le ciel s'ouvre, centré, avec une amorce de chaque
// côté.
//
// `largeursFil` règle la largeur du fil décoratif de part et d'autre du bloc centré.
// Le fil ne porte aucun sens : sa largeur sert à ÉGALISER ce que montre chaque amorce.
// À place égale les voisines ne montrent pas la même chose — le bord clairsemé de l'une
// laisse voir moins de thématiques que le bord dense de l'autre. Ces valeurs sont donc
// MESURÉES sur le rendu réel, et à remesurer si la police de la constellation ou les
// positions changent.
//
// Une instance qui n'aurait pas trois dimensions laisse `ordre` et `centre` à null :
// le ciel retombe alors sur l'ordre canonique et centre le premier bloc.
const CIEL = {
  // À renseigner une fois les dimensions définies, et seulement si l'une d'elles est
  // le centre du modèle. Laissé à null, le ciel suit l'ordre canonique et centre la
  // première dimension : c'est un défaut correct, pas un réglage manquant.
  ordre: null,
  centre: null,
  // Largeurs du fil décoratif de part et d'autre du bloc centré. À MESURER sur le
  // rendu réel : elles servent à égaliser le nombre de thématiques visibles de chaque
  // côté, ce qui dépend de la densité des bords de chaque constellation.
  largeursFil: {},
};

// --- Journal de démarrage ---------------------------------------------------------
//
// Chaque fonction Netlify charge ce module, directement ou par le référentiel : cette
// ligne apparaît donc une fois par démarrage à froid, dans les journaux de l'instance.
// C'est la façon la plus directe de répondre à « sur quel club tourne cette fonction ? »
// sans avoir à appeler l'API.
//
// La vérification est faite ICI, au chargement, et non à la première requête : une
// configuration croisée doit échouer tout de suite et bruyamment, pas au moment où un
// membre enregistre.
verifierClub();
console.log(`[sphérier] club = ${CLUB} · référentiel v${VERSION_REFERENTIEL} · ${DIMENSIONS.length} dimensions`);

module.exports = {
  CLUB,
  CLUBS_CONNUS,
  verifierClub,
  VERSION_REFERENTIEL,
  DIMENSIONS,
  ECHELLE,
  DIFFICULTES,
  NIVEAU_MIN,
  NIVEAU_MAX,
  NIVEAU_ACQUIS,
  MAX_CIBLES_MAINTENANT,
  seuilDOuverture,
  CIEL,
};
