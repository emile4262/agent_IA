# Déploiement gratuit sur Render

L'API tourne dans un conteneur Docker sur Render, branchée sur MongoDB Atlas, Brevo (e-mails) et Gemini (résumés).
Chaque push sur `main` est vérifié par la CI GitHub, puis déployé automatiquement si elle passe.

Tout est gratuit :

| Service | Offre gratuite |
|---|---|
| Render | Free : 512 Mo de mémoire, 750 h par mois (assez pour tourner en continu) |
| MongoDB Atlas | M0 : 512 Mo de données |
| Brevo | 300 e-mails par jour |
| Gemini | Quota gratuit de requêtes par jour |
| cron-job.org | Appels planifiés illimités, pour garder le serveur éveillé |

## Avant de commencer

| Il te faut | Où le trouver |
|---|---|
| Un compte Render (offre Free, sans carte bancaire) | https://render.com, connexion avec GitHub |
| Un compte cron-job.org | https://cron-job.org (gratuit) |
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
Le port SMTP est 2525 : l'offre gratuite de Render bloque les ports 25, 465 et 587, et Brevo accepte aussi 2525.

4. **Autorise Render dans Atlas** : Render → le service → **Connect** → **Outbound** donne les adresses IP de sortie.
   Ajoute-les dans Atlas → **Network Access**. Si Render ne les affiche pas pour l'offre gratuite, ajoute
   `0.0.0.0/0` (toutes les adresses) : la base reste protégée par son mot de passe, qui doit alors être long et unique.
5. Une fois le service en ligne, copie son adresse (ex. `https://veille-api.onrender.com`),
   mets-la dans `APP_URL` (Environment → Save) : c'est elle qui sert dans les liens des e-mails.

6. **Garde le serveur éveillé.** Sur l'offre gratuite, Render endort le serveur après 15 minutes sans visite :
   la collecte et les envois s'arrêteraient. Sur cron-job.org → **Create cronjob** :
   - URL : `https://<ton-adresse>/health`
   - Planification : toutes les 10 minutes
   - Active les alertes e-mail en cas d'échec : tu sauras si le serveur tombe.

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

- **Limites de l'offre gratuite.** Un redéploiement prend quelques minutes (machine lente), et Render peut
  redémarrer le serveur de temps en temps. Les veilles en retard partent au redémarrage (jusqu'à 6 h de retard),
  et une veille interrompue en plein envoi est terminée avant l'arrêt.
- **Si les e-mails ne partent pas** (« Connection timeout » dans les journaux), vérifie que `SMTP_PORT` vaut bien 2525.
- **Une seule instance.** La collecte et les envois tournent dans le serveur. Les envois sont protégés
  contre les doublons, mais deux instances feraient deux collectes et doubleraient le coût Gemini.
- **Limite de requêtes.** Les compteurs sont en mémoire et repartent à zéro à chaque redéploiement.
  Pour vérifier `TRUST_PROXY` : après 11 mauvais mots de passe depuis ton ordinateur (429),
  la connexion depuis ton téléphone en 4G doit encore répondre 401. Si elle répond 429, essaie `TRUST_PROXY=2`.
- **Production stricte.** Avec `NODE_ENV=production`, l'API refuse de démarrer sans SMTP ni Gemini,
  et `RATE_LIMIT=off` est interdit.
- **Tester l'image en local** (Docker Desktop démarré) :
  `docker build -t veille-api .` puis `docker run --env-file .env -p 3000:3000 veille-api`.
