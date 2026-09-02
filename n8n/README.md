# Workflow n8n du lead magnet

Le fichier `spherier-lead-access.workflow.json` est prêt à importer dans n8n.

Workflow créé dans l'instance Astralis, inactif : `7NZRTlUkXKxhd6il`.

Avant activation :

1. Créer la liste Brevo dédiée, puis remplacer `listId: 0` dans le node `Valider et configurer` par son identifiant.
2. Créer le credential Brevo du compte `thomas.argheria@gmail.com` sur les trois requêtes Brevo. Le credential doit envoyer l'en-tête `api-key`. L'instance n8n ne contient actuellement que la clé du compte Programme Aime.
3. Le credential Header Auth `Sphérier - Secret Netlify` est déjà créé. Sa valeur est stockée dans le Keychain local sous `spherier-n8n-webhook-secret` et doit être transmise à Netlify sans passer par GitHub.
4. Créer dans Brevo les attributs de contact `SPHERIER_LINK` et `SPHERIER_UUID`.
5. Créer une automation Brevo ré-entrante : ajout à la liste dédiée, puis envoi du template contenant `{{ contact.SPHERIER_LINK }}`.
6. Activer le workflow et reporter son URL de production dans `N8N_SPHERIER_WEBHOOK_URL`.

La sortie puis la réintégration dans la liste permettent à un prospect déjà connu de recevoir à nouveau son lien personnel sans créer un nouvel UUID.
