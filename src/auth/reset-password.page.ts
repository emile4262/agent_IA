import { escapeHtml, layout, submitButton } from '../mail/mail.templates';

const INPUT_STYLE =
  'display:block;width:100%;box-sizing:border-box;margin:6px 0 16px;padding:10px 12px;' +
  'border:1px solid #d1d5db;border-radius:6px;font-size:15px;font-family:inherit';

/**
 * Pages web du lien « mot de passe oublié », servies par l'API tant qu'il n'y a pas d'interface web.
 * Pas de JavaScript : un simple formulaire, compatible avec les en-têtes de sécurité (CSP).
 */
export function resetPasswordForm(token: string, error?: string): string {
  return layout({
    title: 'Nouveau mot de passe',
    body:
      '<h1 style="margin:0 0 12px;font-size:22px">Choisir un nouveau mot de passe</h1>' +
      (error ? `<p role="alert" style="padding:10px 12px;background:#fef2f2;color:#b91c1c;border-radius:6px">${escapeHtml(error)}</p>` : '') +
      '<form method="post" action="/auth/reset-password/form">' +
      `<input type="hidden" name="token" value="${escapeHtml(token)}">` +
      '<label for="newPassword">Nouveau mot de passe (8 à 72 caractères)</label>' +
      `<input id="newPassword" name="newPassword" type="password" required minlength="8" maxlength="72" autocomplete="new-password" style="${INPUT_STYLE}">` +
      '<label for="confirmation">Confirmez le mot de passe</label>' +
      `<input id="confirmation" name="confirmation" type="password" required minlength="8" maxlength="72" autocomplete="new-password" style="${INPUT_STYLE}">` +
      submitButton('Enregistrer le mot de passe') +
      '</form>',
  });
}

export const RESET_PASSWORD_DONE = layout({
  title: 'Mot de passe modifié',
  body:
    '<h1 style="margin:0 0 12px;font-size:22px">Mot de passe modifié</h1>' +
    '<p>Vous pouvez vous connecter avec votre nouveau mot de passe. Vos autres sessions ont été fermées.</p>',
});

export const RESET_PASSWORD_INVALID = layout({
  title: 'Lien invalide',
  body:
    '<h1 style="margin:0 0 12px;font-size:22px">Lien invalide ou expiré</h1>' +
    '<p>Ce lien n’est plus valable : il ne sert qu’une fois et expire au bout d’une heure. ' +
    'Refaites une demande de mot de passe oublié.</p>',
});
