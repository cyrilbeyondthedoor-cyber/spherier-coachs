// Le palier d'acquisition et le seuil d'ouverture sont des réglages de club : ils
// vivent dans club.config.js. Le plancher à 1 du seuil y est expliqué — sans lui, une
// thématique très courte ouvrirait ses suites sans que rien n'ait été travaillé.
const { ECHELLE, NIVEAU_ACQUIS, seuilDOuverture } = require('./club.config.js');

const ECHELLE_V2 = ECHELLE;

// Calcul de l'ouverture des thématiques.
//
// La règle vit ICI et nulle part ailleurs : le serveur la calcule, le navigateur ne fait
// que l'afficher. L'état ouvert/verrouillé n'est jamais stocké — il se déduit toujours
// du dernier snapshot et du graphe courant, donc corriger une filiation dans Notion
// rouvre ou referme les thématiques sans migration de données.
//
// - Une thématique racine (que rien ne nourrit) est toujours ouverte.
// - Une thématique non racine est ouverte dès qu'AU MOINS UNE de ses sources a la
//   moitié de ses compétences (arrondi inférieur) au niveau 2 ou plus.
function calculerOuverture({ referentiel, levels = {} }) {
  const competencesParTheme = new Map();
  referentiel.competencies.forEach((c) => {
    if (!c.theme) return;
    if (!competencesParTheme.has(c.theme)) competencesParTheme.set(c.theme, []);
    competencesParTheme.get(c.theme).push(c.id);
  });

  const themeParId = new Map(referentiel.themes.map((t) => [t.id, t]));

  // Relation inverse : qui nourrit qui. `feeds` donne les cibles, on a besoin des sources.
  const sourcesParTheme = new Map(referentiel.themes.map((t) => [t.id, []]));
  referentiel.themes.forEach((source) => {
    source.feeds.forEach((cibleId) => {
      if (sourcesParTheme.has(cibleId)) sourcesParTheme.get(cibleId).push(source.id);
    });
  });

  // Avancement d'une thématique : combien de ses compétences ont atteint le niveau acquis,
  // et combien il en faut.
  function progression(themeId) {
    const codes = competencesParTheme.get(themeId) ?? [];
    const atteintes = codes.filter((code) => (levels[code] ?? 0) >= NIVEAU_ACQUIS).length;
    return { atteintes, seuil: seuilDOuverture(codes.length), total: codes.length };
  }

  const themes = {};
  referentiel.themes.forEach((theme) => {
    const sources = sourcesParTheme.get(theme.id) ?? [];

    if (sources.length === 0) {
      themes[theme.id] = { status: 'open', unlock_hint: '' };
      return;
    }

    const details = sources.map((sourceId) => {
      const source = themeParId.get(sourceId);
      const p = progression(sourceId);
      return { nom: source ? source.name : sourceId, ...p, satisfaite: p.atteintes >= p.seuil };
    });

    const ouverte = details.some((d) => d.satisfaite);
    themes[theme.id] = {
      status: ouverte ? 'open' : 'locked',
      unlock_hint: ouverte ? '' : indiceDeDeblocage(details),
    };
  });

  return themes;
}

// Phrase affichée sur une thématique verrouillée. Elle mène par ce qu'il RESTE à faire
// plutôt que par un score : « 1/2 » se lit comme une jauge et transforme le verrou en
// mur, alors qu'il doit se lire comme un horizon. Quand plusieurs chemins mènent à la
// même thématique, le « un seul suffit » passe en tête, sinon il se noie entre les
// conditions.
function indiceDeDeblocage(details) {
  const palier = ECHELLE_V2[NIVEAU_ACQUIS];
  const reste = (d) => Math.max(0, d.seuil - d.atteintes);
  const compte = (n) => `${n} compétence${n > 1 ? 's' : ''}`;

  // « dans » plutôt que « de » : évite l'élision devant les noms qui commencent par une
  // voyelle (« de Émotions » serait fautif) sans avoir à la gérer au cas par cas.
  if (details.length === 1) {
    const d = details[0];
    return `Encore ${compte(reste(d))} dans « ${d.nom} » au palier « ${palier} », et cette thématique s'ouvre.`;
  }

  // Le palier est sorti de l'énumération pour qu'il porte sur TOUS les chemins, et non
  // sur le dernier seulement.
  const nombre = details.length === 2 ? 'Deux' : 'Plusieurs';
  const chemins = details.map((d, i) => (i === 0 ? compte(reste(d)) : String(reste(d))) + ` dans « ${d.nom} »`).join(', ou ');
  return `${nombre} chemins mènent ici, un seul suffit : au palier « ${palier} », ${chemins}.`;
}

// Niveaux complets : toute compétence du référentiel est présente, à 0 par défaut.
// Le 0 n'est pas un palier nommé, c'est l'étoile éteinte.
function niveauxComplets({ referentiel, levels = {} }) {
  const complets = {};
  referentiel.competencies.forEach((c) => {
    complets[c.id] = normaliserNiveau(levels[c.id]);
  });
  return complets;
}

function normaliserNiveau(valeur) {
  const n = Number(valeur);
  if (!Number.isFinite(n)) return 0;
  return Math.min(3, Math.max(0, Math.round(n)));
}

module.exports = { calculerOuverture, niveauxComplets, normaliserNiveau, seuilDOuverture, NIVEAU_ACQUIS };
