// Teste le parcours d'authentification de bout en bout sur une base MongoDB temporaire.
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
    // --- Premier lancement avec ADMIN_PASSWORD ---
    api = await startApi(uri, { ADMIN_EMAIL: 'Admin@Exemple.CI', ADMIN_PASSWORD: 'motdepasse-admin' });
    check('admin créé au premier lancement', api.out.includes('compte administrateur créé pour « admin@exemple.ci »'));
    check('mot de passe de .env jamais affiché', !api.out.includes('motdepasse-admin'));

    check('/health public', (await call('GET', '/health')).status === 200);
    check('/users/me sans jeton -> 401', (await call('GET', '/users/me')).status === 401);

    const adminLogin = await call('POST', '/auth/login', { email: 'admin@exemple.ci', password: 'motdepasse-admin' });
    check('login admin -> 200, rôle admin, mustChangePassword', adminLogin.status === 200 && adminLogin.body.user.role === 'admin' && adminLogin.body.user.mustChangePassword === true);

    const bad = await call('POST', '/auth/register', { email: 'pas-un-email', password: '123', firstName: '', lastName: ' ' });
    check('register invalide -> 400', bad.status === 400, JSON.stringify(bad.body.message));
    const noLast = await call('POST', '/auth/register', { email: 'a@b.ci', password: 'motdepasse1', firstName: 'A' });
    check('lastName manquant -> 400', noLast.status === 400, JSON.stringify(noLast.body.message));
    check('champ inconnu (role) refusé -> 400', (await call('POST', '/auth/register', { email: 'a@b.ci', password: 'motdepasse1', firstName: 'A', lastName: 'B', role: 'admin' })).status === 400);

    const first = await call('POST', '/auth/register', { email: ' Emile@Exemple.CI ', password: 'motdepasse1', firstName: ' Emile ', lastName: ' Brou ' });
    check('inscrit -> 201, rôle user, nom et prénom', first.status === 201 && first.body.user.role === 'user' && first.body.user.firstName === 'Emile' && first.body.user.lastName === 'Brou', JSON.stringify(first.body.user));
    check('pas de mot de passe dans la réponse', !JSON.stringify(first.body).includes('passwordHash'));
    check('doublon -> 409', (await call('POST', '/auth/register', { email: 'EMILE@exemple.ci', password: 'motdepasse1', firstName: 'X', lastName: 'Y' })).status === 409);

    // Le rôle est immuable, même en écrivant directement en base via le modèle.
    const mongoose = require(path.join(root, 'node_modules/mongoose'));
    const { UserSchema } = require(path.join(root, 'dist/users/schemas/user.schema.js'));
    const conn = await mongoose.createConnection(uri).asPromise();
    const UserModel = conn.model('User', UserSchema);
    await UserModel.updateOne({ email: 'emile@exemple.ci' }, { $set: { role: 'admin' } });
    const doc = await UserModel.findOne({ email: 'emile@exemple.ci' });
    doc.role = 'admin';
    await doc.save();
    const after = await UserModel.findOne({ email: 'emile@exemple.ci' }).lean();
    check('rôle non modifiable (updateOne et save)', after.role === 'user', after.role);
    await conn.close();

    check('login mauvais mdp -> 401', (await call('POST', '/auth/login', { email: 'emile@exemple.ci', password: 'faux-mdp' })).status === 401);
    check('login email inconnu -> 401', (await call('POST', '/auth/login', { email: 'inconnu@exemple.ci', password: 'faux-mdp' })).status === 401);
    const login = await call('POST', '/auth/login', { email: 'emile@exemple.ci', password: 'motdepasse1' });
    check('login -> 200', login.status === 200 && !!login.body.accessToken);

    const me = await call('GET', '/users/me', undefined, login.body.accessToken);
    check('/users/me avec jeton -> 200', me.status === 200 && me.body.email === 'emile@exemple.ci');
    check('jeton falsifié -> 401', (await call('GET', '/users/me', undefined, login.body.accessToken + 'x')).status === 401);

    const refreshed = await call('POST', '/auth/refresh', { refreshToken: login.body.refreshToken });
    check('refresh -> 200 + nouveau jeton', refreshed.status === 200 && refreshed.body.refreshToken !== login.body.refreshToken);
    check('ancien refresh réutilisé -> 401', (await call('POST', '/auth/refresh', { refreshToken: login.body.refreshToken })).status === 401);
    check('logout -> 204', (await call('POST', '/auth/logout', { refreshToken: refreshed.body.refreshToken })).status === 204);
    check('refresh après logout -> 401', (await call('POST', '/auth/refresh', { refreshToken: refreshed.body.refreshToken })).status === 401);

    // --- Mot de passe provisoire : l'admin est bloqué tant qu'il ne l'a pas changé ---
    const tok = adminLogin.body.accessToken;
    check('admin provisoire : GET /users/me autorisé', (await call('GET', '/users/me', undefined, tok)).status === 200);
    const blocked = await call('GET', '/admin/users', undefined, tok);
    check('admin provisoire : autres routes -> 403', blocked.status === 403, blocked.body.message);
    check('admin provisoire : PATCH /users/me -> 403', (await call('PATCH', '/users/me', { firstName: 'X' }, tok)).status === 403);

    // --- Changement du mot de passe de l'admin ---
    check('change-password sans jeton -> 401', (await call('POST', '/auth/change-password', { currentPassword: 'x', newPassword: 'nouveau-mdp-1' })).status === 401);
    check('change-password mauvais actuel -> 401', (await call('POST', '/auth/change-password', { currentPassword: 'faux', newPassword: 'nouveau-mdp-1' }, tok)).status === 401);
    check('change-password identique -> 400', (await call('POST', '/auth/change-password', { currentPassword: 'motdepasse-admin', newPassword: 'motdepasse-admin' }, tok)).status === 400);
    const changed = await call('POST', '/auth/change-password', { currentPassword: 'motdepasse-admin', newPassword: 'nouveau-mdp-1' }, tok);
    check('change-password -> 200, mustChangePassword=false', changed.status === 200 && changed.body.user.mustChangePassword === false);
    check('anciennes sessions fermées', (await call('POST', '/auth/refresh', { refreshToken: adminLogin.body.refreshToken })).status === 401);
    check('ancien mdp refusé', (await call('POST', '/auth/login', { email: 'admin@exemple.ci', password: 'motdepasse-admin' })).status === 401);
    check('nouveau mdp accepté', (await call('POST', '/auth/login', { email: 'admin@exemple.ci', password: 'nouveau-mdp-1' })).status === 200);

    // --- Profil : PATCH /users/me ---
    const adminTok = changed.body.accessToken;
    const userLogin = await call('POST', '/auth/login', { email: 'emile@exemple.ci', password: 'motdepasse1' });
    const userTok = userLogin.body.accessToken;
    const upd = await call('PATCH', '/users/me', { lastName: '  Nando Brou ' }, userTok);
    check('PATCH /users/me -> nom modifié, prénom inchangé', upd.status === 200 && upd.body.lastName === 'Nando Brou' && upd.body.firstName === 'Emile', JSON.stringify(upd.body));
    check('PATCH /users/me vide -> 400', (await call('PATCH', '/users/me', {}, userTok)).status === 400);
    check('PATCH /users/me prénom vide -> 400', (await call('PATCH', '/users/me', { firstName: '  ' }, userTok)).status === 400);
    check('PATCH /users/me role -> 400', (await call('PATCH', '/users/me', { role: 'admin' }, userTok)).status === 400);
    check('PATCH /users/me email -> 400', (await call('PATCH', '/users/me', { email: 'x@y.ci' }, userTok)).status === 400);

    // --- Rôles : routes admin ---
    check('user sur /admin/users -> 403', (await call('GET', '/admin/users', undefined, userTok)).status === 403);
    const list = await call('GET', '/admin/users?page=1&limit=10', undefined, adminTok);
    check('admin : liste des inscrits', list.status === 200 && list.body.total === 2 && list.body.items.length === 2 && 'active' in list.body.items[0], `total=${list.body.total}`);
    check('admin : limit trop grand -> 400', (await call('GET', '/admin/users?limit=500', undefined, adminTok)).status === 400);
    const emileId = list.body.items.find((u) => u.email === 'emile@exemple.ci').id;
    const adminId = list.body.items.find((u) => u.role === 'admin').id;
    check('admin : se désactiver soi-même -> 403', (await call('PATCH', `/admin/users/${adminId}/status`, { active: false }, adminTok)).status === 403);
    check('admin : id inconnu -> 404', (await call('PATCH', '/admin/users/pas-un-id/status', { active: false }, adminTok)).status === 404);

    // --- Désactivation : effet immédiat, même avec un jeton encore valide ---
    const userRefresh = userLogin.body.refreshToken;
    const off = await call('PATCH', `/admin/users/${emileId}/status`, { active: false }, adminTok);
    check('admin : désactiver un compte', off.status === 200 && off.body.active === false);
    check('compte désactivé : jeton encore valide refusé', (await call('GET', '/users/me', undefined, userTok)).status === 401);
    check('compte désactivé : refresh refusé', (await call('POST', '/auth/refresh', { refreshToken: userRefresh })).status === 401);
    check('compte désactivé : login refusé', (await call('POST', '/auth/login', { email: 'emile@exemple.ci', password: 'motdepasse1' })).status === 401);
    check('admin : réactiver', (await call('PATCH', `/admin/users/${emileId}/status`, { active: true }, adminTok)).body.active === true);
    const relog = await call('POST', '/auth/login', { email: 'emile@exemple.ci', password: 'motdepasse1' });
    check('compte réactivé : login OK', relog.status === 200);

    // --- Suppression du compte ---
    const relogTok = relog.body.accessToken;
    check('DELETE /users/me sans mdp -> 400', (await call('DELETE', '/users/me', {}, relogTok)).status === 400);
    check('DELETE /users/me mauvais mdp -> 401', (await call('DELETE', '/users/me', { password: 'faux' }, relogTok)).status === 401);
    check('admin : DELETE /users/me -> 403', (await call('DELETE', '/users/me', { password: 'nouveau-mdp-1' }, adminTok)).status === 403);
    check('DELETE /users/me -> 204', (await call('DELETE', '/users/me', { password: 'motdepasse1' }, relogTok)).status === 204);
    check('compte supprimé : jeton refusé', (await call('GET', '/users/me', undefined, relogTok)).status === 401);
    check('compte supprimé : refresh refusé', (await call('POST', '/auth/refresh', { refreshToken: relog.body.refreshToken })).status === 401);
    check('compte supprimé : login refusé', (await call('POST', '/auth/login', { email: 'emile@exemple.ci', password: 'motdepasse1' })).status === 401);
    check('admin : il ne reste qu’un inscrit', (await call('GET', '/admin/users', undefined, adminTok)).body.total === 1);
    check('e-mail réutilisable après suppression', (await call('POST', '/auth/register', { email: 'emile@exemple.ci', password: 'motdepasse1', firstName: 'E', lastName: 'B' })).status === 201);

    // --- Étape 1.2 : e-mails (SMTP absent : ils sont affichés dans la console, on les lit là) ---
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const lastLink = (from) => [...api.out.slice(from).matchAll(/verify-email\?token=([A-Za-z0-9_-]+)/g)].pop()?.[1];
    const lastCode = (from) => [...api.out.slice(from).matchAll(/\(valable 1 heure\) :\r?\n([A-Za-z0-9_-]+)/g)].pop()?.[1];
    check('SMTP absent : avertissement au démarrage', api.out.includes('SMTP non configuré'));

    let mark = api.out.length;
    const awa = await call('POST', '/auth/register', { email: 'awa@exemple.ci', password: 'motdepasse-awa', firstName: 'Awa', lastName: 'Koné' });
    await sleep(200);
    check('inscription -> emailVerified=false', awa.status === 201 && awa.body.user.emailVerified === false);
    const link1 = lastLink(mark);
    check('inscription -> e-mail de confirmation avec lien', !!link1 && api.out.slice(mark).includes('Confirmez votre adresse e-mail'));
    check('lien construit avec APP_URL par défaut', api.out.slice(mark).includes('http://localhost:3998/auth/verify-email?token='));
    check('resend juste après -> 429', (await call('POST', '/auth/resend-verification', undefined, awa.body.accessToken)).status === 429);
    check('resend sans jeton -> 401', (await call('POST', '/auth/resend-verification')).status === 401);

    // On fait comme si le dernier envoi datait de plus d'une minute.
    const conn2 = await mongoose.createConnection(uri).asPromise();
    const backdate = (type) => conn2.db.collection('tokens').updateMany({ type }, { $set: { createdAt: new Date(Date.now() - 120_000) } });
    await backdate('email_verification');
    mark = api.out.length;
    const resent = await call('POST', '/auth/resend-verification', undefined, awa.body.accessToken);
    await sleep(200);
    const link2 = lastLink(mark);
    check('resend -> 200 + nouveau lien', resent.status === 200 && !!link2 && link2 !== link1, resent.body.message);
    check('ancien lien invalidé par le renvoi -> 400', (await call('GET', `/auth/verify-email?token=${link1}`)).status === 400);
    check('verify-email sans token -> 400', (await call('GET', '/auth/verify-email')).status === 400);
    check('verify-email faux token -> 400', (await call('GET', '/auth/verify-email?token=faux')).status === 400);
    const verified = await call('GET', `/auth/verify-email?token=${link2}`);
    check('verify-email -> 200', verified.status === 200, verified.body.message);
    check('lien à usage unique -> 400', (await call('GET', `/auth/verify-email?token=${link2}`)).status === 400);
    check('/users/me -> emailVerified=true', (await call('GET', '/users/me', undefined, awa.body.accessToken)).body.emailVerified === true);
    check('resend déjà confirmé -> 400', (await call('POST', '/auth/resend-verification', undefined, awa.body.accessToken)).status === 400);

    // Mot de passe oublié
    mark = api.out.length;
    const unknown = await call('POST', '/auth/forgot-password', { email: 'personne@exemple.ci' });
    const known = await call('POST', '/auth/forgot-password', { email: ' AWA@exemple.ci ' });
    await sleep(300);
    check('forgot : même réponse pour adresse connue et inconnue', unknown.status === 200 && known.status === 200 && unknown.body.message === known.body.message);
    check('forgot : aucun e-mail pour l’adresse inconnue', !api.out.slice(mark).includes('personne@exemple.ci'));
    const code1 = lastCode(mark);
    check('forgot : code reçu par e-mail', !!code1);
    check('forgot email invalide -> 400', (await call('POST', '/auth/forgot-password', { email: 'nope' })).status === 400);
    mark = api.out.length;
    await call('POST', '/auth/forgot-password', { email: 'awa@exemple.ci' });
    await sleep(300);
    check('forgot répété dans la minute : pas de nouvel e-mail', !lastCode(mark));

    await backdate('password_reset');
    mark = api.out.length;
    await call('POST', '/auth/forgot-password', { email: 'awa@exemple.ci' });
    await sleep(300);
    const code2 = lastCode(mark);
    check('nouvelle demande -> nouveau code', !!code2 && code2 !== code1);
    check('reset avec ancien code -> 400', (await call('POST', '/auth/reset-password', { token: code1, newPassword: 'nouveau-awa-1' })).status === 400);
    check('reset faux code -> 400', (await call('POST', '/auth/reset-password', { token: 'faux', newPassword: 'nouveau-awa-1' })).status === 400);
    check('reset mdp trop court -> 400', (await call('POST', '/auth/reset-password', { token: code2, newPassword: '123' })).status === 400);
    const reset = await call('POST', '/auth/reset-password', { token: code2, newPassword: 'nouveau-awa-1' });
    check('reset -> 200', reset.status === 200, reset.body.message);
    check('code à usage unique -> 400', (await call('POST', '/auth/reset-password', { token: code2, newPassword: 'nouveau-awa-2' })).status === 400);
    check('reset : sessions fermées', (await call('POST', '/auth/refresh', { refreshToken: awa.body.refreshToken })).status === 401);
    check('reset : ancien mdp refusé', (await call('POST', '/auth/login', { email: 'awa@exemple.ci', password: 'motdepasse-awa' })).status === 401);
    check('reset : nouveau mdp accepté', (await call('POST', '/auth/login', { email: 'awa@exemple.ci', password: 'nouveau-awa-1' })).status === 200);

    // Compte désactivé : pas d'e-mail de réinitialisation
    const awaId = (await call('GET', '/admin/users', undefined, adminTok)).body.items.find((u) => u.email === 'awa@exemple.ci').id;
    await call('PATCH', `/admin/users/${awaId}/status`, { active: false }, adminTok);
    await backdate('password_reset');
    mark = api.out.length;
    const offForgot = await call('POST', '/auth/forgot-password', { email: 'awa@exemple.ci' });
    await sleep(300);
    check('compte désactivé : réponse identique, aucun e-mail', offForgot.status === 200 && !lastCode(mark));
    check('aucun code en clair stocké en base', !(await conn2.db.collection('tokens').findOne({ tokenHash: code2 })));
    // --- Étape 1.3 : mode d'inscription, invitations, liens partagés ---
    const lastInvite = (from) => [...api.out.slice(from).matchAll(/\(valable 7 jours\) :\r?\n([A-Za-z0-9_-]+)/g)].pop()?.[1];
    const reg = (email, extra = {}) => call('POST', '/auth/register', { email, password: 'motdepasse-x', firstName: 'Prénom', lastName: 'Nom', ...extra });

    const modeInfo = await call('GET', '/auth/registration-mode');
    check('registration-mode public, open par défaut', modeInfo.status === 200 && modeInfo.body.registrationMode === 'open');
    const yao = await reg('yao@exemple.ci');
    check('mode open : inscription libre', yao.status === 201);
    const yaoTok = yao.body.accessToken;
    check('user sur /admin/settings -> 403', (await call('GET', '/admin/settings', undefined, yaoTok)).status === 403);
    check('user sur /admin/invitations -> 403', (await call('POST', '/admin/invitations', { email: 'z@z.ci' }, yaoTok)).status === 403);
    check('user sur /admin/invite-links -> 403', (await call('GET', '/admin/invite-links', undefined, yaoTok)).status === 403);
    check('mode invalide -> 400', (await call('PATCH', '/admin/settings', { registrationMode: 'ferme' }, adminTok)).status === 400);
    const setInv = await call('PATCH', '/admin/settings', { registrationMode: 'invitation' }, adminTok);
    check('admin : passer en mode invitation', setInv.status === 200 && setInv.body.registrationMode === 'invitation');
    check('GET /admin/settings', (await call('GET', '/admin/settings', undefined, adminTok)).body.registrationMode === 'invitation');
    const closed = await reg('libre@exemple.ci');
    check('mode invitation : inscription sans code -> 403', closed.status === 403, closed.body.message);

    // Invitations personnelles
    check('inviter un inscrit -> 409', (await call('POST', '/admin/invitations', { email: 'yao@exemple.ci' }, adminTok)).status === 409);
    check('inviter e-mail invalide -> 400', (await call('POST', '/admin/invitations', { email: 'nope' }, adminTok)).status === 400);
    mark = api.out.length;
    const inv1 = await call('POST', '/admin/invitations', { email: 'Koffi@Exemple.ci' }, adminTok);
    await sleep(200);
    const invCode1 = lastInvite(mark);
    check('invitation -> 201, en attente, e-mail envoyé', inv1.status === 201 && inv1.body.status === 'pending' && inv1.body.email === 'koffi@exemple.ci' && !!invCode1);
    check('invitation : nom de l’admin dans l’e-mail', api.out.slice(mark).includes('Admin Plateforme vous invite'));
    check('invitation : code absent de la réponse', !JSON.stringify(inv1.body).includes(invCode1));
    mark = api.out.length;
    await call('POST', '/admin/invitations', { email: 'koffi@exemple.ci' }, adminTok);
    await sleep(200);
    const invCode2 = lastInvite(mark);
    check('ré-inviter : ancien code invalidé', (await reg('koffi@exemple.ci', { invitationToken: invCode1 })).status === 400);
    check('invitation avec une autre adresse -> 400', (await reg('autre@exemple.ci', { invitationToken: invCode2 })).status === 400);
    check('invitationToken + inviteCode -> 400', (await reg('koffi@exemple.ci', { invitationToken: invCode2, inviteCode: 'x' })).status === 400);
    mark = api.out.length;
    const koffi = await reg('KOFFI@exemple.ci', { invitationToken: invCode2 });
    await sleep(200);
    check('inscription par invitation -> 201, e-mail déjà confirmé', koffi.status === 201 && koffi.body.user.emailVerified === true && koffi.body.user.role === 'user');
    check('pas d’e-mail de confirmation pour un invité', !api.out.slice(mark).includes('Confirmez votre adresse'));
    check('invitation à usage unique', (await reg('koffi@exemple.ci', { invitationToken: invCode2 })).status === 400);

    const conn3 = await mongoose.createConnection(uri).asPromise();
    mark = api.out.length;
    await call('POST', '/admin/invitations', { email: 'expire@exemple.ci' }, adminTok);
    await sleep(200);
    const expCode = lastInvite(mark);
    await conn3.db.collection('invitations').updateOne({ email: 'expire@exemple.ci' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    check('invitation expirée -> 400', (await reg('expire@exemple.ci', { invitationToken: expCode })).status === 400);
    mark = api.out.length;
    const revInv = await call('POST', '/admin/invitations', { email: 'annule@exemple.ci' }, adminTok);
    await sleep(200);
    const revCode = lastInvite(mark);
    check('annuler une invitation -> 204', (await call('DELETE', `/admin/invitations/${revInv.body.id}`, undefined, adminTok)).status === 204);
    check('invitation annulée -> 400', (await reg('annule@exemple.ci', { invitationToken: revCode })).status === 400);
    check('annuler deux fois -> 404', (await call('DELETE', `/admin/invitations/${revInv.body.id}`, undefined, adminTok)).status === 404);
    check('annuler id invalide -> 404', (await call('DELETE', '/admin/invitations/pas-un-id', undefined, adminTok)).status === 404);
    const invList = (await call('GET', '/admin/invitations', undefined, adminTok)).body;
    const statusOf = (email) => invList.find((i) => i.email === email)?.status;
    check('liste : accepted / expired', statusOf('koffi@exemple.ci') === 'accepted' && statusOf('expire@exemple.ci') === 'expired', JSON.stringify(invList.map((i) => [i.email, i.status])));
    check('aucun code d’invitation en clair en base', !(await conn3.db.collection('invitations').findOne({ tokenHash: invCode2 })));

    // Liens partagés
    check('lien maxUses 0 -> 400', (await call('POST', '/admin/invite-links', { maxUses: 0 }, adminTok)).status === 400);
    check('lien champ inconnu -> 400', (await call('POST', '/admin/invite-links', { code: 'perso' }, adminTok)).status === 400);
    const link = await call('POST', '/admin/invite-links', { label: ' Groupe WhatsApp ', maxUses: 1 }, adminTok);
    check('lien créé', link.status === 201 && !!link.body.code && link.body.status === 'active' && link.body.uses === 0 && link.body.label === 'Groupe WhatsApp', JSON.stringify(link.body));
    const dup = await reg('yao@exemple.ci', { inviteCode: link.body.code });
    check('lien + e-mail déjà pris -> 409', dup.status === 409);
    check('… et la place est rendue', (await call('GET', '/admin/invite-links', undefined, adminTok)).body[0].uses === 0);
    mark = api.out.length;
    const viaLink = await reg('ama@exemple.ci', { inviteCode: link.body.code });
    await sleep(200);
    check('inscription par lien -> 201, e-mail à confirmer', viaLink.status === 201 && viaLink.body.user.emailVerified === false);
    check('inscription par lien : e-mail de confirmation envoyé', api.out.slice(mark).includes('Confirmez votre adresse'));
    check('lien complet -> 400', (await reg('ama2@exemple.ci', { inviteCode: link.body.code })).status === 400);
    const links = (await call('GET', '/admin/invite-links', undefined, adminTok)).body;
    check('liste : lien complet (full, 1/1)', links[0].status === 'full' && links[0].uses === 1, JSON.stringify(links[0]));
    check('code inconnu -> 400', (await reg('ama3@exemple.ci', { inviteCode: 'inconnu' })).status === 400);

    const openLink = await call('POST', '/admin/invite-links', { expiresInDays: 30 }, adminTok);
    check('lien illimité avec expiration', openLink.status === 201 && openLink.body.maxUses === null && !!openLink.body.expiresAt);
    check('lien illimité : 1re inscription', (await reg('l1@exemple.ci', { inviteCode: openLink.body.code })).status === 201);
    check('lien illimité : 2e inscription', (await reg('l2@exemple.ci', { inviteCode: openLink.body.code })).status === 201);
    await conn3.db.collection('invite_links').updateOne({ code: openLink.body.code }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    check('lien expiré -> 400', (await reg('l3@exemple.ci', { inviteCode: openLink.body.code })).status === 400);
    const noLimit = await call('POST', '/admin/invite-links', {}, adminTok);
    check('supprimer un lien -> 204', (await call('DELETE', `/admin/invite-links/${noLimit.body.id}`, undefined, adminTok)).status === 204);
    check('lien supprimé -> 400', (await reg('l4@exemple.ci', { inviteCode: noLimit.body.code })).status === 400);
    check('supprimer lien inconnu -> 404', (await call('DELETE', `/admin/invite-links/${noLimit.body.id}`, undefined, adminTok)).status === 404);

    await call('PATCH', '/admin/settings', { registrationMode: 'open' }, adminTok);
    check('retour en mode open : inscription libre', (await reg('libre@exemple.ci')).status === 201);
    await conn3.close();
    await conn2.close();

    // --- Redémarrage : l'admin existe déjà, rien n'est recréé ---
    await stopApi(api);
    api = await startApi(uri, { ADMIN_EMAIL: 'autre@exemple.ci', ADMIN_PASSWORD: undefined });
    check('pas de nouvel admin au redémarrage', api.out.includes('API démarrée') && !api.out.includes('compte administrateur créé'));
    await stopApi(api);

    // --- Base vide, sans ADMIN_PASSWORD : mot de passe provisoire affiché ---
    await mongo.stop({ doCleanup: true, force: true });
    const mongo2 = await MongoMemoryServer.create();
    api = await startApi(mongo2.getUri('veille'), { ADMIN_EMAIL: 'admin@exemple.ci', ADMIN_PASSWORD: undefined });
    const generated = /Mot de passe provisoire : ([A-Za-z0-9_-]+)/.exec(api.out)?.[1];
    console.log('    (capturé : ' + JSON.stringify(generated) + ')');
    check('mot de passe provisoire affiché', !!generated);
    check('login avec le mot de passe provisoire', (await call('POST', '/auth/login', { email: 'admin@exemple.ci', password: generated })).status === 200);
    await stopApi(api);
    api = undefined;
    await mongo2.stop();

    // --- ADMIN_EMAIL absent : démarrage refusé ---
    const noAdmin = await startApi(uri, { ADMIN_EMAIL: undefined, ADMIN_PASSWORD: undefined });
    await new Promise((r) => setTimeout(r, 1500));
    check('ADMIN_EMAIL absent -> message clair', noAdmin.out.includes('ADMIN_EMAIL est obligatoire'));
    noAdmin.proc.kill();

    // --- Configuration SMTP incomplète ou absente en production : démarrage refusé ---
    const partial = await startApi(uri, { ADMIN_EMAIL: 'admin@exemple.ci', SMTP_HOST: 'smtp-relay.brevo.com' });
    await new Promise((r) => setTimeout(r, 1500));
    check('SMTP incomplet -> message clair', partial.out.includes('il manque SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM'));
    partial.proc.kill();
    const prod = await startApi(uri, { ADMIN_EMAIL: 'admin@exemple.ci', NODE_ENV: 'production' });
    await new Promise((r) => setTimeout(r, 1500));
    check('production sans SMTP -> refusé', prod.out.includes('Envoi des e-mails : il manque'));
    prod.proc.kill();
    const badUrl = await startApi(uri, { ADMIN_EMAIL: 'admin@exemple.ci', APP_URL: 'localhost:3000' });
    await new Promise((r) => setTimeout(r, 1500));
    check('APP_URL invalide -> message clair', badUrl.out.includes('APP_URL doit être'));
    badUrl.proc.kill();
  } finally {
    if (api) await stopApi(api);
    await mongo.stop().catch(() => {});
  }
  console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} échec(s)`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
