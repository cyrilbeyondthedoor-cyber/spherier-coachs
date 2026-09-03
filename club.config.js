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
  // correspondre. C'est en production qu'elle compte, où les deux instances existent :
  // là, son absence est une erreur, sinon le garde-fou ne protège de rien.
  if (!declare && process.env.NETLIFY === 'true') {
    throw new Error(
      `CONFIGURATION INCOMPLÈTE : la variable d'environnement CLUB est absente sur Netlify. `
      + `Poser CLUB=${attendu} pour confirmer que les secrets Notion et Supabase sont ceux de cette instance.`
    );
  }
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
    couleur: '#b07d97',
  },
  {
    id: 'CLIENTS',
    name: 'Moi et mes clients',
    definition: 'La relation, la communication et les transformations que tu rends possibles avec tes clients.',
    couleur: '#7ca0bc',
  },
  {
    id: 'ACTIVITE',
    name: 'Moi et mon activité',
    definition: 'La manière dont tu construis, vends et fais vivre une activité de coaching durable.',
    couleur: '#bd7f5f',
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
  1: 'Je ne maîtrise pas du tout',
  2: "Je dois m'améliorer",
  3: 'Je maîtrise',
};

// --- La difficulté d'une compétence -----------------------------------------------
//
// Propriété `Difficulté` dans Notion. Les NOMS doivent correspondre exactement aux
// options du select Notion : c'est la clé de correspondance.
//
// Le mot qualifie la COMPÉTENCE, pas la personne : la difficulté reste distincte de
// l'auto-évaluation ci-dessus.
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
const THEME_LOCKING = false;
const BOOKING_URL = process.env.BOOKING_URL || 'https://calendly.com/thomasgibot/55min';

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

// --- Lexique de l'approche des Sommets -------------------------------------------
//
// Repris tel quel de l'onglet « Lexique » du classeur V6 (33 termes). Servi au
// navigateur par /api/referential, affiché dans un panneau depuis la page d'accueil.
// Les mots marqués d'un astérisque dans les énoncés renvoient à ces définitions.
const LEXIQUE = {
  titre: "Lexique de l'approche des Sommets",
  intro: "Au fil de son développement, l’approche des Sommets a construit un vocabulaire qui traduit sa vision et sa pratique du coaching. Nous avons simplifié les formulations de ce référentiel afin de le rendre clair et accessible. Certains termes ont été conservés car ils nomment avec précision des distinctions, des postures ou des techniques qui apportent une valeur réelle à notre manière de coacher. Les mots marqués d’un astérisque sont définis dans ce lexique.",
  termes: [
    { terme: "Sphérier de compétences", definition: "Référentiel qui organise les compétences attendues des coachs du Club selon plusieurs dimensions et niveaux cumulatifs." },
    { terme: "Dimension", definition: "Grand domaine de compétences utilisé pour structurer le Sphérier." },
    { terme: "Marqueur observable", definition: "Comportement concret permettant d’évaluer la maîtrise d’une compétence dans la pratique." },
    { terme: "Niveau Fondamental", definition: "Premier niveau du Sphérier. Il regroupe les acquis requis pour exercer sur un socle sain." },
    { terme: "Niveau TTC", definition: "Niveau de compétence requis pour accéder au dispositif « Trouve ton coach »." },
    { terme: "Niveau A-player", definition: "Niveau avancé correspondant à une pratique solide, fine et incarnée du coaching." },
    { terme: "Trouve ton coach (TTC)", definition: "Dispositif de mise en relation entre des clients et des coachs du Club ayant validé le niveau requis." },
    { terme: "Développement vertical et horizontal", definition: "Le développement horizontal enrichit les compétences. Le développement vertical transforme la façon dont une personne interprète le monde." },
    { terme: "Structure d’interprétation", definition: "Ensemble de croyances et de valeurs à travers lesquelles une personne comprend les situations et choisit ses actions." },
    { terme: "Fils", definition: "Éléments repérés pendant une conversation de coaching, en particulier durant la phase d’exploration. Le coach suit ces fils pour dépasser le sujet apparent et identifier l’enjeu profond qui aidera le client à avancer sur son enjeu de surface. Un fil peut être un mot récurrent, une émotion, une contradiction, une croyance, une règle formulée par « je dois » ou « il faut », une généralisation, un besoin, une valeur ou un motif qui se répète." },
    { terme: "Domino", definition: "Formulation concise de l’enjeu profond qui produit un effet de levier lorsqu’il est travaillé." },
    { terme: "Bascule", definition: "Changement de perspective qui redonne au client de l’espace, du choix et du pouvoir d’action." },
    { terme: "Ancrage", definition: "Intégration d’une prise de conscience dans la tête, le cœur et le corps afin de la rendre durable." },
    { terme: "Nouveaux possibles", definition: "Phase où le client ouvre plusieurs options après la bascule, avant de choisir ses actions." },
    { terme: "Programme de coaching", definition: "Parcours d’accompagnement structuré qui permet au client de travailler sur une transformation personnelle profonde." },
    { terme: "BVR", definition: "Besoins, Valeurs et Rêves. Trois leviers utilisés pour comprendre ce qui guide le client et soutenir une bascule." },
    { terme: "Reframing ou recadrage", definition: "Technique qui invite le client à regarder une situation depuis une autre perspective." },
    { terme: "Dépolarisation", definition: "Technique qui équilibre la perception d’une situation en explorant aussi ce qui contredit le récit initial." },
    { terme: "Parts de soi ou IFS", definition: "Modèle qui considère la personnalité comme un ensemble de parts protectrices, blessées ou réactives coordonnées par le Self." },
    { terme: "Phase d’exploration", definition: "Phase de la conversation de coaching durant laquelle le coach ouvre plusieurs angles autour du sujet du client, repère les fils porteurs et les approfondit. Elle permet de faire émerger l’enjeu profond avant de converger vers le domino." },
    { terme: "Enjeu de surface et enjeu profond", definition: "Distinction entre le sujet apporté au début de la conversation et l’enjeu sous-jacent révélé par l’exploration." },
    { terme: "Coaching émergent", definition: "Posture qui consiste à travailler avec ce qui apparaît pendant la séance, dans un cadre clair." },
    { terme: "Faits et histoires", definition: "Distinction entre les éléments observables et l’interprétation construite par le client." },
    { terme: "Lubrifiant verbal", definition: "Formulation qui présente une intuition avec prudence et laisse au client le choix de la valider." },
    { terme: "Cycles", definition: "Outil qui aide le client à quitter un cycle, clarifier ses besoins, accepter les deuils et entrer dans un nouveau cycle." },
    { terme: "Choix fort", definition: "Choix assumé qui inclut ce que le client décide et ce à quoi il accepte de renoncer." },
    { terme: "Dilemme", definition: "Tension entre deux options porteuses de besoins importants, explorée en cherchant un « ET » ou une priorité temporelle." },
    { terme: "Self", definition: "Dans l’IFS, centre stable associé à la clarté, au calme, à la confiance et à la compassion." },
    { terme: "Schéma narratif", definition: "Récit récurrent par lequel le client donne du sens à son identité, à ses expériences et à son enjeu. Le coaching l’aide à en reconnaître les limites et à faire émerger un récit plus profond, plus ouvert et plus cohérent avec la manière d’être qu’il souhaite incarner." },
    { terme: "Métacommunication", definition: "Action de nommer ce qui se joue dans l’échange ou dans la relation de coaching, en parlant depuis le « je », puis d’en vérifier la résonance et l’utilité avec le client." },
    { terme: "Impertinence", definition: "Capacité à questionner en dehors du champ de pertinence habituel du client afin d’ouvrir des angles qu’il n’avait pas envisagés. Elle s’appuie sur une alliance solide et une intervention ajustée." },
    { terme: "Miroir de l’enjeu", definition: "Phénomène par lequel ce qui se joue dans la séance reproduit l’enjeu rencontré par le client dans sa vie. Le coach peut utiliser cette dynamique comme terrain d’observation et de pratique en direct." },
    { terme: "Paradoxe", definition: "Formulation synthétique d’une caractéristique qui sert le client dans certaines situations et le limite face à son enjeu actuel." },
  ],
};

module.exports = {
  LEXIQUE,
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
  THEME_LOCKING,
  BOOKING_URL,
  seuilDOuverture,
};
