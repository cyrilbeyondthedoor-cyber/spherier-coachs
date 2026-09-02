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
const CATEGORIES = [
  {
    id: 'COACH',
    name: 'Moi en tant que coach',
    definition: 'Ton cadre, ta posture et la manière dont tu entretiens ton niveau de pratique.',
  },
  {
    id: 'CLIENTS',
    name: 'Moi et mes clients',
    definition: 'La relation, la communication et les transformations que tu rends possibles avec tes clients.',
  },
  {
    id: 'ACTIVITE',
    name: 'Moi et mon activité',
    definition: 'La manière dont tu construis, vends et fais vivre une activité de coaching durable.',
  },
];

const DIMENSIONS = [
  {
    id: 'FON',
    category: 'COACH',
    name: 'Fondations du coach',
    definition: 'La dimension Fondations du coach réunit les repères et pratiques qui rendent le coaching sûr, éthique et durable. Elle encadre la relation et protège l’autonomie du client.',
    definition_ui: 'Les repères qui rendent ta pratique sûre, éthique et durable.',
    couleur: '#a86f5d',
  },
  {
    id: 'ALL',
    category: 'CLIENTS',
    name: 'Alliance',
    definition: 'La dimension Alliance réunit les capacités qui permettent de créer et d’entretenir une relation de travail solide, sûre et vraie avec le client.',
    definition_ui: 'Ta capacité à créer et entretenir une relation de travail solide, sûre et vraie.',
    couleur: '#8fae9d',
  },
  {
    id: 'COM',
    category: 'CLIENTS',
    name: 'Communication',
    definition: 'La dimension Communication réunit les techniques d’écoute, de questionnement, de silence, de non-verbal et de langage que le coach met au service du client.',
    definition_ui: 'Les techniques d’écoute, de questionnement et de langage que tu mets au service du client.',
    couleur: '#7ca0bc',
  },
  {
    id: 'TRA',
    category: 'CLIENTS',
    name: 'Transformation du client',
    definition: 'La dimension Transformation du client réunit les capacités qui permettent de passer de l’enjeu exprimé à une compréhension plus profonde, puis à une nouvelle perspective que le client peut s’approprier et expérimenter.',
    definition_ui: 'Ta capacité à faire émerger puis ancrer une nouvelle perspective chez ton client.',
    couleur: '#9b86b3',
  },
  {
    id: 'ACT',
    category: 'ACTIVITE',
    name: 'Développement de l’activité',
    definition: 'La dimension Développement de l’activité réunit les capacités qui permettent au coach de rendre son activité compréhensible, désirable et viable, depuis l’expression de son identité jusqu’au pilotage d’une activité professionnelle.',
    definition_ui: 'Les capacités qui rendent ton activité compréhensible, désirable et viable.',
    couleur: '#bd7f5f',
  },
  {
    id: 'ENT',
    category: 'ACTIVITE',
    name: 'Intervenir en entreprise',
    definition: 'La dimension Intervenir en entreprise réunit les capacités qui permettent au coach d’inscrire, cadrer et conduire un accompagnement dans le système d’une entreprise.',
    definition_ui: 'Ta capacité à cadrer et conduire un accompagnement dans le système d’une entreprise.',
    couleur: '#718ba6',
  },
  {
    id: 'ETR',
    category: 'COACH',
    name: 'Être du coach',
    definition: 'La dimension Être du coach réunit les qualités personnelles, les postures et l’état d’esprit que le coach cultive et mobilise consciemment au service du client, ainsi que les pratiques qui assurent son développement continu.',
    definition_ui: 'Les postures, qualités et pratiques que tu cultives au service de tes clients.',
    couleur: '#b07d97',
  },
];



// --- L'échelle d'auto-évaluation --------------------------------------------------
//
// Le club de coachs évalue un énoncé unique avec les trois paliers du socle. Le niveau
// 0 n'y figure pas : c'est l'absence d'évaluation, pas un palier nommé.
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
  { nom: 'Socle fondamental', couleur: '#7c9c6e' },
  { nom: 'Professionnel établi', couleur: '#d08b3f' },
  { nom: 'A-player', couleur: '#a6789a' },
];

// --- Règles de progression --------------------------------------------------------
//
// NIVEAU_ACQUIS : le palier à partir duquel une compétence compte pour ouvrir la
// thématique suivante. Pour le club de coachs, seule une compétence incarnée est
// considérée comme acquise.
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
const NIVEAU_ACQUIS = 3;
const MAX_CIBLES_MAINTENANT = 3;

function seuilDOuverture(nombreDeCompetences) {
  return Math.max(1, Math.floor(nombreDeCompetences / 2));
}

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
  CATEGORIES,
  DIMENSIONS,
  ECHELLE,
  DIFFICULTES,
  NIVEAU_MIN,
  NIVEAU_MAX,
  NIVEAU_ACQUIS,
  MAX_CIBLES_MAINTENANT,
  seuilDOuverture,
};
