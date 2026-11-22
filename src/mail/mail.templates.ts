import type { MailMessage } from './mail.service';

const BRAND = 'Veille technologique';
const COLORS = { brand: '#1f3a5f', accent: '#2563eb', text: '#1f2937', muted: '#6b7280', border: '#e5e7eb', background: '#f3f4f6' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

interface LayoutOptions {
  /** Titre de l'onglet, et de la page quand le gabarit sert de page web. */
  title: string;
  /** Aperçu affiché par les messageries à côté de l'objet. */
  preheader?: string;
  /** Contenu, déjà en HTML échappé. */
  body: string;
  /** Mentions en bas de page, déjà en HTML échappé. */
  footer?: string;
}

/**
 * Gabarit commun des e-mails et des pages de désinscription : tableaux et styles en ligne,
 * seule mise en page que toutes les messageries (Gmail, Outlook…) affichent correctement.
 */
export function layout({ title, preheader = '', body, footer = '' }: LayoutOptions): string {
  return (
    '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${escapeHtml(title)}</title></head>` +
    `<body style="margin:0;padding:0;background:${COLORS.background};font-family:${FONT};color:${COLORS.text}">` +
    `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.background}"><tr><td align="center" style="padding:24px 12px">` +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">' +
    `<tr><td style="background:${COLORS.brand};padding:18px 24px;border-radius:8px 8px 0 0;color:#ffffff;font-size:18px;font-weight:bold">${BRAND}</td></tr>` +
    `<tr><td style="background:#ffffff;padding:24px;border-radius:0 0 8px 8px;font-size:15px;line-height:1.6">${body}</td></tr>` +
    (footer ? `<tr><td style="padding:16px 24px;color:${COLORS.muted};font-size:12px;line-height:1.5;text-align:center">${footer}</td></tr>` : '') +
    '</table></td></tr></table></body></html>'
  );
}

const BUTTON_STYLE = `display:inline-block;padding:12px 22px;background:${COLORS.accent};border:0;border-radius:6px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px`;

export function button(href: string, label: string): string {
  return `<p style="margin:20px 0"><a href="${escapeHtml(href)}" style="${BUTTON_STYLE}">${escapeHtml(label)}</a></p>`;
}

/** Bouton d'un formulaire, pour les pages web (les e-mails n'utilisent que des liens). */
export function submitButton(label: string): string {
  return `<p style="margin:20px 0"><button type="submit" style="${BUTTON_STYLE};cursor:pointer;font-family:inherit">${escapeHtml(label)}</button></p>`;
}

function code(value: string): string {
  return (
    `<p style="margin:16px 0;padding:12px 16px;background:${COLORS.background};border:1px solid ${COLORS.border};border-radius:6px;` +
    `font-family:Consolas,Menlo,monospace;font-size:14px;word-break:break-all">${escapeHtml(value)}</p>`
  );
}

function note(text: string): string {
  return `<p style="color:${COLORS.muted};font-size:13px">${escapeHtml(text)}</p>`;
}

const FREQUENCY_LABELS: Record<string, string> = {
  daily: 'chaque jour',
  weekdays: 'du lundi au vendredi',
  weekly: 'chaque lundi',
};

export interface WelcomePreferences {
  topics: string[];
  sendTime: string;
  frequency: string;
}

/**
 * Envoyé à l'inscription. Avec un lien de confirmation (inscription libre ou par lien partagé),
 * sans lien quand l'adresse est déjà confirmée (invitation reçue par e-mail).
 */
export function welcomeEmail(to: string, firstName: string, preferences: WelcomePreferences, confirmLink: string | null): MailMessage {
  const schedule = `${FREQUENCY_LABELS[preferences.frequency] ?? 'chaque jour'} à ${preferences.sendTime}`;
  const topics = preferences.topics.length > 0 ? preferences.topics.join(', ') : 'aucun sujet choisi pour le moment';
  const confirmText = confirmLink
    ? `Confirmez votre adresse e-mail pour commencer à recevoir la veille (lien valable 24 heures) :\n${confirmLink}\n\n`
    : '';
  return {
    to,
    subject: confirmLink ? `Bienvenue sur la ${BRAND.toLowerCase()} — confirmez votre adresse` : `Bienvenue sur la ${BRAND.toLowerCase()}`,
    text:
      `Bonjour ${firstName},\n\nBienvenue sur la plateforme de veille technologique.\n\n` +
      confirmText +
      `Vous recevrez ${schedule} une sélection d’articles résumés sur vos sujets : ${topics}.\n` +
      'Vous pouvez changer vos sujets, vos sources, vos mots-clés et l’heure d’envoi dans vos préférences.\n\n' +
      (confirmLink ? 'Si vous n’avez pas créé de compte, ignorez ce message.' : ''),
    html: layout({
      title: 'Bienvenue',
      preheader: confirmLink ? 'Confirmez votre adresse pour recevoir votre première veille.' : 'Votre compte est prêt.',
      body:
        `<h1 style="margin:0 0 12px;font-size:22px">Bienvenue, ${escapeHtml(firstName)}&nbsp;!</h1>` +
        '<p>Votre compte sur la plateforme de veille technologique est créé.</p>' +
        (confirmLink
          ? '<p>Confirmez votre adresse e-mail pour commencer à recevoir la veille :</p>' +
            button(confirmLink, 'Confirmer mon adresse e-mail') +
            note('Ce lien est valable 24 heures.')
          : '') +
        `<p>Vous recevrez <strong>${escapeHtml(schedule)}</strong> une sélection d’articles résumés sur vos sujets : ` +
        `<strong>${escapeHtml(topics)}</strong>.</p>` +
        '<p>Vous pouvez changer vos sujets, vos sources, vos mots-clés et l’heure d’envoi dans vos préférences.</p>',
      footer: confirmLink ? 'Si vous n’avez pas créé de compte, ignorez ce message.' : '',
    }),
  };
}

/** Nouveau lien de confirmation, demandé par la personne connectée. */
export function verificationEmail(to: string, firstName: string, link: string): MailMessage {
  return {
    to,
    subject: 'Confirmez votre adresse e-mail',
    text:
      `Bonjour ${firstName},\n\n` +
      `Pour confirmer votre adresse e-mail, ouvrez ce lien (valable 24 heures) :\n${link}\n\n` +
      'Si vous n’avez pas créé de compte, ignorez ce message.',
    html: layout({
      title: 'Confirmez votre adresse e-mail',
      preheader: 'Un clic pour confirmer votre adresse.',
      body:
        `<p>Bonjour ${escapeHtml(firstName)},</p>` +
        '<p>Pour confirmer votre adresse e-mail, cliquez sur le bouton ci-dessous :</p>' +
        button(link, 'Confirmer mon adresse e-mail') +
        note('Ce lien est valable 24 heures.'),
      footer: 'Si vous n’avez pas créé de compte, ignorez ce message.',
    }),
  };
}

/** Le lien ouvre le formulaire d'inscription de l'interface web ; sans interface, le code sert avec POST /auth/register. */
export function invitationEmail(to: string, inviterName: string, token: string, link: string | null): MailMessage {
  return {
    to,
    subject: 'Invitation à rejoindre la veille technologique',
    text:
      'Bonjour,\n\n' +
      `${inviterName} vous invite à rejoindre la plateforme de veille technologique.\n\n` +
      (link ? `Pour créer votre compte avec cette adresse (${to}), ouvrez ce lien (valable 7 jours) :\n${link}\n\n` : '') +
      `Votre code d’invitation (valable 7 jours) :\n${token}\n\n` +
      `Inscrivez-vous avec cette adresse (${to}) en envoyant ce code dans le champ invitationToken de POST /auth/register.\n\n` +
      'Si vous ne vous attendiez pas à cette invitation, ignorez ce message.',
    html: layout({
      title: 'Invitation',
      preheader: `${inviterName} vous invite à rejoindre la veille technologique.`,
      body:
        '<p>Bonjour,</p>' +
        `<p><strong>${escapeHtml(inviterName)}</strong> vous invite à rejoindre la plateforme de veille technologique : ` +
        'chaque jour, une sélection d’articles résumés sur les sujets qui vous intéressent.</p>' +
        (link
          ? `<p>Créez votre compte avec cette adresse (${escapeHtml(to)}) :</p>` +
            button(link, 'Créer mon compte') +
            note('Ce lien est valable 7 jours et ne sert qu’une fois.') +
            note('Votre code d’invitation, si le bouton ne fonctionne pas :') +
            code(token)
          : '<p>Votre code d’invitation, valable 7 jours :</p>' +
            code(token) +
            `<p>Inscrivez-vous avec cette adresse (${escapeHtml(to)}) en envoyant ce code dans le champ ` +
            '<code>invitationToken</code> de <code>POST /auth/register</code>.</p>'),
      footer: 'Si vous ne vous attendiez pas à cette invitation, ignorez ce message.',
    }),
  };
}

/** Le lien ouvre la page du nouveau mot de passe ; le code sert aussi directement avec POST /auth/reset-password. */
export function passwordResetEmail(to: string, firstName: string, token: string, link: string): MailMessage {
  return {
    to,
    subject: 'Réinitialisation de votre mot de passe',
    text:
      `Bonjour ${firstName},\n\n` +
      `Voici votre code de réinitialisation (valable 1 heure) :\n${token}\n\n` +
      `Pour choisir un nouveau mot de passe, ouvrez ce lien :\n${link}\n\n` +
      'Vous pouvez aussi envoyer le code avec votre nouveau mot de passe à POST /auth/reset-password.\n\n' +
      'Si vous n’avez rien demandé, ignorez ce message : votre mot de passe reste inchangé.',
    html: layout({
      title: 'Réinitialisation du mot de passe',
      preheader: 'Choisissez un nouveau mot de passe (lien valable 1 heure).',
      body:
        `<p>Bonjour ${escapeHtml(firstName)},</p>` +
        '<p>Pour choisir un nouveau mot de passe, cliquez sur le bouton ci-dessous :</p>' +
        button(link, 'Choisir un nouveau mot de passe') +
        note('Ce lien est valable 1 heure et ne sert qu’une fois.') +
        note('Vous pouvez aussi envoyer ce code avec votre nouveau mot de passe à POST /auth/reset-password :') +
        code(token),
      footer: 'Si vous n’avez rien demandé, ignorez ce message : votre mot de passe reste inchangé.',
    }),
  };
}

export interface DigestEmailArticle {
  title: string;
  url: string;
  topic: string;
  /** Affiché à la place du sujet quand l'article vient d'un mot-clé. */
  keyword: string | null;
  score: number;
  summary: string;
}

/** « 2026-11-19 » → « mercredi 19 novembre 2026 ». */
function longDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

function articleCard(article: DigestEmailArticle): string {
  const label = article.keyword ? `Mot-clé : ${article.keyword}` : article.topic;
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border:1px solid ${COLORS.border};border-radius:8px">` +
    '<tr><td style="padding:16px">' +
    `<p style="margin:0 0 8px;font-size:12px"><span style="background:#e0e7ff;color:${COLORS.brand};padding:2px 8px;border-radius:10px">${escapeHtml(label)}</span>` +
    `<span style="color:${COLORS.muted}">&nbsp;·&nbsp;pertinence ${article.score}/10</span></p>` +
    `<p style="margin:0 0 8px;font-size:17px;font-weight:bold;line-height:1.4"><a href="${escapeHtml(article.url)}" style="color:${COLORS.text};text-decoration:none">${escapeHtml(article.title)}</a></p>` +
    `<p style="margin:0 0 10px">${escapeHtml(article.summary)}</p>` +
    `<a href="${escapeHtml(article.url)}" style="color:${COLORS.accent};font-weight:bold;text-decoration:none">Lire l’article →</a>` +
    '</td></tr></table>'
  );
}

/**
 * Veille du jour, avec le lien de désinscription en bas de l'e-mail et dans les en-têtes
 * List-Unsubscribe (bouton « Se désabonner » de Gmail et Outlook, en un clic).
 */
export function digestEmail(to: string, firstName: string, date: string, articles: DigestEmailArticle[], unsubscribeLink: string): MailMessage {
  const [year, month, day] = date.split('-');
  const label = `${day}/${month}/${year}`;
  const count = `${articles.length} article${articles.length > 1 ? 's' : ''}`;
  return {
    to,
    subject: `Votre veille du ${label} — ${count}`,
    headers: {
      'List-Unsubscribe': `<${unsubscribeLink}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    text:
      `Bonjour ${firstName},\n\nVoici votre veille du ${label}.\n\n` +
      articles
        .map((article, index) => `${index + 1}. [${article.keyword ?? article.topic} · ${article.score}/10] ${article.title}\n${article.summary}\n${article.url}`)
        .join('\n\n') +
      '\n\nVous pouvez modifier vos sujets, vos sources et l’heure d’envoi dans vos préférences.\n' +
      `Ne plus recevoir la veille : ${unsubscribeLink}`,
    html: layout({
      title: `Votre veille du ${label}`,
      preheader: `${count} sélectionné${articles.length > 1 ? 's' : ''} pour vous : ${articles[0]?.title ?? ''}`,
      body:
        `<p style="margin:0 0 4px;color:${COLORS.muted};font-size:13px;text-transform:capitalize">${escapeHtml(longDate(date))}</p>` +
        `<h1 style="margin:0 0 12px;font-size:22px">Bonjour ${escapeHtml(firstName)},</h1>` +
        `<p style="margin:0 0 20px">${articles.length > 1 ? `Voici les ${count} les plus pertinents pour vous.` : 'Voici l’article le plus pertinent pour vous.'}</p>` +
        articles.map(articleCard).join(''),
      footer:
        'Vous recevez cet e-mail car vous êtes inscrit à la veille technologique.<br>' +
        'Vous pouvez modifier vos sujets, vos sources et l’heure d’envoi dans vos préférences.<br>' +
        `<a href="${escapeHtml(unsubscribeLink)}" style="color:${COLORS.muted}">Ne plus recevoir la veille</a>`,
    }),
  };
}
