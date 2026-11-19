// Phase 3 : collecte mutualisée, avec de faux flux RSS et une fausse IA Gemini (aucun appel Internet).
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const { MongoMemoryServer } = require(path.join(root, 'node_modules/mongodb-memory-server'));
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

async function startApi(mongoUri, extraEnv) {
  const defaults = {
    SMTP_HOST: undefined, SMTP_PORT: undefined, SMTP_USER: undefined, SMTP_PASSWORD: undefined, MAIL_FROM: undefined, APP_URL: undefined,
    GEMINI_API_KEY: 'cle-de-test', GEMINI_BASE_URL: FAKE, GEMINI_MODEL: undefined, COLLECT_CRON: 'off', DIGEST_CRON: 'off', NODE_ENV: undefined,
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

// --- Faux serveur : flux RSS + API Gemini ---
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toUTCString();
const feeds = {
  '/feed1': [
    { title: 'Node streams HIGH', link: 'https://blog.ci/streams', date: hoursAgo(1) },
    { title: 'Postgres indexes', link: 'https://blog.ci/pg', date: hoursAgo(2) },
    { title: 'Kubernetes WEIRD', link: 'https://blog.ci/k8s', date: hoursAgo(3) },
    { title: 'Article OMIT', link: 'https://blog.ci/omit', date: hoursAgo(4) },
    { title: 'Partagé', link: 'https://blog.ci/shared', date: hoursAgo(5) },
    { title: 'Trop vieux', link: 'https://blog.ci/old', date: hoursAgo(72) },
    { title: 'Sans lien', link: '', date: hoursAgo(1) },
  ],
  '/feed2': [
    { title: 'Partagé aussi', link: 'https://blog.ci/shared', date: hoursAgo(5) },
    { title: 'LLM &amp; <b>agents</b> &#8217;ok', link: 'https://blog.ci/llm', date: hoursAgo(6), description: '<p>Un &lt;extrait&gt; <script>x()</script>avec du HTML</p>' },
  ],
};
let geminiMode = 'ok';
let geminiCalls = 0;
const rss = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items.map((i) =>
  `<item><title><![CDATA[${i.title}]]></title>${i.link ? `<link>${i.link}</link>` : ''}<pubDate>${i.date}</pubDate><description><![CDATA[${i.description ?? 'Extrait de ' + i.title}]]></description></item>`).join('')}</channel></rss>`;

const fake = http.createServer(async (req, res) => {
  if (req.method === 'GET') {
    if (req.url === '/broken') { res.writeHead(500); return res.end('panne'); }
    if (req.url === '/notxml') { res.writeHead(200); return res.end('ceci n est pas du xml <<<'); }
    const items = feeds[req.url];
    if (!items) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/rss+xml' });
    return res.end(rss(items));
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  geminiCalls++;
  fake.lastRequest = { url: req.url, key: req.headers['x-goog-api-key'], body: raw };
  if (geminiMode === '500') { res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { code: 500, message: 'panne', status: 'INTERNAL' } })); }
  if (geminiMode === '429') { res.writeHead(429, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { code: 429, message: 'quota', status: 'RESOURCE_EXHAUSTED' } })); }
  if (geminiMode === 'slow') await new Promise((r) => setTimeout(r, 1500));
  const text = JSON.parse(raw).contents[0].parts[0].text;
  const articles = JSON.parse(text.slice(text.indexOf('Articles RSS :') + 'Articles RSS :'.length));
  fake.batchSizes.push(articles.length);
  const out = articles.filter((a) => !a.title.includes('OMIT')).map((a) => ({
    title_fr: 'FR ' + a.title,
    category: a.title.includes('WEIRD') ? 'Cuisine' : a.title.includes('LLM') ? 'IA' : 'Backend',
    summary: 'Résumé de ' + a.title,
    relevance_score: a.title.includes('HIGH') ? 12 : 6.6,
    url: a.link,
  }));
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(out) }] }, finishReason: 'STOP' }] }));
});
fake.batchSizes = [];

(async () => {
  await new Promise((r) => fake.listen(4999, '127.0.0.1', r));
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('veille');
  let api;
  try {
    api = await startApi(uri, { ADMIN_PASSWORD: 'motdepasse-admin' });
    check('COLLECT_CRON=off -> collecte automatique désactivée', api.out.includes('Collecte automatique désactivée'));

    let admin = (await call('POST', '/auth/login', { email: 'admin@exemple.ci', password: 'motdepasse-admin' })).body.accessToken;
    await call('POST', '/auth/change-password', { currentPassword: 'motdepasse-admin', newPassword: 'nouveau-mdp-admin' }, admin);
    admin = (await call('POST', '/auth/login', { email: 'admin@exemple.ci', password: 'nouveau-mdp-admin' })).body.accessToken;
    const reg = await call('POST', '/auth/register', { email: 'awa@exemple.ci', password: 'motdepasse1', firstName: 'Awa', lastName: 'K' });
    const user = reg.body.accessToken;

    // Les 6 vrais flux sont désactivés pour ne pas appeler Internet.
    for (const s of (await call('GET', '/admin/sources', null, admin)).body) {
      await call('PATCH', `/admin/sources/${s.id}`, { active: false }, admin);
    }
    const src = {};
    for (const [name, p, topic] of [['Faux 1', '/feed1', 'Backend'], ['Faux 2', '/feed2', 'IA'], ['En panne', '/broken', 'DevOps'], ['Pas du XML', '/notxml', 'Tech']]) {
      const r = await call('POST', '/admin/sources', { name, feedUrl: FAKE + p, topic }, admin);
      src[name] = r.body.id;
    }
    check('sources de test créées', Object.values(src).every(Boolean));

    check('utilisateur -> 403 sur /admin/collector', (await call('GET', '/admin/collector', null, user)).status === 403);
    check('utilisateur -> 403 sur collector/run', (await call('POST', '/admin/collector/run', null, user)).status === 403);
    const st0 = await call('GET', '/admin/collector', null, admin);
    check('état initial', st0.status === 200 && st0.body.running === false && st0.body.schedule === null && st0.body.summariesEnabled === true && st0.body.lastReport === null && st0.body.articles.pending === 0, JSON.stringify(st0.body));

    // --- 1re collecte ---
    const r1 = await call('POST', '/admin/collector/run', null, admin);
    console.log('    rapport : ' + JSON.stringify(r1.body));
    check('collecte -> 200', r1.status === 200);
    check('4 sources lues, 2 en erreur', r1.body.sources === 4 && r1.body.sourcesFailed === 2);
    check('6 nouveaux articles (doublon, ancien et sans lien ignorés)', r1.body.newArticles === 6);
    check('5 résumés, 1 omis par l’IA', r1.body.summarized === 5 && r1.body.failed === 1 && r1.body.pending === 1 && r1.body.summariesStopped === null);
    check('lots de 4 au plus', fake.batchSizes.length === 2 && fake.batchSizes.every((n) => n <= 4), JSON.stringify(fake.batchSizes));
    check('clé et modèle envoyés à Gemini', fake.lastRequest.key === 'cle-de-test' && fake.lastRequest.url.includes('gemini-3.1-flash-lite:generateContent'), fake.lastRequest.url);

    const sources = (await call('GET', '/admin/sources', null, admin)).body;
    const byId = Object.fromEntries(sources.map((s) => [s.id, s]));
    check('source OK : lastFetchedAt rempli, pas d’erreur', byId[src['Faux 1']].lastFetchedAt && byId[src['Faux 1']].lastError === null);
    check('source en panne : erreur enregistrée', /500/.test(byId[src['En panne']].lastError ?? ''), byId[src['En panne']].lastError);
    check('source illisible : erreur enregistrée', !!byId[src['Pas du XML']].lastError && byId[src['Pas du XML']].lastFetchedAt, byId[src['Pas du XML']].lastError);
    check('source désactivée non lue', sources.filter((s) => !s.active).every((s) => s.lastFetchedAt === null));

    const summarized = (await call('GET', '/admin/articles?status=summarized', null, admin)).body;
    const art = Object.fromEntries(summarized.items.map((a) => [a.url, a]));
    check('5 articles résumés listés', summarized.total === 5);
    check('champs IA enregistrés', art['https://blog.ci/pg']?.titleFr === 'FR Postgres indexes' && art['https://blog.ci/pg'].summary === 'Résumé de Postgres indexes' && art['https://blog.ci/pg'].topic === 'Backend' && art['https://blog.ci/pg'].summarizedAt, JSON.stringify(art['https://blog.ci/pg']));
    check('note arrondie (6.6 -> 7)', art['https://blog.ci/pg']?.score === 7);
    check('note plafonnée (12 -> 10)', art['https://blog.ci/streams']?.score === 10);
    check('catégorie inconnue -> Tech', art['https://blog.ci/k8s']?.topic === 'Tech');
    check('article partagé enregistré une seule fois', summarized.items.filter((a) => a.url === 'https://blog.ci/shared').length === 1);
    check('extrait nettoyé du HTML', (() => { const a = art['https://blog.ci/llm']; return a && !a.title.includes('<') && a.title === 'LLM & agents ’ok'; })(), art['https://blog.ci/llm']?.title);
    const failed = (await call('GET', '/admin/articles?status=failed', null, admin)).body;
    check('article omis -> failed, 1 essai, erreur notée', failed.total === 1 && failed.items[0].url === 'https://blog.ci/omit' && failed.items[0].attempts === 1 && /absent/.test(failed.items[0].lastError));
    check('statut inconnu -> 400', (await call('GET', '/admin/articles?status=xyz', null, admin)).status === 400);

    // --- Collectes suivantes : pas de doublon, réessai des échecs puis abandon ---
    const callsBefore = geminiCalls;
    const r2 = await call('POST', '/admin/collector/run', null, admin);
    check('2e collecte : aucun nouvel article', r2.body.newArticles === 0);
    check('2e collecte : seul l’échec est renvoyé à l’IA', geminiCalls === callsBefore + 1 && fake.batchSizes.at(-1) === 1);
    await call('POST', '/admin/collector/run', null, admin);
    const r4 = await call('POST', '/admin/collector/run', null, admin);
    const omit = (await call('GET', '/admin/articles?status=failed', null, admin)).body.items[0];
    check('abandon après 3 essais', omit.attempts === 3 && r4.body.pending === 0 && r4.body.failed === 0, JSON.stringify({ attempts: omit.attempts, pending: r4.body.pending }));
    const retry = await call('POST', '/admin/articles/retry-failed', null, admin);
    check('retry-failed remet l’abandonné en attente', retry.status === 200 && retry.body.requeued === 1);
    check('compteurs par état', JSON.stringify((await call('GET', '/admin/collector', null, admin)).body.articles) === JSON.stringify({ pending: 1, summarized: 5, failed: 0 }));

    // --- Gemini en panne (500) : lot en échec, la collecte continue ---
    feeds['/feed1'].push({ title: 'Nouveau A', link: 'https://blog.ci/a', date: hoursAgo(0.5) });
    geminiMode = '500';
    const r5 = await call('POST', '/admin/collector/run', null, admin);
    check('IA en panne : articles en échec, réessayés plus tard', r5.status === 200 && r5.body.newArticles === 1 && r5.body.failed === 2 && r5.body.pending === 2 && r5.body.summariesStopped === null, JSON.stringify(r5.body));

    // --- Quota épuisé (429) : résumés interrompus ---
    geminiMode = '429';
    const r6 = await call('POST', '/admin/collector/run', null, admin);
    check('quota épuisé : résumés interrompus avec la raison', r6.status === 200 && /429/.test(r6.body.summariesStopped ?? ''), JSON.stringify(r6.body.summariesStopped));

    // --- Une seule collecte à la fois ---
    geminiMode = 'slow';
    const first = call('POST', '/admin/collector/run', null, admin);
    await new Promise((r) => setTimeout(r, 300));
    const st = await call('GET', '/admin/collector', null, admin);
    check('running = true pendant la collecte', st.body.running === true);
    check('2e collecte simultanée -> 409', (await call('POST', '/admin/collector/run', null, admin)).status === 409);
    const r7 = await first;
    check('la 1re collecte se termine et rattrape les échecs (l’omis abandonne à nouveau)', r7.status === 200 && r7.body.summarized === 1 && r7.body.failed === 1 && r7.body.pending === 0, JSON.stringify(r7.body));
    check('dernier rapport conservé', (await call('GET', '/admin/collector', null, admin)).body.lastReport?.summarized === 1);
    geminiMode = 'ok';

    // --- Sans clé Gemini : collecte sans résumé ---
    await stopApi(api);
    feeds['/feed2'].push({ title: 'Nouveau B', link: 'https://blog.ci/b', date: hoursAgo(0.5) });
    api = await startApi(uri, { GEMINI_API_KEY: undefined });
    check('sans clé : avertissement au démarrage', api.out.includes('GEMINI_API_KEY absent'));
    admin = (await call('POST', '/auth/login', { email: 'admin@exemple.ci', password: 'nouveau-mdp-admin' })).body.accessToken;
    const r8 = await call('POST', '/admin/collector/run', null, admin);
    check('sans clé : article collecté et laissé en attente', r8.body.newArticles === 1 && r8.body.summarized === 0 && r8.body.pending === 1 && /GEMINI_API_KEY/.test(r8.body.summariesStopped), JSON.stringify(r8.body));
    check('sans clé : summariesEnabled false', (await call('GET', '/admin/collector', null, admin)).body.summariesEnabled === false);

    // --- Planification automatique (toutes les secondes pour le test) ---
    await stopApi(api);
    api = await startApi(uri, { COLLECT_CRON: '*/2 * * * * *' });
    check('collecte planifiée annoncée', api.out.includes('Collecte automatique planifiée'));
    for (let i = 0; i < 40 && !api.out.includes('Collecte : '); i++) await new Promise((r) => setTimeout(r, 250));
    check('collecte lancée automatiquement', api.out.includes('Collecte : '));
    for (let i = 0; i < 20 && !/1 résumé/.test(api.out); i++) await new Promise((r) => setTimeout(r, 250));
    check('l’article en attente est résumé dès que la clé est là', /1 résumé/.test(api.out));
    await stopApi(api);
    api = undefined;

    // --- Configuration invalide ---
    const badCron = await startApi(uri, { COLLECT_CRON: 'toutes les heures' });
    await new Promise((r) => setTimeout(r, 800));
    check('COLLECT_CRON invalide -> message clair', badCron.out.includes('COLLECT_CRON n\'est pas une expression cron valide'));
    await stopApi(badCron);
    const prod = await startApi(uri, { NODE_ENV: 'production', GEMINI_API_KEY: undefined, SMTP_HOST: 'h', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASSWORD: 'p', MAIL_FROM: 'a@b.ci' });
    await new Promise((r) => setTimeout(r, 800));
    check('production sans GEMINI_API_KEY -> refusé', prod.out.includes('GEMINI_API_KEY est obligatoire en production'));
    await stopApi(prod);
  } finally {
    if (api) await stopApi(api);
    await mongo.stop().catch(() => {});
    fake.close();
  }
  console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} échec(s)`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
