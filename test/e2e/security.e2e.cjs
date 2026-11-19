// Teste les protections de l'API : en-têtes de sécurité, CORS et limites de requêtes.
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const { MongoMemoryServer } = require(path.join(root, 'node_modules/mongodb-memory-server'));
const BASE = 'http://localhost:3998';

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'OK ' : 'KO '} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const call = async (method, url, body, headers = {}) => {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, headers: res.headers, body: json };
};

async function startApi(mongoUri, extraEnv) {
  const defaults = {
    SMTP_HOST: undefined, SMTP_PORT: undefined, SMTP_USER: undefined, SMTP_PASSWORD: undefined, MAIL_FROM: undefined, APP_URL: undefined,
    GEMINI_API_KEY: undefined, COLLECT_CRON: 'off', DIGEST_CRON: 'off', CORS_ORIGINS: undefined, TRUST_PROXY: undefined, RATE_LIMIT: undefined,
  };
  extraEnv = { ...defaults, ...extraEnv };
  const env = {
    ...process.env, MONGODB_URI: mongoUri, PORT: '3998', JWT_ACCESS_SECRET: 'x'.repeat(48),
    ADMIN_EMAIL: 'admin@exemple.ci', ADMIN_PASSWORD: 'motdepasse-admin', ...extraEnv,
  };
  for (const k of Object.keys(extraEnv)) if (extraEnv[k] === undefined) delete env[k];
  const proc = spawn(process.execPath, [path.join(root, 'dist/main.js')], { cwd: __dirname, env });
  const api = { proc, out: '' };
  proc.stdout.on('data', (d) => { api.out += d; });
  proc.stderr.on('data', (d) => { api.out += d; });
  for (let i = 0; i < 60; i++) {
    if (api.out.includes('API démarrée') || proc.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return api;
}
async function stopApi(api) {
  if (api.proc.exitCode !== null) return;
  api.proc.kill();
  await new Promise((r) => api.proc.once('exit', r));
}
const login = (email, password, headers) => call('POST', '/auth/login', { email, password }, headers);

(async () => {
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('veille');
  let api;
  try {
    // --- En-têtes et CORS ---
    api = await startApi(uri, { CORS_ORIGINS: 'http://localhost:5173' });
    const health = await call('GET', '/health');
    check('nosniff', health.headers.get('x-content-type-options') === 'nosniff');
    check('anti-clickjacking', health.headers.get('x-frame-options') === 'SAMEORIGIN');
    check('HSTS', (health.headers.get('strict-transport-security') ?? '').includes('max-age='));
    check('Content-Security-Policy', (health.headers.get('content-security-policy') ?? '').includes("default-src 'self'"));
    check('X-Powered-By masqué', health.headers.get('x-powered-by') === null);
    check('compteur de limite renvoyé', health.headers.get('x-ratelimit-limit') === '100');

    const docs = await fetch(BASE + '/docs');
    check('Swagger toujours accessible avec la CSP', docs.status === 200 && (await docs.text()).includes('swagger-ui'));

    const preflight = (origin) =>
      fetch(BASE + '/auth/login', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    const allowed = await preflight('http://localhost:5173');
    check('CORS : interface web autorisée', allowed.headers.get('access-control-allow-origin') === 'http://localhost:5173');
    const evil = await preflight('https://pirate.exemple');
    check('CORS : autre site refusé', evil.headers.get('access-control-allow-origin') === null);

    // --- Connexion : 10 essais par compte et par adresse IP ---
    const attempts = [];
    for (let i = 0; i < 10; i++) attempts.push((await login('admin@exemple.ci', 'mauvais-mot-de-passe')).status);
    check('10 mauvais mots de passe -> 401', attempts.every((s) => s === 401), attempts.join(','));
    const blocked = await login('admin@exemple.ci', 'motdepasse-admin');
    check('11e essai bloqué -> 429, même avec le bon mot de passe', blocked.status === 429, JSON.stringify(blocked.body));
    check('message en français', blocked.body.message === 'Trop de requêtes. Réessayez dans quelques minutes.');
    check('délai d’attente indiqué', Number(blocked.headers.get('retry-after')) > 0, blocked.headers.get('retry-after'));
    check('casse de l’e-mail sans effet sur le compteur', (await login(' ADMIN@exemple.ci', 'x')).status === 429);
    check('un autre compte depuis la même adresse reste possible', (await login('collegue@exemple.ci', 'motdepasse1')).status === 401);
    check('X-Forwarded-For ignoré sans proxy déclaré', (await login('admin@exemple.ci', 'x', { 'x-forwarded-for': '203.0.113.7' })).status === 429);

    // --- Mot de passe oublié : 10 demandes par quart d'heure ---
    const forgot = [];
    for (let i = 0; i < 11; i++) forgot.push((await call('POST', '/auth/forgot-password', { email: `inconnu${i}@exemple.ci` })).status);
    check('mot de passe oublié : 10 acceptés puis 429', forgot.slice(0, 10).every((s) => s === 200) && forgot[10] === 429, forgot.join(','));
    check('limite comptée par route : inscription encore possible', (await call('POST', '/auth/register', {})).status === 400);

    // --- Limite générale : 100 requêtes par minute, même sans être connecté ---
    let firstBlocked = null;
    for (let i = 1; i <= 101 && firstBlocked === null; i++) {
      if ((await call('GET', '/users/me')).status === 429) firstBlocked = i;
    }
    check('101e requête non connectée -> 429', firstBlocked === 101, String(firstBlocked));
    await stopApi(api);

    // --- Sans CORS_ORIGINS : aucun site ne peut appeler l'API depuis un navigateur ---
    api = await startApi(uri, {});
    const noCors = await fetch(BASE + '/health', { headers: { origin: 'http://localhost:5173' } });
    check('CORS désactivé par défaut', noCors.headers.get('access-control-allow-origin') === null);
    await stopApi(api);

    // --- Derrière un proxy : la vraie adresse IP de chaque visiteur est utilisée ---
    api = await startApi(uri, { TRUST_PROXY: '1' });
    for (let i = 0; i < 10; i++) await login('admin@exemple.ci', 'x', { 'x-forwarded-for': '203.0.113.7' });
    check('proxy : visiteur bloqué', (await login('admin@exemple.ci', 'x', { 'x-forwarded-for': '203.0.113.7' })).status === 429);
    check('proxy : autre visiteur non bloqué', (await login('admin@exemple.ci', 'x', { 'x-forwarded-for': '203.0.113.8' })).status === 401);
    await stopApi(api);

    // --- RATE_LIMIT=off : réservé aux tests ---
    api = await startApi(uri, { RATE_LIMIT: 'off' });
    const many = [];
    for (let i = 0; i < 12; i++) many.push((await login('admin@exemple.ci', 'x')).status);
    check('RATE_LIMIT=off : aucune limite', many.every((s) => s === 401));
    check('RATE_LIMIT=off : avertissement au démarrage', api.out.includes('RATE_LIMIT=off'));
    await stopApi(api);

    const prod = await startApi(uri, {
      NODE_ENV: 'production', RATE_LIMIT: 'off', GEMINI_API_KEY: 'k',
      SMTP_HOST: 'h', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASSWORD: 'p', MAIL_FROM: 'a@b.ci',
    });
    check('RATE_LIMIT=off refusé en production', prod.out.includes('RATE_LIMIT=off est interdit en production'));
    await stopApi(prod);
    api = null;
  } catch (error) {
    failures++;
    console.log('ERREUR', error);
  } finally {
    if (api) await stopApi(api);
    await mongo.stop();
  }
  console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} test(s) en échec.`);
  process.exit(failures === 0 ? 0 : 1);
})();
