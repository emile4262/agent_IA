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
