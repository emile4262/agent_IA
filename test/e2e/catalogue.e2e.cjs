// Phase 2 : catalogue des sources et préférences, sur une base MongoDB temporaire.
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
const call = async (method, url, body, token) => {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
};

async function startApi(mongoUri, extraEnv) {
  const noSmtp = { SMTP_HOST: undefined, SMTP_PORT: undefined, SMTP_USER: undefined, SMTP_PASSWORD: undefined, MAIL_FROM: undefined, APP_URL: undefined, GEMINI_API_KEY: undefined, COLLECT_CRON: 'off', DIGEST_CRON: 'off' };
  extraEnv = { ...noSmtp, ...extraEnv };
  const env = { ...process.env, MONGODB_URI: mongoUri, PORT: '3998', JWT_ACCESS_SECRET: 'x'.repeat(48), RATE_LIMIT: 'off', ...extraEnv };
  for (const k of Object.keys(extraEnv)) if (extraEnv[k] === undefined) delete env[k];
  const proc = spawn(process.execPath, [path.join(root, 'dist/main.js')], { cwd: __dirname, env });
  const api = { proc, out: '' };
  proc.stdout.on('data', (d) => { api.out += d; });
  proc.stderr.on('data', (d) => { api.out += d; });
  for (let i = 0; i < 60; i++) {
    if (api.out.includes('API démarrée')) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return api;
}
async function stopApi(api) {
  api.proc.kill();
  await new Promise((r) => api.proc.once('exit', r));
}

(async () => {
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('veille');
  let api;
  try {
    api = await startApi(uri, { ADMIN_EMAIL: 'admin@exemple.ci', ADMIN_PASSWORD: 'motdepasse-admin' });
    check('6 sources importées au premier lancement', api.out.includes('6 sources par défaut importées'));

    // --- Catalogue public ---
    const topics = await call('GET', '/topics');
    check('GET /topics public', topics.status === 200 && JSON.stringify(topics.body) === '["Backend","DevOps","IA","Tech"]', JSON.stringify(topics.body));
    const sources = await call('GET', '/sources');
    check('GET /sources public -> 6', sources.status === 200 && sources.body.length === 6);
    check('vue publique sans feedUrl', sources.body.every((s) => s.id && s.name && s.topic && !('feedUrl' in s)), JSON.stringify(sources.body[0]));
    const byName = Object.fromEntries(sources.body.map((s) => [s.name, s.id]));

    // --- Comptes ---
    let admin = (await call('POST', '/auth/login', { email: 'admin@exemple.ci', password: 'motdepasse-admin' })).body.accessToken;
    check('admin : mot de passe provisoire -> 403 sur /admin/sources', (await call('GET', '/admin/sources', null, admin)).status === 403);
    await call('POST', '/auth/change-password', { currentPassword: 'motdepasse-admin', newPassword: 'nouveau-mdp-admin' }, admin);
    admin = (await call('POST', '/auth/login', { email: 'admin@exemple.ci', password: 'nouveau-mdp-admin' })).body.accessToken;
    const reg = await call('POST', '/auth/register', { email: 'awa@exemple.ci', password: 'motdepasse1', firstName: 'Awa', lastName: 'Koné' });
    const user = reg.body.accessToken;
    check('utilisateur inscrit', reg.status === 201 && !!user);

    // --- Préférences par défaut ---
    check('préférences sans jeton -> 401', (await call('GET', '/users/me/preferences')).status === 401);
    const def = await call('GET', '/users/me/preferences', null, user);
    check('préférences par défaut', def.status === 200 && JSON.stringify(def.body) === JSON.stringify({
      topics: ['Backend', 'DevOps', 'IA'], sourceIds: null, keywords: [], minScore: 5, maxArticles: 10,
      sendTime: '08:00', timezone: 'Africa/Abidjan', frequency: 'daily', active: true,
    }), JSON.stringify(def.body));

    // Compte créé avant la phase 2 (sans sous-document) : valeurs par défaut à la lecture.
    const mongoose = require(path.join(root, 'node_modules/mongoose'));
    const conn = await mongoose.createConnection(uri).asPromise();
    await conn.collection('users').updateOne({ email: 'awa@exemple.ci' }, { $unset: { preferences: '' } });
    const legacy = await call('GET', '/users/me/preferences', null, user);
    check('ancien compte sans préférences -> valeurs par défaut', legacy.status === 200 && legacy.body.minScore === 5 && legacy.body.sourceIds === null, JSON.stringify(legacy.body));

    // --- Modification ---
    const upd = await call('PATCH', '/users/me/preferences', {
      topics: ['IA', 'Tech'], sourceIds: [byName['dev.to · IA'], byName['Medium · IA']], minScore: 7, maxArticles: 5,
      sendTime: '07:30', timezone: 'Europe/Paris', frequency: 'weekdays',
    }, user);
    check('PATCH préférences -> 200', upd.status === 200 && upd.body.minScore === 7 && upd.body.sourceIds?.length === 2 && upd.body.frequency === 'weekdays' && upd.body.active === true, JSON.stringify(upd.body));
    const reread = await call('GET', '/users/me/preferences', null, user);
    check('préférences enregistrées', JSON.stringify(reread.body) === JSON.stringify(upd.body));
    check('pause : active false', (await call('PATCH', '/users/me/preferences', { active: false }, user)).body.active === false);
    check('corps vide -> 400', (await call('PATCH', '/users/me/preferences', {}, user)).status === 400);

    const invalid = [
      ['sujet inconnu', { topics: ['Cuisine'] }],
      ['aucun sujet', { topics: [] }],
      ['sujet en double', { topics: ['IA', 'IA'] }],
      ['minScore 0', { minScore: 0 }],
      ['minScore 11', { minScore: 11 }],
      ['minScore décimal', { minScore: 5.5 }],
      ['minScore null', { minScore: null }],
      ['maxArticles 31', { maxArticles: 31 }],
      ['sendTime 24:00', { sendTime: '24:00' }],
      ['sendTime 8:50', { sendTime: '8:50' }],
      ['fuseau inconnu', { timezone: 'Mars/Olympus' }],
      ['fréquence inconnue', { frequency: 'monthly' }],
      ['sourceIds vide', { sourceIds: [] }],
      ['sourceIds mal formé', { sourceIds: ['abc'] }],
      ['source inexistante', { sourceIds: ['64b000000000000000000000'] }],
      ['champ inconnu', { email: 'x@y.ci' }],
    ];
    for (const [label, body] of invalid) {
      const r = await call('PATCH', '/users/me/preferences', body, user);
      check(`${label} -> 400`, r.status === 400, JSON.stringify(r.body.message));
    }
    check('sourceIds null = toutes les sources', (await call('PATCH', '/users/me/preferences', { sourceIds: null }, user)).body.sourceIds === null);

    // --- Administration des sources ---
    check('utilisateur -> 403 sur /admin/sources', (await call('GET', '/admin/sources', null, user)).status === 403);
    const all = await call('GET', '/admin/sources', null, admin);
    check('admin liste les sources avec feedUrl', all.status === 200 && all.body.length === 6 && all.body.every((s) => s.feedUrl && s.active === true && s.lastFetchedAt === null));
    const created = await call('POST', '/admin/sources', { name: ' dev.to · TypeScript ', feedUrl: 'https://dev.to/feed/tag/typescript', topic: 'Backend' }, admin);
    check('créer une source -> 201', created.status === 201 && created.body.name === 'dev.to · TypeScript', JSON.stringify(created.body));
    check('flux en double -> 409', (await call('POST', '/admin/sources', { name: 'x', feedUrl: 'https://dev.to/feed/tag/typescript', topic: 'IA' }, admin)).status === 409);
    check('URL invalide -> 400', (await call('POST', '/admin/sources', { name: 'x', feedUrl: 'ftp://x.ci/rss', topic: 'IA' }, admin)).status === 400);
    check('sujet invalide -> 400', (await call('POST', '/admin/sources', { name: 'x', feedUrl: 'https://x.ci/rss', topic: 'Cuisine' }, admin)).status === 400);
    const tsId = created.body.id;
    check('PATCH sans champ -> 400', (await call('PATCH', `/admin/sources/${tsId}`, {}, admin)).status === 400);
    check('PATCH id inconnu -> 404', (await call('PATCH', '/admin/sources/abc', { active: false }, admin)).status === 404);
    check('URL déjà prise via PATCH -> 409', (await call('PATCH', `/admin/sources/${tsId}`, { feedUrl: 'https://dev.to/feed/tag/ai' }, admin)).status === 409);

    check('nouvelle source visible publiquement', (await call('GET', '/sources')).body.some((s) => s.id === tsId));
    check('utilisateur choisit la nouvelle source', (await call('PATCH', '/users/me/preferences', { sourceIds: [tsId, byName['dev.to · IA']] }, user)).status === 200);

    const off = await call('PATCH', `/admin/sources/${tsId}`, { active: false }, admin);
    check('désactiver une source', off.status === 200 && off.body.active === false);
    check('source désactivée absente du catalogue', !(await call('GET', '/sources')).body.some((s) => s.id === tsId));
    check('source désactivée refusée dans les préférences', (await call('PATCH', '/users/me/preferences', { sourceIds: [tsId] }, user)).status === 400);

    // Un second utilisateur reste sur « toutes les sources » : la suppression ne doit pas échouer sur null.
    await call('POST', '/auth/register', { email: 'yao@exemple.ci', password: 'motdepasse1', firstName: 'Yao', lastName: 'K' });
    check('supprimer une source -> 204', (await call('DELETE', `/admin/sources/${tsId}`, null, admin)).status === 204);
    const pruned = await call('GET', '/users/me/preferences', null, user);
    check('source supprimée retirée des préférences', JSON.stringify(pruned.body.sourceIds) === JSON.stringify([byName['dev.to · IA']]), JSON.stringify(pruned.body.sourceIds));
    check('supprimer à nouveau -> 404', (await call('DELETE', `/admin/sources/${tsId}`, null, admin)).status === 404);
    await conn.close();

    // --- Redémarrage : pas de réimport ---
    await stopApi(api);
    api = await startApi(uri, { ADMIN_EMAIL: 'admin@exemple.ci' });
    check('pas de réimport au redémarrage', api.out.includes('API démarrée') && !api.out.includes('sources par défaut importées'));
    check('toujours 6 sources actives', (await call('GET', '/sources')).body.length === 6);
  } finally {
    if (api) await stopApi(api);
    await mongo.stop().catch(() => {});
  }
  console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} échec(s)`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
