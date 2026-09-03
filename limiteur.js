// Limiteur de débit par adresse IP, partagé par les fonctions qui écrivent.
//
// Il vit dans la mémoire de l'instance serverless : remis à zéro à chaque démarrage à
// froid, non partagé entre instances. C'est un frein contre les rafales et les scripts
// naïfs, pas une garantie. Sans lui, n'importe qui pouvait empiler des snapshots pour
// n'importe quel UUID bien formé.
const FENETRE_MS = 10 * 60 * 1000;

function ipClient(event) {
  return String(event.headers?.['x-nf-client-connection-ip'] || event.headers?.['x-forwarded-for'] || 'inconnue')
    .split(',')[0].trim();
}

function creerLimiteur({ max, fenetreMs = FENETRE_MS }) {
  const tentativesParCle = new Map();
  return {
    depasse(cle) {
      const maintenant = Date.now();
      const recentes = (tentativesParCle.get(cle) || []).filter((date) => maintenant - date < fenetreMs);
      recentes.push(maintenant);
      tentativesParCle.set(cle, recentes);
      // Les clés inactives sont oubliées pour que la Map ne grossisse pas indéfiniment.
      if (tentativesParCle.size > 5000) {
        for (const [k, dates] of tentativesParCle) {
          if (dates.every((date) => maintenant - date >= fenetreMs)) tentativesParCle.delete(k);
        }
      }
      return recentes.length > max;
    },
  };
}

module.exports = { creerLimiteur, ipClient, FENETRE_MS };
