# Démarrage — sphérier du club de coachs

**Pour** : le développeur du club de coachs.
**À lire après** le mémo technique de Cyril, qui explique le produit. Ce document-ci ne
répète pas le mémo : il dit ce qui est déjà fait, ce qui reste à faire, où sont les
choses dans le code, et comment demander ce que vous ne pouvez pas faire vous-même.

---

## 1. Ce qui est déjà en place

| Élément | État |
|---|---|
| Dépôt `spherier-coachs` | Créé, privé. **Vous y avez accès.** C'est votre seul accès. |
| Site Netlify `spherier-coachs` | Créé — `https://spherier-coachs.netlify.app` |
| Projet Supabase | Créé, schéma appliqué à l'identique du premier club |
| Espace Notion | **À vous de le créer** — voir §4 |

Le dépôt part de l'état du premier club, sans son historique : celui-ci contenait des
sauvegardes de données de membres. Vous démarrez donc sur un socle éprouvé et une
histoire vierge.

---

## 2. Ce que vous ne pouvez pas faire, et comment le demander

Vous n'avez **ni Netlify ni Supabase**. C'est délibéré : les deux instances partagent
un compte Netlify, et le cloisonnement repose sur les accès GitHub et sur le garde-fou
`CLUB` (§3).

Trois opérations passent donc par nous :

1. **Poser ou modifier une variable d'environnement** du site.
2. **Modifier le schéma Supabase** — nouvelle table, nouvelle colonne, index.
3. **Toute action sur le site Netlify** — domaine, redirections hors `netlify.toml`,
   consultation des journaux de fonction.

**Le déploiement, lui, ne demande rien** : un `git push` sur `main` déclenche le build
et la mise en ligne. C'est votre boucle normale.

**Groupez ces demandes.** Une demande au fil de l'eau coûte un aller-retour de plusieurs
heures ; trois demandes groupées coûtent le même aller-retour. Écrivez-les dans une
issue GitHub intitulée `admin: <ce que vous voulez>`, avec pour chacune :

- ce qu'il faut faire, exactement (nom de variable et valeur, SQL complet) ;
- pourquoi, en une phrase ;
- ce qui casse si ce n'est pas fait.

Nous répondons dans l'issue en confirmant ce qui a été appliqué.

**Un cas mérite d'être signalé tout de suite plutôt que groupé** : si la production est
cassée. Dites-le explicitement dans le titre.

---

## 3. Où sont les choses

### `club.config.js` — le seul fichier à relire pour comprendre l'instance

Tout ce qui distingue un club d'un autre y est : identifiant du club, version du
référentiel, catégories, dimensions et leurs teintes, échelle, difficultés, niveau
d'acquisition, plafond des cibles et formule d'ouverture.

Le reste du code ne connaît aucune dimension et aucun libellé : il les lit là, et le
navigateur les reçoit dans la réponse de `/api/referential`. **Ajouter une dimension ou
renommer un palier ne demande de toucher qu'à ce fichier.**

Trois choses à savoir en le remplissant :

- Le `name` d'une dimension doit correspondre **exactement** à l'option du select
  `Dimension` de la base Thèmes dans Notion. C'est par ce nom que les thématiques sont
  rattachées. Une faute de frappe vide la dimension **sans aucun message d'erreur** —
  la constellation s'affiche simplement vide.
- Les **préfixes des codes de compétences ne portent aucune logique**. Une compétence
  est rattachée à sa dimension par sa thématique, jamais par son code. Vous êtes libres
  de vos conventions de codes.
- Les catégories structurent l'accueil. Chaque dimension pointe vers une catégorie par
  son identifiant `category`. Les constellations restent au niveau des dimensions.

### Le garde-fou `CLUB`

`club.config.js` déclare `CLUB = 'coachs'`. La variable d'environnement `CLUB` du site
doit valoir la même chose. Si les deux divergent, **le module refuse de se charger** :
c'est le signe que l'instance tourne avec les secrets de l'autre club. Sans ce
contrôle, on lirait le Notion d'un club en écrivant dans le Supabase de l'autre, sans
que rien ne le signale.

Chaque fonction journalise au démarrage à froid :

```
[sphérier] club = coachs · référentiel v1 · N dimensions
```

Et `/api/referential` renvoie `club` dans sa réponse : c'est la vérification la plus
rapide après un déploiement.

### Le reste

| Fichier | Rôle |
|---|---|
| `referentiel-v2.js` | Lecture Notion, assemblage, cache 10 min |
| `ouverture-v2.js` | Le graphe de progression — la règle vit là et nulle part ailleurs |
| `snapshot-v2.js` | Validation et écriture des snapshots |
| `notes-v3.js` | Les notes personnelles |
| `netlify/functions/` | Sept fonctions (referential, state, snapshot, note, refresh, access, prospect-event), seules détentrices des secrets |
| `prospects-notion.js`, `limiteur.js` | Base Prospects du lead magnet ; limiteur de débit par IP partagé par les fonctions qui écrivent |
| `public/spherier-v2.html` | Tout le renderer, en un fichier, sans étape de build |
| `supabase/schema.sql` | Le schéma appliqué sur votre projet |
| `creer-bases-notion.js` | Création des quatre bases Notion du référentiel (§4), refuse une page déjà équipée |
| `creer-base-prospects-notion.js` | Création de la cinquième base, Prospects Sphérier, pour le lead magnet |
| `importer-referentiel-v5.js` | Import initial du classeur (`WORKBOOK_PATH`). Simulation par défaut, `APPLIQUER=1` pour écrire. Mapping horodaté dans `.local/` et copie suivie dans `data/referentiel-mapping.json` |
| `migrer-difficulte-notion.js`, `preview-notion.js` | Renommage d'une difficulté page par page ; recette locale sur le vrai référentiel (`npm run preview:notion`) |
| `archives/` | Scripts à usage unique déjà appliqués, gardés pour l'histoire |
| `n8n/` | Workflow d'envoi du lien personnel et son README |
| `.github/workflows/ci.yml` | `npm test` à chaque push |
| `verifier-referentiel-notion.js` | Contrôle des invariants du référentiel (codes uniques, relations, marqueurs, difficultés connues) ; les comptes sont affichés, jamais figés |

Le renderer est un seul fichier servi tel quel. **Aucune étape de build, aucun
`npm run build`**. Vous le modifiez, vous poussez, c'est en ligne.

---

## 4. Créer votre espace Notion

1. Créez une page vide dans votre espace, qui accueillera les quatre bases.
2. Créez une intégration Notion, récupérez son jeton.
3. **Partagez la page avec l'intégration** (••• > Connexions).
4. Lancez, à blanc d'abord :

```bash
SIMULATION=1 NOTION_TOKEN=... PAGE_PARENT=... node creer-bases-notion.js
```

puis pour de vrai, sans `SIMULATION`.

Le script crée Thèmes, Compétences, Ressources et Clients avec les noms de propriétés
exacts que le code cherche. Il évite deux pièges qui nous ont coûté du temps :

- **une relation duale se crée en UNE instruction** — la créer en deux fois produit deux
  paires orphelines non synchronisées, sans que rien ne le signale ;
- **la relation réflexive `Nourrit` / `Nourri par` ne peut pas être posée à la création**
  de la base, puisqu'elle pointe vers elle-même. Le script l'ajoute dans un second temps.

Il reste ensuite deux gestes manuels, que le script rappelle en sortie :

- **partager les quatre bases avec l'intégration**, Clients comprise — c'est celle qu'on
  avait oubliée ;
- lancer l'import (`APPLIQUER=1 WORKBOOK_PATH=… node importer-referentiel-v5.js`), qui pose lui-même les options du select `Dimension` ;
- créer la base Prospects avec `creer-base-prospects-notion.js` si le lead magnet est activé.

Puis transmettez-nous les variables à poser côté Netlify, en une seule demande : la liste
complète est dans `.env.example` (`CLUB`, les quatre `DB_*`, `NOTION_TOKEN`, `SUPABASE_*`,
`REFRESH_TOKEN`, `PUBLIC_SITE_URL`, `N8N_SPHERIER_WEBHOOK_*`, `BOOKING_URL`). Les secrets
passent par un canal séparé, jamais par une issue.

---

## 5. Travailler en local

```bash
npm install
```

```bash
npx netlify dev
```

Le site répond sur `http://localhost:8888`, fonctions comprises. Il vous faut un `.env`
local, sur le modèle de `.env.example` — **il n'est jamais commité**, le `.gitignore`
s'en charge.

Le référentiel est servi depuis un cache de 10 minutes. Pour voir une modification
Notion immédiatement :

```bash
curl -X POST http://localhost:8888/api/refresh -H "x-refresh-token: $REFRESH_TOKEN"
```

Deux recettes sont disponibles :

```bash
npm test
```

La première utilise un jeu de données local et couvre desktop, mobile et sauvegarde.
La seconde lit le vrai référentiel Notion configuré dans `.env` :

```bash
npm run test:notion
```

Le parcours lead magnet ajoute les variables suivantes :

```text
DB_PROSPECTS=
PUBLIC_SITE_URL=https://spherier-coachs.netlify.app
N8N_SPHERIER_WEBHOOK_URL=
N8N_SPHERIER_WEBHOOK_SECRET=
BOOKING_URL=
```

`/api/access` crée ou retrouve le prospect par email et appelle n8n pour l'envoi Brevo.
`/api/prospect-event` suit le démarrage, la progression, les priorités et le clic agenda.

---

## 6. Deux disciplines qui nous ont coûté cher

### Le code part avant la donnée

Le référentiel étant lu en direct, modifier dans Notion un libellé que le code attend
casse la production dès l'expiration du cache. La recette, en trois temps :

1. **Déployer** un code qui accepte l'ancien ET le nouveau libellé, et n'affiche que le
   nouveau. Une simple table d'alias au point d'entrée du référentiel suffit.
2. **Modifier** Notion.
3. **Retirer** la tolérance, et redéployer.

Nous avons appris cette règle en cassant la production : la pastille de difficulté avait
disparu et deux filtres renvoyaient zéro, entre le renommage et le déploiement.

Et un piège dans le piège : **renommer une option de select depuis l'interface Notion en
redéfinissant la liste efface toutes les valeurs assignées.** Nous avons perdu les 152
difficultés du premier club ainsi. À noter que l'API ne sait pas non plus renommer une
option : elle accepte la requête avec un `200` et ne fait rien. Le seul chemin fiable est
d'ajouter la nouvelle option, réaffecter les pages une par une, puis retirer l'ancienne.

### Un test d'interface va jusqu'à l'écriture réelle

Nous avons eu une période où **plus aucun enregistrement ne passait**, invisible parce
que les vérifications appelaient l'API directement d'un côté, et que les tests
d'interface ne sauvegardaient pas de l'autre. Un test qui s'arrête avant l'écriture ne
prouve rien sur la chaîne complète.

Deuxième version de la même leçon : vérifier qu'un texte est **visible**, pas seulement
présent dans le DOM. Un libellé enfermé dans un accordéon replié passe tous les tests et
ne se voit jamais.

---

## 7. Le conseil qui vaut plus que les autres

**Figez votre référentiel avant d'ouvrir l'outil à vos premiers membres.** Tant que
personne ne s'est évalué, vous pouvez tout renuméroter, restructurer et renommer sans
conséquence. Après, seules les réécritures et les ajouts restent gratuits — un code de
compétence devient un identifiant permanent, et le modifier ampute l'historique du
membre silencieusement.
