# Déploiement sur Render

L'API tourne dans un conteneur Docker sur Render, branchée sur MongoDB Atlas, Brevo (e-mails) et Gemini (résumés).
Chaque push sur `main` est vérifié par la CI GitHub, puis déployé automatiquement si elle passe.

## Avant de commencer

| Il te faut | Où le trouver |
|---|---|
| Un compte Render avec un moyen de paiement | https://render.com (offre Starter, environ 7 $/mois) |
| L'adresse de connexion MongoDB Atlas | Atlas → Connect → Drivers |
| Une clé SMTP Brevo et un expéditeur validé | Brevo → SMTP & API, et Senders |
| Une clé Gemini | https://aistudio.google.com/apikey |

## 1. Première mise en ligne

1. Fusionne la branche `emile` dans `main` et pousse `main` sur GitHub.
2. Render → **New** → **Blueprint** → choisis le dépôt `agent_IA`. Render lit `render.yaml`.
3. Remplis les variables demandées :

| Variable | Valeur |
|---|---|
| `MONGODB_URI` | L'adresse Atlas, avec le nom de la base (ex. `.../veille?retryWrites=true`) |
| `ADMIN_EMAIL` | L'e-mail du compte administrateur |
| `ADMIN_PASSWORD` | Un mot de passe de 8 à 72 caractères (sinon un mot de passe provisoire est écrit dans les journaux) |
| `APP_URL` | Laisse vide pour l'instant (étape 5) |
| `SMTP_USER` | L'identifiant SMTP Brevo |
| `SMTP_PASSWORD` | La clé SMTP Brevo (pas le mot de passe du compte) |
| `MAIL_FROM` | L'expéditeur validé dans Brevo, ex. `Veille <veille@ton-domaine.ci>` |
| `GEMINI_API_KEY` | La clé Gemini |

`JWT_ACCESS_SECRET` est généré par Render. `TRUST_PROXY=1` et la configuration SMTP de Brevo sont déjà remplis.

4. **Autorise Render dans Atlas** : Render → le service → **Connect** → **Outbound** donne les adresses IP de sortie.
   Ajoute-les dans Atlas → **Network Access**. Évite `0.0.0.0/0`, qui ouvre la base au monde entier.
5. Une fois le service en ligne, copie son adresse (ex. `https://veille-api.onrender.com`),
   mets-la dans `APP_URL` (Environment → Save) : c'est elle qui sert dans les liens des e-mails.

## 2. Vérifier

- `https://<ton-adresse>/health` répond `{"status":"ok","mongo":"connected"}`.
- Les journaux (Logs) affichent « Catalogue vide : 6 sources par défaut importées » au premier lancement,
  « Collecte automatique planifiée » et « Envois automatiques vérifiés ».
- Connecte-toi avec `POST /auth/login`, puis change le mot de passe admin avec `POST /auth/change-password`.
- Swagger (`/docs`) est désactivé en production : utilise Postman ou `curl`.

## 3. Mises à jour

Pousse sur `main` : la CI tourne, puis Render redéploie seul si elle passe.
Pendant un redéploiement, l'ancien serveur termine l'envoi en cours avant de s'arrêter, et les veilles
qui tombaient pendant la coupure partent au redémarrage (jusqu'à 6 h de retard).

## À savoir

- **Une seule instance.** La collecte et les envois tournent dans le serveur. Les envois sont protégés
  contre les doublons, mais deux instances feraient deux collectes et doubleraient le coût Gemini.
- **Limite de requêtes.** Les compteurs sont en mémoire et repartent à zéro à chaque redéploiement.
  Pour vérifier `TRUST_PROXY` : après 11 mauvais mots de passe depuis ton ordinateur (429),
  la connexion depuis ton téléphone en 4G doit encore répondre 401. Si elle répond 429, essaie `TRUST_PROXY=2`.
- **Production stricte.** Avec `NODE_ENV=production`, l'API refuse de démarrer sans SMTP ni Gemini,
  et `RATE_LIMIT=off` est interdit.
- **Tester l'image en local** (Docker Desktop démarré) :
  `docker build -t veille-api .` puis `docker run --env-file .env -p 3000:3000 veille-api`.
