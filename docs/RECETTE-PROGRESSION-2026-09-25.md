# Recette de la progression, 25 septembre 2026

Branche : `codex/spherier-progression`, issue de `a335e91`. La recette utilise des comptes fictifs et des écritures en mémoire. Le référentiel public réel a été relu : 192 compétences, 33 thématiques et 7 dimensions.

## Changements livrés

- Sauvegardes de notes en série par compétence. Les derniers mots restent en brouillon jusqu’à leur confirmation. Une révision de départ protège les reprises sur un autre appareil.
- Brouillons séparés par onglet, repère de navigation distinct des réponses, fusion des changements indépendants et choix explicite en cas de conflit.
- Écritures atomiques de snapshots et notes par RPC PostgreSQL ; réponses 409 et 428 explicites. Une note vidée conserve sa révision et actualise sa date.
- Calcul commun de maîtrise parmi les compétences évaluées. Couverture et compétences passées restent distinctes. Les anciens calculs moyens sur trois niveaux ont été retirés.
- Classement unique, au plus trois priorités actives, retrait jusqu’à zéro et conservation du choix lorsqu’une priorité devient maîtrisée.
- Réponses fixes sur mobile, marqueurs dépliables, reprise du mode choisi et de la compétence courante, navigation et lexique accessibles au clavier.
- Thèmes clair et sombre, choix mémorisé et préférence système par défaut. Recherche, tri et retour au même endroit dans la synthèse.
- Tableau de bord « Mon mois » : action, situation, signe de progrès, observations, mise à jour du niveau, retrait annulable et réorganisation.
- Bilans explicites datés, lecture paginée, anciennes sauvegardes consultables, comparaison des seules compétences évaluées aux deux dates et fiche imprimable.
- Calculs, persistance, navigation et tableau de bord extraits en scripts dédiés, sans changement de stack.

## Vérifications

Les commandes et les limites des tests sont décrites dans [la mise en service](MISE-EN-SERVICE-PROGRESSION.md).

Résultats locaux du 25 septembre :

| Vérification | Résultat |
| --- | --- |
| `npm test` : serveur, interface historique, progression, SQL, accessibilité | Réussi |
| `npm run test:webkit` : régressions de progression | Réussi |
| `test:notion` avec la copie publique du référentiel réel | Réussi, 192 compétences et 33 thématiques |
| axe, accueil, tableau de bord, synthèse et évaluation, deux thèmes | Aucune violation détectée sur les règles testées |
| Migration PostgreSQL appliquée deux fois, RPC et droits | Réussi sur PGlite |

Les checks de la PR complètent ces essais avec une installation propre sous Linux.

Les nouveaux scénarios couvrent : réponse de note lente pendant une nouvelle saisie, échec réseau et reprise, ancien brouillon face à une nouvelle note, deux appareils, deux onglets partageant le même stockage, stockage indisponible, priorités vides et annulation d’un retrait, bilans successifs, impression, reprise de la dimension et recherche conservée.

Les dimensions d’écran vérifiées incluent 390 × 844, 1280 × 700 et 640 × 400 pour le comportement à fort zoom. Chromium et WebKit sont utilisés. Le contrôle axe vérifie l’accueil, le tableau de bord, la synthèse et l’évaluation dans les deux thèmes.

La migration a été appliquée deux fois sur un PostgreSQL embarqué. Les tests exécutent les RPC, les conflits de version, les révisions de notes vides et le rôle de service. Les appels concurrents y sont sérialisés par le moteur à connexion unique ; la contention réelle entre deux connexions reste dans la recette Supabase d’aperçu.

## Conditions avant diffusion

La production n’est pas modifiée par cette recette. Restent à effectuer avec les accès administrateur : migration et test de contention sur Supabase d’aperçu, déploiement Netlify d’aperçu connecté à cette base, réception réelle des mails, réglage du badge Netlify, essai Safari/iPhone physique, puis migration de production et vérification du site publié.

Les six propositions de pratiques sont dans [Pratiques à valider](PRATIQUES-A-VALIDER.md). Elles attendent une validation pédagogique avant leur publication dans le référentiel.
