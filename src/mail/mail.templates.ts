import type { MailMessage } from './mail.service';

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

export function verificationEmail(to: string, firstName: string, link: string): MailMessage {
  return {
    to,
    subject: 'Confirmez votre adresse e-mail',
    text:
      `Bonjour ${firstName},\n\n` +
      `Pour confirmer votre adresse e-mail, ouvrez ce lien (valable 24 heures) :\n${link}\n\n` +
      'Si vous n’avez pas créé de compte, ignorez ce message.',
    html:
      `<p>Bonjour ${escapeHtml(firstName)},</p>` +
      `<p>Pour confirmer votre adresse e-mail, cliquez sur ce lien (valable 24 heures) :</p>` +
      `<p><a href="${escapeHtml(link)}">Confirmer mon adresse e-mail</a></p>` +
      '<p>Si vous n’avez pas créé de compte, ignorez ce message.</p>',
  };
}

/** Pas encore d'interface web : la personne envoie le code à POST /auth/register. */
export function invitationEmail(to: string, inviterName: string, token: string): MailMessage {
  return {
    to,
    subject: 'Invitation à rejoindre la veille technologique',
    text:
      'Bonjour,\n\n' +
      `${inviterName} vous invite à rejoindre la plateforme de veille technologique.\n\n` +
      `Votre code d’invitation (valable 7 jours) :\n${token}\n\n` +
      `Inscrivez-vous avec cette adresse (${to}) en envoyant ce code dans le champ invitationToken de POST /auth/register.\n\n` +
      'Si vous ne vous attendiez pas à cette invitation, ignorez ce message.',
    html:
      '<p>Bonjour,</p>' +
      `<p>${escapeHtml(inviterName)} vous invite à rejoindre la plateforme de veille technologique.</p>` +
      '<p>Votre code d’invitation (valable 7 jours) :</p>' +
      `<p><code>${escapeHtml(token)}</code></p>` +
      `<p>Inscrivez-vous avec cette adresse (${escapeHtml(to)}) en envoyant ce code dans le champ <code>invitationToken</code> de <code>POST /auth/register</code>.</p>` +
      '<p>Si vous ne vous attendiez pas à cette invitation, ignorez ce message.</p>',
  };
}

/** Pas encore d'interface web : la personne colle le code dans POST /auth/reset-password. */
export function passwordResetEmail(to: string, firstName: string, token: string): MailMessage {
  return {
    to,
    subject: 'Réinitialisation de votre mot de passe',
    text:
      `Bonjour ${firstName},\n\n` +
      `Voici votre code de réinitialisation (valable 1 heure) :\n${token}\n\n` +
      'Envoyez-le avec votre nouveau mot de passe à POST /auth/reset-password.\n\n' +
      'Si vous n’avez rien demandé, ignorez ce message : votre mot de passe reste inchangé.',
    html:
      `<p>Bonjour ${escapeHtml(firstName)},</p>` +
      `<p>Voici votre code de réinitialisation (valable 1 heure) :</p>` +
      `<p><code>${escapeHtml(token)}</code></p>` +
      '<p>Envoyez-le avec votre nouveau mot de passe à <code>POST /auth/reset-password</code>.</p>' +
      '<p>Si vous n’avez rien demandé, ignorez ce message : votre mot de passe reste inchangé.</p>',
  };
}

export interface DigestEmailArticle {
  title: string;
  url: string;
  topic: string;
  score: number;
  summary: string;
}

/** Veille du jour. Version simple : la mise en page soignée et le lien de désinscription arrivent en phase 5. */
export function digestEmail(to: string, firstName: string, date: string, articles: DigestEmailArticle[]): MailMessage {
  const [year, month, day] = date.split('-');
  const label = `${day}/${month}/${year}`;
  return {
    to,
    subject: `Votre veille tech du ${label} — ${articles.length} article${articles.length > 1 ? 's' : ''}`,
    text:
      `Bonjour ${firstName},\n\nVoici votre veille du ${label}.\n\n` +
      articles
        .map((article, index) => `${index + 1}. [${article.topic} · ${article.score}/10] ${article.title}\n${article.summary}\n${article.url}`)
        .join('\n\n') +
      '\n\nVous pouvez modifier vos sujets, vos sources et l’heure d’envoi dans vos préférences.',
    html:
      `<p>Bonjour ${escapeHtml(firstName)},</p><p>Voici votre veille du ${label}.</p>` +
      articles
        .map(
          (article) =>
            `<h3 style="margin-bottom:4px"><a href="${escapeHtml(article.url)}">${escapeHtml(article.title)}</a></h3>` +
            `<p style="margin:0;color:#666;font-size:13px">${escapeHtml(article.topic)} · pertinence ${article.score}/10</p>` +
            `<p style="margin-top:6px">${escapeHtml(article.summary)}</p>`,
        )
        .join('') +
      '<p style="color:#666;font-size:13px">Vous pouvez modifier vos sujets, vos sources et l’heure d’envoi dans vos préférences.</p>',
  };
}
