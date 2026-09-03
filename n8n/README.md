# Workflow n8n du lead magnet

Le fichier `spherier-lead-access.workflow.json` est prêt à importer dans n8n.

Workflow créé dans l'instance Astralis, inactif : `7NZRTlUkXKxhd6il`.

Avant activation :

1. Liste Brevo créée : `Lead Magnet - Sphérier Coach`, identifiant `24`, dossier `Lead Magnets`.
2. Le credential `Brevo - Thomas Argheria` est créé dans n8n et relié aux trois requêtes Brevo. L'IP publique du serveur n8n, `72.62.186.57`, doit être autorisée dans les réglages de sécurité Brevo.
3. Le credential Header Auth `Sphérier - Secret Netlify` est déjà créé. Sa valeur est stockée dans le Keychain local sous `spherier-n8n-webhook-secret` et doit être transmise à Netlify sans passer par GitHub.
4. Les attributs de contact `SPHERIER_LINK` et `SPHERIER_UUID` sont créés.
5. Template transactionnel Brevo créé : `Sphérier - Lien personnel`, identifiant `43`.
6. Le workflow ajoute le contact à la liste puis déclenche directement le template transactionnel. Chaque demande renvoie donc l'email, même pour un contact déjà présent.
7. Activer le workflow et reporter son URL de production dans `N8N_SPHERIER_WEBHOOK_URL`.

La fonction Netlify réutilise l'UUID connu et le workflow renvoie le même lien avec le template transactionnel.
