import 'dotenv/config';
import nodemailer from 'nodemailer';
import type { ArticleInput, CuratedArticle } from './AI';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`La variable ${name} doit être configurée dans le fichier .env.`);
  }
  return value;
}

function escapeHtml(value: string): string {
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

function sourceLink(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return `<a href="${escapeHtml(url.toString())}">Consulter la source</a>`;
    }
  } catch {
    // Display malformed or unsupported URLs as plain text.
  }
  return escapeHtml(value);
}

export async function sendDailyReport(
  scraped: ArticleInput[],
  curated: CuratedArticle[],
  curationNotice?: string,
): Promise<void> {
  const host = requiredEnv('SMTP_HOST');
  const port = Number(requiredEnv('SMTP_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT doit être un numéro de port valide.');
  }

  const user = requiredEnv('SMTP_USER');
  const password = requiredEnv('SMTP_PASSWORD');
  const from = requiredEnv('MAIL_FROM');
  const to = requiredEnv('MAIL_TO');
  const date = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeZone: 'Africa/Abidjan',
  }).format(new Date());

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass: password },
  });

  const curatedText = curated
    .map(
      (article) =>
        `- ${article.title_fr} [${article.category}] (pertinence ${article.relevance_score}/10)\n  ${article.summary}\n  Source : ${article.url}`,
    )
    .join('\n\n');
  const curationContentText = curationNotice
    ? `${curationNotice}\n\nTitres collectés :\n${scraped.map((article) => `- ${article.title}`).join('\n')}`
    : curatedText;
  const curatedHtml = curated
    .map((article) => {
      return `<li><strong>${escapeHtml(article.title_fr)}</strong> — ${escapeHtml(article.category)} · pertinence ${article.relevance_score}/10<p>${escapeHtml(article.summary)}</p><p>Source : ${sourceLink(article.url)}</p></li>`;
    })
    .join('');
  const curationContentHtml = curationNotice
    ? `<p>${escapeHtml(curationNotice)}</p><ul>${scraped.map((article) => `<li>${escapeHtml(article.title)}</li>`).join('')}</ul>`
    : `<ul>${curatedHtml}</ul>`;

  try {
    await transport.sendMail({
      from,
      to,
      subject: `Veille technologique du ${date} — ${curated.length}/${scraped.length} résumés`,
      text: `Résumés (${curated.length}/${scraped.length})\n\n${curationContentText}`,
      html: `<h1>Veille technologique du ${escapeHtml(date)}</h1><h2>Résumés (${curated.length}/${scraped.length})</h2>${curationContentHtml}`,
    });
  } finally {
    transport.close();
  }
}
