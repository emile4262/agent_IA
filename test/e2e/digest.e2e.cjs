// Phase 4 : veille personnalisée. Les articles résumés sont insérés directement en base (pas de RSS ni d'IA).
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const { MongoMemoryServer } = require(path.join(root, 'node_modules/mongodb-memory-server'));
const mongoose = require(path.join(root, 'node_modules/mongoose'));
const BASE = 'http://localhost:3998';
const { ObjectId } = mongoose.Types;

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

async function startApi(mongoUri, extraEnv = {}) {
  const defaults = {
    SMTP_HOST: undefined, SMTP_PORT: undefined, SMTP_USER: undefined, SMTP_PASSWORD: undefined, MAIL_FROM: undefined, APP_URL: undefined,
    GEMINI_API_KEY: undefined, COLLECT_CRON: 'off', DIGEST_CRON: 'off', NODE_ENV: undefined,
  };
  extraEnv = { ...defaults, ...extraEnv };
  const env = { ...process.env, MONGODB_URI: mongoUri, PORT: '3998', JWT_ACCESS_SECRET: 'x'.repeat(48), RATE_LIMIT: 'off', ADMIN_EMAIL: 'admin@exemple.ci', ...extraEnv };
  for (const k of Object.keys(extraEnv)) if (extraEnv[k] === undefined) delete env[k];
  const proc = spawn(process.execPath, [path.join(root, 'dist/main.js')], { cwd: __dirname, env });
  const api = { proc, out: '' };
  proc.stdout.on('data', (d) => { api.out += d; });
  proc.stderr.on('data', (d) => { api.out += d; });
  for (let i = 0; i < 60; i++) {
    if (api.out.includes('API démarrée') || api.out.includes('Configuration invalide')) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return api;
}
async function stopApi(api) {
  if (api.proc.exitCode !== null) return;
  api.proc.kill();
  await new Promise((r) => api.proc.once('exit', r));
}

const hhmm = (minutes) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const nowMinutesUtc = () => { const d = new Date(); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const dueNow = () => ({ timezone: 'UTC', sendTime: hhmm(nowMinutesUtc() - 5) });
const notDue = () => ({ timezone: 'UTC', sendTime: hhmm(nowMinutesUtc() + 60) });
const todayUtc = () => new Date().toISOString().slice(0, 10);

(async () => {
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('veille');
  const conn = await mongoose.createConnection(uri).asPromise();
  const db = conn.db;
  let api;
  try {
    api = await startApi(uri, { ADMIN_PASSWORD: 'motdepasse-admin' });
    check('DIGEST_CRON=off -> envois automatiques désactivés', api.out.includes('Envois automatiques désactivés'));

    let admin = (await call('POST', '/auth/login', { email: 'admin@exemple.ci', password: 'motdepasse-admin' })).body.accessToken;
    await call('POST', '/auth/change-password', { currentPassword: 'motdepasse-admin', newPassword: 'nouveau-mdp-admin' }, admin);
    admin = (await call('POST', '/auth/login', { email: 'admin@exemple.ci', password: 'nouveau-mdp-admin' })).body.accessToken;

    const tokens = {};
    for (const name of ['awa', 'bob', 'carl', 'dave', 'eve', 'frank', 'gina', 'hana']) {
      const r = await call('POST', '/auth/register', { email: `${name}@exemple.ci`, password: 'motdepasse1', firstName: name[0].toUpperCase() + name.slice(1), lastName: 'K' });
      tokens[name] = r.body.accessToken;
    }
    check('8 utilisateurs inscrits', Object.values(tokens).every(Boolean));
    // Tous confirmés sauf carl.
    await db.collection('users').updateMany({ email: { $ne: 'carl@exemple.ci' }, role: 'user' }, { $set: { emailVerified: true } });

    // Sources : les 6 vraies désactivées, 2 actives de test, 1 inactive.
    for (const s of (await call('GET', '/admin/sources', null, admin)).body) {
      await call('PATCH', `/admin/sources/${s.id}`, { active: false }, admin);
    }
    const src = {};
    for (const [name, topic] of [['S1', 'Backend'], ['S2', 'IA'], ['S3', 'DevOps']]) {
      src[name] = (await call('POST', '/admin/sources', { name, feedUrl: `https://exemple.ci/${name}.xml`, topic }, admin)).body.id;
    }
    await call('PATCH', `/admin/sources/${src.S3}`, { active: false }, admin);

    let n = 0;
    const insertArticle = async ({ source, topic, score, status = 'summarized', ageHours = 1 }) => {
      n++;
      const created = new Date(Date.now() - ageHours * 3600_000);
      const doc = {
        url: `https://blog.ci/a${n}`, sourceId: new ObjectId(src[source]), title: `Article ${n}`, snippet: 'extrait', publishedAt: created,
        status, attempts: 1, lastError: null, titleFr: `Titre FR ${n}`, topic, summary: `Résumé ${n}`, score,
        summarizedAt: status === 'summarized' ? created : null, createdAt: created, updatedAt: created,
      };
      const { insertedId } = await db.collection('articles').insertOne(doc);
      return insertedId.toString();
    };
    const a = {
      backend9: await insertArticle({ source: 'S1', topic: 'Backend', score: 9 }),
      backend7: await insertArticle({ source: 'S1', topic: 'Backend', score: 7 }),
      ia8: await insertArticle({ source: 'S2', topic: 'IA', score: 8 }),
      low4: await insertArticle({ source: 'S1', topic: 'Backend', score: 4 }),
      old10: await insertArticle({ source: 'S1', topic: 'Backend', score: 10, ageHours: 72 }),
      pending: await insertArticle({ source: 'S1', topic: 'Backend', score: 9, status: 'pending' }),
      inactive: await insertArticle({ source: 'S3', topic: 'DevOps', score: 9 }),
      tech10: await insertArticle({ source: 'S1', topic: 'Tech', score: 10 }),
    };

    // --- Aperçu du jour ---
    check('/digest/today sans jeton -> 401', (await call('GET', '/digest/today')).status === 401);
    const t1 = await call('GET', '/digest/today', null, tokens.awa);
    console.log('    aperçu : ' + JSON.stringify({ ...t1.body, articles: t1.body.articles?.map((x) => x.score) }));
    check('today -> 200 avec les préférences', t1.status === 200 && t1.body.sendTime === '08:00' && t1.body.timezone === 'Africa/Abidjan' && t1.body.frequency === 'daily' && t1.body.active === true && t1.body.sendingDay === true && t1.body.delivered === null);
    check('date locale du jour', t1.body.date === todayUtc(), t1.body.date); // Abidjan = UTC
    check('sélection : résumés récents, bons thèmes, sources actives, note >= 5, triés', JSON.stringify(t1.body.articles.map((x) => x.id)) === JSON.stringify([a.backend9, a.ia8, a.backend7]));
    check('champs de l’article', (() => { const x = t1.body.articles[0]; return x.title === 'Titre FR 1' && x.url === 'https://blog.ci/a1' && x.topic === 'Backend' && x.score === 9 && x.summary === 'Résumé 1'; })(), JSON.stringify(t1.body.articles[0]));

    const prefs = (body) => call('PATCH', '/users/me/preferences', body, tokens.awa);
    const ids = async () => (await call('GET', '/digest/today', null, tokens.awa)).body.articles.map((x) => x.id);
    await prefs({ maxArticles: 2 });
    check('maxArticles = 2 -> 2 meilleurs', JSON.stringify(await ids()) === JSON.stringify([a.backend9, a.ia8]));
    await prefs({ maxArticles: 10, sourceIds: [src.S2] });
    check('sourceIds = [S2] -> seulement S2', JSON.stringify(await ids()) === JSON.stringify([a.ia8]));
    await call('PATCH', `/admin/sources/${src.S2}`, { active: false }, admin);
    check('seule source choisie désactivée ensuite -> rien', (await ids()).length === 0);
    await call('PATCH', `/admin/sources/${src.S2}`, { active: true }, admin);
    await prefs({ sourceIds: null, topics: ['Tech'] });
    check('topics = [Tech]', JSON.stringify(await ids()) === JSON.stringify([a.tech10]));
    await prefs({ topics: ['Backend', 'DevOps', 'IA'], minScore: 8 });
    check('minScore = 8', JSON.stringify(await ids()) === JSON.stringify([a.backend9, a.ia8]));
    await prefs({ minScore: 5 });

    // --- Envoi immédiat ---
    check('send-now e-mail non confirmé -> 403', (await call('POST', '/digest/send-now', null, tokens.carl)).status === 403);
    let mark = api.out.length;
    const s1 = await call('POST', '/digest/send-now', null, tokens.awa);
    check('send-now -> 200, envoyée', s1.status === 200 && s1.body.delivery?.status === 'sent' && s1.body.delivery.kind === 'manual' && s1.body.delivery.articles.length === 3 && s1.body.delivery.sentAt, JSON.stringify(s1.body).slice(0, 200));
    const mail = api.out.slice(mark);
    const [y, m, d] = todayUtc().split('-');
    check('e-mail : destinataire, objet, contenu', mail.includes('awa@exemple.ci') && mail.includes(`Votre veille du ${d}/${m}/${y} — 3 articles`) && mail.includes('Titre FR 1') && mail.includes('https://blog.ci/a1'), mail.slice(0, 300));
    const s2 = await call('POST', '/digest/send-now', null, tokens.awa);
    check('rien de nouveau -> message, pas d’envoi', s2.status === 200 && s2.body.delivery === null && /Aucun nouvel article/.test(s2.body.message));
    check('articles déjà reçus exclus de l’aperçu', (await call('GET', '/digest/today', null, tokens.awa)).body.articles.length === 0);
    await insertArticle({ source: 'S1', topic: 'Backend', score: 6 });
    check('2e envoi manuel', (await call('POST', '/digest/send-now', null, tokens.awa)).body.delivery?.articles.length === 1);
    await insertArticle({ source: 'S1', topic: 'Backend', score: 6 });
    check('3e envoi manuel', (await call('POST', '/digest/send-now', null, tokens.awa)).body.delivery?.status === 'sent');
    await insertArticle({ source: 'S1', topic: 'Backend', score: 6 });
    const s4 = await call('POST', '/digest/send-now', null, tokens.awa);
    check('4e envoi manuel -> 429', s4.status === 429 && /3 envois/.test(s4.body.message), JSON.stringify(s4.body));

    // --- Historique ---
    const h = await call('GET', '/digest/history', null, tokens.awa);
    console.log('    historique : ' + JSON.stringify({ ...h.body, items: h.body.items?.map((i) => [i.createdAt, i.articles.length]) }));
    check('historique : 3 envois, du plus récent au plus ancien', h.status === 200 && h.body.total === 3 && h.body.page === 1 && h.body.limit === 10 && h.body.items[2].articles.length === 3 && h.body.items[0].createdAt >= h.body.items[1].createdAt);
    const h2 = await call('GET', '/digest/history?page=2&limit=2', null, tokens.awa);
    check('historique paginé', h2.body.items.length === 1 && h2.body.total === 3);
    check('limit=0 -> 400', (await call('GET', '/digest/history?limit=0', null, tokens.awa)).status === 400);
    check('historique d’un autre utilisateur vide', (await call('GET', '/digest/history', null, tokens.bob)).body.total === 0);

    // --- Envois automatiques ---
    await call('PATCH', '/users/me/preferences', dueNow(), tokens.bob);
    await call('PATCH', '/users/me/preferences', notDue(), tokens.awa);
    await call('PATCH', '/users/me/preferences', dueNow(), tokens.carl); // non confirmé
    await call('PATCH', '/users/me/preferences', { ...dueNow(), active: false }, tokens.dave); // en pause
    const monday = new Date().getUTCDay() === 1;
    await call('PATCH', '/users/me/preferences', { ...dueNow(), frequency: 'weekly' }, tokens.eve);
    await call('PATCH', '/users/me/preferences', { ...dueNow(), topics: ['DevOps'] }, tokens.frank); // seule source DevOps inactive
    await call('PATCH', '/users/me/preferences', { ...dueNow(), active: false }, tokens.gina);
    await call('PATCH', '/users/me/preferences', { ...dueNow(), active: false }, tokens.hana);
    check('eve (hebdo) : sendingDay', (await call('GET', '/digest/today', null, tokens.eve)).body.sendingDay === monday);

    check('utilisateur -> 403 sur /admin/digest/run', (await call('POST', '/admin/digest/run', null, tokens.bob)).status === 403);
    mark = api.out.length;
    const r1 = await call('POST', '/admin/digest/run', null, admin);
    console.log('    rapport : ' + JSON.stringify(r1.body));
    const expectedSent = monday ? 2 : 1;
    check('run -> bob envoyé, frank sans article, autres ignorés', r1.status === 200 && r1.body.sent === expectedSent && r1.body.empty === 1 && r1.body.failed === 0 && r1.body.due === expectedSent + 1);
    const out1 = api.out.slice(mark);
    check('e-mails : bob oui, carl/dave/awa non', out1.includes('bob@exemple.ci') && !out1.includes('carl@exemple.ci') && !out1.includes('dave@exemple.ci') && !out1.includes('awa@exemple.ci'));
    const tb = await call('GET', '/digest/today', null, tokens.bob);
    check('bob : envoi du jour visible', tb.body.delivered?.status === 'sent' && tb.body.delivered.kind === 'scheduled' && tb.body.delivered.digestDate === todayUtc() && tb.body.delivered.attempts === 1);
    const r2 = await call('POST', '/admin/digest/run', null, admin);
    check('2e run : bob pas renvoyé', r2.body.sent === 0 && r2.body.empty === 1, JSON.stringify(r2.body));
    let dup = null;
    try { await db.collection('deliveries').insertOne({ userId: new ObjectId(tb.body.delivered && (await db.collection('users').findOne({ email: 'bob@exemple.ci' }))._id), digestDate: todayUtc(), kind: 'scheduled', status: 'sent', articles: [] }); } catch (e) { dup = e.code; }
    check('index unique userId + digestDate (envois automatiques)', dup === 11000);
    check('awa : ses envois manuels n’empêchent pas l’automatique', (await call('GET', '/digest/today', null, tokens.awa)).body.delivered === null);

    // --- Échec d'envoi (SMTP injoignable), réessais puis reprise ---
    await db.collection('users').updateOne({ email: 'gina@exemple.ci' }, { $set: { 'preferences.active': true } });
    await stopApi(api);
    api = await startApi(uri, { SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', SMTP_USER: 'u', SMTP_PASSWORD: 'p', MAIL_FROM: 'veille@exemple.ci' });
    admin = (await call('POST', '/auth/login', { email: 'admin@exemple.ci', password: 'nouveau-mdp-admin' })).body.accessToken;
    const f1 = await call('POST', '/admin/digest/run', null, admin);
    check('SMTP en panne -> gina en échec', f1.body.failed === 1 && f1.body.sent === 0, JSON.stringify(f1.body));
    let g = (await call('GET', '/digest/today', null, tokens.gina)).body.delivered;
    check('échec enregistré avec l’erreur', g?.status === 'failed' && g.attempts === 1 && !!g.error, JSON.stringify(g));
    const f2 = await call('POST', '/admin/digest/run', null, admin);
    g = (await call('GET', '/digest/today', null, tokens.gina)).body.delivered;
    check('réessai au run suivant (2 essais)', f2.body.failed === 1 && g.attempts === 2);
    const gm = await call('POST', '/digest/send-now', null, tokens.gina);
    check('send-now SMTP en panne -> delivery failed', gm.status === 200 && gm.body.delivery?.status === 'failed' && /échoué/.test(gm.body.message));

    await stopApi(api);
    api = await startApi(uri);
    admin = (await call('POST', '/auth/login', { email: 'admin@exemple.ci', password: 'nouveau-mdp-admin' })).body.accessToken;
    const f3 = await call('POST', '/admin/digest/run', null, admin);
    g = (await call('GET', '/digest/today', null, tokens.gina)).body.delivered;
    check('SMTP revenu -> 3e essai réussi', f3.body.sent === 1 && g.status === 'sent' && g.attempts === 3 && g.error === null, JSON.stringify(f3.body));
    // Abandon après 3 essais : on force un échec à 3 essais en base.
    await db.collection('deliveries').updateOne({ _id: new ObjectId(g.id) }, { $set: { status: 'failed' } });
    const f4 = await call('POST', '/admin/digest/run', null, admin);
    check('échec après 3 essais -> abandonné', f4.body.sent === 0 && f4.body.failed === 0, JSON.stringify(f4.body));

    // --- Planification automatique (toutes les 2 s pour le test) ---
    await db.collection('users').updateOne({ email: 'hana@exemple.ci' }, { $set: { 'preferences.active': true } });
    await stopApi(api);
    api = await startApi(uri, { DIGEST_CRON: '*/2 * * * * *' });
    check('envois planifiés annoncés', api.out.includes('Envois automatiques vérifiés selon'));
    for (let i = 0; i < 40 && !/Envois : 1 envoyée/.test(api.out); i++) await new Promise((r) => setTimeout(r, 250));
    check('veille de hana envoyée automatiquement', /Envois : 1 envoyée/.test(api.out) && api.out.includes('hana@exemple.ci'));
    await stopApi(api);
    api = undefined;

    const bad = await startApi(uri, { DIGEST_CRON: 'chaque matin' });
    await new Promise((r) => setTimeout(r, 800));
    check('DIGEST_CRON invalide -> message clair', bad.out.includes('DIGEST_CRON n\'est pas une expression cron valide'));
    await stopApi(bad);
  } finally {
    if (api) await stopApi(api);
    await conn.close().catch(() => {});
    await mongo.stop().catch(() => {});
  }
  console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} échec(s)`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
