# Mise en service de la progression du Sphérier

Cette version ajoute le tableau de bord « Mon mois », des bilans explicites, la pratique par compétence, un thème clair et la protection contre les écritures concurrentes. Elle conserve le référentiel et les anciens snapshots.

## Ordre de publication

1. Sauvegarder les tables `snapshots` et `notes` du projet Supabase **du club de coachs**, dans un emplacement privé géré par l’administrateur.
2. Appliquer `supabase/migrations/20260925_progression.sql` sur une base d’aperçu. La migration est idempotente. Pour une base neuve, appliquer d’abord `supabase/schema.sql` puis les migrations.
3. Vérifier les droits : les deux RPC doivent être exécutables par `service_role` seulement. Les tables gardent RLS active et aucune policy d’accès public. `notes.revision` doit exister ; les anciennes notes commencent à 1.
4. Déployer cette branche dans un aperçu Netlify relié à cette base isolée. Vérifier `CLUB=coachs`. Le dépôt ne contient aucun secret ; conserver les variables Notion/Supabase existantes dans les réglages de l’aperçu. Éviter de brancher un aperçu de test sur les données de production.
5. Rejouer la recette ci-dessous, dont le test de deux sessions SQL réellement distinctes et la recette Safari/iPhone physique.
6. Appliquer la même migration en production avant la publication des fonctions. Vérifier les RPC avec un compte technique de recette, puis publier le code.
7. Vérifier `/version.txt`, `/api/referential`, un chargement par lien personnel, une note, un changement de niveau, un bilan et sa relecture sur un second navigateur.

Les navigateurs restés sur une ancienne version reçoivent **428** s’ils écrivent sans version de départ. Leur brouillon reste local ; ils doivent recharger la page. Il faut éviter les écritures pendant le court intervalle migration/déploiement : l’ancienne fonction de sauvegarde contourne encore les nouvelles RPC.

Le badge Netlify est configuré par l’administrateur du site. Désactiver son injection dans les réglages de production et vérifier qu’aucun badge ne recouvre les contrôles, notamment sur iPhone. Aucun masquage CSS ne remplace cette vérification.

## Contrat de sauvegarde

- `POST /api/snapshot` exige `base_snapshot_id` (`null` pour la première écriture), `kind` (`autosave` par défaut ou `checkpoint`), et accepte `practice` par code de compétence. Les champs sont `action`, `situation`, `evidence`, `observation`, chacun limité à 2 000 caractères.
- `POST /api/note` exige `base_revision` (`null` à la création). Une note vidée garde une ligne vide et une révision. Cela empêche un ancien onglet de recréer le texte effacé. La date `maj_le` est mise à jour par la RPC.
- Une RPC prend un verrou de transaction par membre, ou par membre/compétence pour les notes, puis compare la version et écrit. Une version dépassée renvoie **409**. Aucun remplacement automatique n’a lieu sur un conflit.
- `GET /api/history?uuid=…` renvoie au plus 20 bilans, triés par date puis identifiant. `nextCursor` permet la page suivante. La liste transporte les niveaux et sélections ; `GET /api/history?uuid=…&id=…` charge un bilan complet avec ses textes de pratique, pour garder les réponses paginées légères. `legacy=true` inclut les snapshots antérieurs sans champ `kind`, identifiés comme anciennes sauvegardes dans l’interface.
- Les anciens snapshots sont lisibles. Leur absence de `practice`, `audit` ou `priorites.initialized` reçoit des valeurs par défaut. Un classement initialisé puis vidé reste vide.
- Le référentiel garde sa version actuelle. Un code retiré n’entre plus dans les calculs courants ; un bilan conserve ses données d’origine. La comparaison porte sur les codes présents aujourd’hui et évalués aux deux dates. Deux versions de référentiel différentes restent consultables séparément.

Les réponses à ces API portent `Cache-Control: no-store`. Les lectures du référentiel conservent leur cache existant.

## Recette reproductible

Après `npm ci` et `npx playwright install chromium webkit` :

```sh
npm run test:server
npm run test:ui
npm run test:progression
npm run test:sql
npm run test:a11y
npm run test:webkit
npm run preview:progression
```

`preview:progression` utilise un faux serveur en mémoire et un petit référentiel de recette. Pour vérifier les vraies tailles de contenu, enregistrer la réponse publique de `/api/referential` dans un fichier temporaire puis lancer `node preview-progression.js /chemin/reference.json`. Cet aperçu ne contacte ni Supabase ni Notion pour écrire.

Les tests SQL utilisent PostgreSQL embarqué (PGlite). Ils exécutent réellement la migration, les RPC, les contrôles de version, les notes vides et les droits. Ce moteur dispose d’une seule connexion. **La contention simultanée entre deux connexions doit aussi être vérifiée sur Supabase d’aperçu** : deux appels partant du même identifiant de snapshot doivent donner un succès et un conflit ; même contrôle pour les notes.

Les tests WebKit incluent les écrans 390 × 844, 1280 × 700 et un viewport équivalent au zoom 200 %. Ils ne remplacent pas un essai sur Safari et iPhone physiques, notamment clavier virtuel, impression et comportement en arrière-plan.

Vérifier aussi la réception réelle des mails d’accès et de renvoi de lien. Le faux serveur de recette ne livre aucun mail.

## Retour arrière

Conserver une sauvegarde privée avant migration. Les ajouts de colonne, index et fonctions n’effacent aucune donnée. Garder la migration appliquée si le front est temporairement retiré. Revenir aux anciennes fonctions de sauvegarde supprimerait la protection de concurrence : suspendre les écritures avant ce retour et corriger la version fautive. Ne pas supprimer les colonnes ou les bilans créés pour revenir à l’ancien affichage.

## Révocation d’un lien personnel

Le lien est un secret d’accès. L’ancien modèle n’a pas de table de comptes ni de jetons révoqués. Pour retirer l’accès aux données existantes tout en conservant le travail :

1. Identifier le membre dans le suivi d’accès, sans recopier son lien dans une issue ou un journal public.
2. Générer un nouvel UUID v4. Dans une transaction Supabase, déplacer **tous** ses snapshots et notes de l’ancien `client_id` vers le nouveau. Vérifier auparavant que le nouvel UUID n’a aucune donnée.
3. Mettre à jour l’UUID de référence dans le suivi Notion et dans tout flux de renvoi de lien pour que l’ancien lien ne soit plus envoyé.
4. Tester que l’ancien UUID ne renvoie plus les données, et que le nouveau rend les mêmes notes et bilans. L’ancien UUID pourra encore ouvrir un espace vide : une révocation complète des jetons nécessitera une table d’accès dédiée.
5. Transmettre le nouveau lien par le canal prévu avec le membre. Sur ses appareils, effacer les données locales de l’ancien lien via les réglages de stockage du navigateur.

La rotation ne peut pas retirer une copie déjà chargée sur un appareil tiers. Un accès par lien suppose cette limite. Une évolution vers des comptes authentifiés est un chantier distinct.

## Suppression des données

Après identification du membre et définition du périmètre demandé :

1. Dans une transaction de la bonne base, supprimer les lignes de `notes` et `snapshots` pour son `client_id`. Contrôler les nombres de lignes avant et après. Utiliser des paramètres SQL et une égalité exacte sur l’UUID.
2. Supprimer ou mettre à jour la fiche correspondante dans le suivi Notion et les données de workflow concernées, selon le périmètre demandé. Vérifier le renvoi automatique du lien.
3. Effacer les données de ce lien dans les navigateurs contrôlés par le membre : brouillons, notes, repères et copies de récupération utilisent les préfixes `spherier-`. Les bilans imprimés ou téléchargés se traitent à part.
4. Vérifier que les deux lectures API renvoient un espace vide. Consigner l’opération sans conserver le texte des notes ni le lien complet dans un journal général.
5. Traiter les sauvegardes administrateur selon leur politique de conservation. Une suppression dans les tables actives ne purge pas automatiquement une sauvegarde déjà prise.

Ces opérations restent administratives. Cette version n’ajoute aucun bouton de suppression de compte ni d’envoi de message.
