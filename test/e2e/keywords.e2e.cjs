// Phase 4.5 : sujets libres recherchés sur Google News (faux Google News + fausse IA, aucun appel Internet).
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const { MongoMemoryServer } = require(path.join(root, 'node_modules/mongodb-memory-server'));
const mongoose = require(path.join(root, 'node_modules/mongoose'));
const BASE = 'http://localhost:3998';
const FAKE = 'http://127.0.0.1:4999';

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
    GEMINI_API_KEY: 'cle-de-test', GEMINI_BASE_URL: FAKE, GEMINI_MODEL: undefined, GOOGLE_NEWS_URL: FAKE,
    COLLECT_CRON: 'off', DIGEST_CRON: 'off', NODE_ENV: undefined,
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

// --- Faux serveur : Google News (recherche RSS), un flux classique et l'API Gemini ---
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toUTCString();
const searches = {
  flutter: Array.from({ length: 12 }, (_, i) => ({ title: `Flutter news ${i + 1} - Le Blog`, link: `https://news.google.com/rss/articles/flutter${i + 1}`, date: hoursAgo(i + 1) })),
  'mobile money': [
    { title: 'Mobile Money en Côte d’Ivoire - Fraternité Matin', link: 'https://news.google.com/rss/articles/mm1', date: hoursAgo(2) },
    { title: 'Flutter pour le Mobile Money - Le Blog', link: 'https://news.google.com/rss/articles/shared', date: hoursAgo(3) },
    { title: 'Mobile Money LOW - Blog', link: 'https://news.google.com/rss/articles/mmlow', date: hoursAgo(4) },
  ],
  kotlin: [{ title: 'Kotlin 3 - Blog', link: 'https://news.google.com/rss/articles/kotlin', date: hoursAgo(1) }],
  politique: [{ title: 'Élections législatives POLITIQUE - Fraternité Matin', link: 'https://news.google.com/rss/articles/pol1', date: hoursAgo(1) }],
};
const sentToAi = [];
searches.flutter.push({ title: 'Flutter pour le Mobile Money - Le Blog', link: 'https://news.google.com/rss/articles/shared', date: hoursAgo(3) });
const feed = [{ title: 'Node 30 sort', link: 'https://blog.ci/node', date: hoursAgo(1) }];
const searchLog = [];
let searchBroken = null;
const rss = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items.map((i) =>
  `<item><title><![CDATA[${i.title}]]></title><link>${i.link}</link><pubDate>${i.date}</pubDate><description><![CDATA[<a href="${i.link}">${i.title}</a>&nbsp;<font color="#6f6f6f">Le Blog</font>]]></description></item>`).join('')}</channel></rss>`;

const fake = http.createServer(async (req, res) => {
  if (req.method === 'GET') {
    const url = new URL(req.url, FAKE);
    if (url.pathname === '/rss/search') {
      const q = url.searchParams.get('q');
      searchLog.push({ q, hl: url.searchParams.get('hl'), gl: url.searchParams.get('gl') });
      const keyword = q.replace(/ when:2d$/, '');
      if (keyword === searchBroken) { res.writeHead(503); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/rss+xml' });
      return res.end(rss(searches[keyword] ?? []));
    }
    if (url.pathname === '/feed') { res.writeHead(200); return res.end(rss(feed)); }
    res.writeHead(404); return res.end();
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const text = JSON.parse(raw).contents[0].parts[0].text;
  const articles = JSON.parse(text.slice(text.indexOf('Articles RSS :') + 'Articles RSS :'.length));
  sentToAi.push(...articles);
  // Comme la vraie IA : un article politique a une note technique basse, mais une bonne note par rapport à son sujet.
  const scoreOf = (a) => (a.title.includes('LOW') ? 2 : a.title.includes('POLITIQUE') ? (a.sujets?.includes('politique') ? 8 : 2) : 7);
  const out = articles.map((a) => ({
    title_fr: 'FR ' + a.title, category: a.title.startsWith('Node') ? 'Backend' : 'Tech', summary: 'Résumé de ' + a.title,
    relevance_score: scoreOf(a), url: a.link,
  }));
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(out) }] }, finishReason: 'STOP' }] }));
});

(async () => {
  await new Promise((r) => fake.listen(4999, '127.0.0.1', r));
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('veille');
  const conn = await mongoose.createConnection(uri).asPromise();
  let api;
  try {
    api = await startApi(uri, { ADMIN_PASSWORD: 'motdepasse-admin' });
    let admin = (await call('POST', '/auth/login', { email: 'admin@exemple.ci', password: 'motdepasse-admin' })).body.accessToken;
    await call('POST', '/auth/change-password', { currentPassword: 'motdepasse-admin', newPassword: 'nouveau-mdp-admin' }, admin);
    admin = (await call('POST', '/auth/login', { email: 'admin@exemple.ci', password: 'nouveau-mdp-admin' })).body.accessToken;
    const tokens = {};
    for (const name of ['awa', 'bob', 'carl']) {
      tokens[name] = (await call('POST', '/auth/register', { email: `${name}@exemple.ci`, password: 'motdepasse1', firstName: name, lastName: 'K' })).body.accessToken;
    }
    await conn.db.collection('users').updateMany({ role: 'user' }, { $set: { emailVerified: true } });
    for (const s of (await call('GET', '/admin/sources', null, admin)).body) {
      await call('PATCH', `/admin/sources/${s.id}`, { active: false }, admin);
    }
    await call('POST', '/admin/sources', { name: 'Faux', feedUrl: FAKE + '/feed', topic: 'Backend' }, admin);

    // --- Préférences : mots-clés libres ---
    const prefs = (token, body) => call('PATCH', '/users/me/preferences', body, token);
    const p0 = await call('GET', '/users/me/preferences', null, tokens.awa);
    check('mots-clés vides par défaut', JSON.stringify(p0.body.keywords) === '[]');
    const p1 = await prefs(tokens.awa, { keywords: ['  Flutter ', 'Mobile   Money'] });
    check('mots-clés enregistrés et normalisés', p1.status === 200 && JSON.stringify(p1.body.keywords) === JSON.stringify(['flutter', 'mobile money']), JSON.stringify(p1.body));
    const bad = async (body, re, label) => {
      const r = await prefs(tokens.awa, body);
      check(label, r.status === 400 && re.test(JSON.stringify(r.body.message)), JSON.stringify(r.body.message));
    };
    await bad({ keywords: ['a', 'b', 'c', 'd', 'e', 'f'] }, /5 mots-clés au plus/, '6 mots-clés -> 400');
    await bad({ keywords: ['Flutter', 'flutter '] }, /une fois/, 'doublon après normalisation -> 400');
    await bad({ keywords: ['x'] }, /entre 2 et 50/, 'mot-clé trop court -> 400');
    await bad({ keywords: ['y'.repeat(51)] }, /entre 2 et 50/, 'mot-clé trop long -> 400');
    await bad({ keywords: [42] }, /texte/, 'mot-clé non texte -> 400');
    await bad({ keywords: 'flutter' }, /liste/, 'keywords pas une liste -> 400');
    await bad({ keywords: null }, /liste/, 'keywords null -> 400');
    const onlyKw = await prefs(tokens.awa, { topics: [] });
    check('aucun sujet fixe mais des mots-clés -> 200', onlyKw.status === 200 && onlyKw.body.topics.length === 0);
    const none = await prefs(tokens.awa, { keywords: [] });
    check('ni sujet ni mot-clé -> 400', none.status === 400 && /au moins un sujet ou un mot-clé/.test(none.body.message));
    check('refus sans rien modifier', JSON.stringify((await call('GET', '/users/me/preferences', null, tokens.awa)).body.keywords) === JSON.stringify(['flutter', 'mobile money']));
    await prefs(tokens.awa, { topics: [] }); // awa : seulement ses mots-clés
    await prefs(tokens.bob, { keywords: ['flutter'] }); // bob : sujets par défaut + flutter
    await prefs(tokens.carl, { keywords: ['kotlin'], active: false }); // carl : en pause, kotlin non recherché

    // --- Collecte ---
    const r1 = await call('POST', '/admin/collector/run', null, admin);
    console.log('    rapport : ' + JSON.stringify(r1.body));
    check('collecte : 2 mots-clés recherchés (kotlin en pause ignoré)', r1.status === 200 && r1.body.keywords === 2 && r1.body.keywordsFailed === 0);
    check('une seule recherche par mot-clé, même suivi par 2 personnes', searchLog.filter((s) => s.q === 'flutter when:2d').length === 1 && !searchLog.some((s) => s.q.startsWith('kotlin')), JSON.stringify(searchLog));
    check('recherche en français, édition CI, 2 derniers jours', searchLog.every((s) => s.hl === 'fr' && s.gl === 'CI' && s.q.endsWith(' when:2d')));
    check('10 articles max par mot-clé : 10 + 3 - 1 partagé + 1 source = 13', r1.body.newArticles === 13, String(r1.body.newArticles));
    check('tous résumés', r1.body.summarized === 13 && r1.body.pending === 0);

    const list = (await call('GET', '/admin/articles?limit=50', null, admin)).body.items;
    const byUrl = Object.fromEntries(list.map((a) => [a.url, a]));
    check('article de recherche : sans source, avec son mot-clé', byUrl['https://news.google.com/rss/articles/mm1']?.sourceId === null && JSON.stringify(byUrl['https://news.google.com/rss/articles/mm1'].keywords) === '["mobile money"]');
    check('article trouvé par 2 mots-clés : enregistré une fois, 2 mots-clés', JSON.stringify([...(byUrl['https://news.google.com/rss/articles/shared']?.keywords ?? [])].sort()) === '["flutter","mobile money"]');
    check('article de source : source et aucun mot-clé', byUrl['https://blog.ci/node']?.sourceId && byUrl['https://blog.ci/node'].keywords.length === 0);
    check('seuls les 10 plus récents de la recherche gardés', !byUrl['https://news.google.com/rss/articles/flutter10'] && !byUrl['https://news.google.com/rss/articles/flutter12'] && !!byUrl['https://news.google.com/rss/articles/flutter9']);

    // --- Veille ---
    const awa = (await call('GET', '/digest/today', null, tokens.awa)).body.articles;
    const urls = awa.map((a) => a.url);
    check('awa : articles de ses mots-clés uniquement (pas la source)', awa.length === 10 && !urls.includes('https://blog.ci/node') && urls.includes('https://news.google.com/rss/articles/mm1'), JSON.stringify(urls));
    check('note minimale aussi appliquée aux mots-clés', !urls.includes('https://news.google.com/rss/articles/mmlow'));
    await prefs(tokens.awa, { maxArticles: 30 });
    check('awa : 11 articles au total (9 flutter, mm1, partagé compté une fois)', (await call('GET', '/digest/today', null, tokens.awa)).body.articles.length === 11);
    const bob = (await call('GET', '/digest/today', null, tokens.bob)).body.articles.map((a) => a.url);
    check('bob : article de sa source + ses mots-clés, rien de « mobile money » seul', bob.includes('https://blog.ci/node') && bob.some((u) => u.includes('flutter')) && !bob.includes('https://news.google.com/rss/articles/mm1'));
    const s = await call('POST', '/digest/send-now', null, tokens.awa);
    check('envoi de la veille avec les articles des mots-clés', s.body.delivery?.status === 'sent' && s.body.delivery.articles.length === 11);

    check('sujets transmis à l’IA pour les articles de mots-clés', sentToAi.find((a) => a.link.endsWith('/mm1'))?.sujets?.[0] === 'mobile money' && JSON.stringify([...sentToAi.find((a) => a.link.endsWith('/shared')).sujets].sort()) === '["flutter","mobile money"]');
    check('pas de sujets pour les articles des sources', sentToAi.find((a) => a.link === 'https://blog.ci/node')?.sujets === undefined);
    const awaToday = (await call('GET', '/digest/history', null, tokens.awa)).body.items[0].articles; // déjà tout reçu
    check('mot-clé indiqué sur chaque article', awaToday.every((a) => a.keyword === 'flutter' || a.keyword === 'mobile money') && awaToday.find((a) => a.url.endsWith('/mm1')).keyword === 'mobile money');
    check('article de sujet fixe : keyword null', (await call('GET', '/digest/today', null, tokens.bob)).body.articles.find((a) => a.url === 'https://blog.ci/node')?.keyword === null);

    // --- Sujet non technique : noté par rapport au mot-clé ---
    await prefs(tokens.bob, { keywords: ['politique'] });
    await call('POST', '/admin/collector/run', null, admin);
    const pol = (await call('GET', '/digest/today', null, tokens.bob)).body.articles.find((a) => a.url.endsWith('/pol1'));
    check('article politique noté par rapport au sujet (8/10) et sélectionné', pol?.score === 8 && pol.keyword === 'politique', JSON.stringify(pol));
    let mark = api.out.length;
    const bs = await call('POST', '/digest/send-now', null, tokens.bob);
    const mail = api.out.slice(mark);
    check('e-mail : le mot-clé à la place du sujet', bs.body.delivery?.articles.some((a) => a.keyword === 'politique') && mail.includes('[politique · 8/10]') && mail.includes('Votre veille du '), mail.slice(0, 400));
    check('historique : mot-clé conservé', (await call('GET', '/digest/history', null, tokens.bob)).body.items[0].articles.some((a) => a.keyword === 'politique'));

    // --- Recherche en panne : la collecte continue ---
    searchBroken = 'flutter';
    await prefs(tokens.carl, { active: true });
    const r2 = await call('POST', '/admin/collector/run', null, admin);
    check('recherche en panne -> comptée, les autres continuent', r2.status === 200 && r2.body.keywords === 4 && r2.body.keywordsFailed === 1 && r2.body.newArticles === 1, JSON.stringify(r2.body));
    check('cause notée dans les logs', api.out.includes('Recherche « flutter » impossible'));

    await stopApi(api);
    const badUrl = await startApi(uri, { GOOGLE_NEWS_URL: 'news.google.com' });
    await new Promise((r) => setTimeout(r, 800));
    check('GOOGLE_NEWS_URL invalide -> message clair', badUrl.out.includes('GOOGLE_NEWS_URL doit être une adresse'));
    await stopApi(badUrl);
    api = undefined;
  } finally {
    if (api) await stopApi(api);
    await conn.close().catch(() => {});
    await mongo.stop().catch(() => {});
    fake.close();
  }
  console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} échec(s)`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
