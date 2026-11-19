import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanSnippet, httpUrl } from '../../src/collector/feed-reader';
import { googleNewsSearchUrl } from '../../src/collector/google-news';
import { isValidUnsubscribe, unsubscribeLink } from '../../src/digest/unsubscribe';
import { digestEmail, escapeHtml, welcomeEmail } from '../../src/mail/mail.templates';
import { normalizeKeyword } from '../../src/preferences/keywords';

describe('httpUrl', () => {
  it('garde les liens http(s) tels quels', () => {
    assert.equal(httpUrl(' https://exemple.ci/article?id=1 '), 'https://exemple.ci/article?id=1');
    assert.equal(httpUrl('http://exemple.ci'), 'http://exemple.ci');
  });

  it('refuse les autres protocoles et les liens illisibles', () => {
    assert.equal(httpUrl('javascript:alert(1)'), null);
    assert.equal(httpUrl('JavaScript:alert(1)'), null);
    assert.equal(httpUrl('data:text/html,<script>alert(1)</script>'), null);
    assert.equal(httpUrl('/article/relatif'), null);
    assert.equal(httpUrl(''), null);
  });
});

describe('cleanSnippet', () => {
  it('retire le HTML, les scripts et décode les entités', () => {
    assert.equal(cleanSnippet('<p>Node&nbsp;22 &amp; <b>TypeScript</b></p><script>alert(1)</script>'), 'Node 22 & TypeScript');
    assert.equal(cleanSnippet('L&#39;IA &#x2014; &quot;générative&quot;'), 'L\'IA — "générative"');
  });
});

describe('normalizeKeyword', () => {
  it('rend équivalentes les variantes d’un même mot-clé', () => {
    assert.equal(normalizeKeyword('  Mobile   Money '), 'mobile money');
    // « é » composé (NFD) et précomposé (NFC) donnent le même mot-clé.
    assert.equal(normalizeKeyword('Sécurité'), normalizeKeyword('Sécurité'));
  });
});

describe('googleNewsSearchUrl', () => {
  it('encode le mot-clé et cible l’édition Côte d’Ivoire', () => {
    const url = new URL(googleNewsSearchUrl('https://news.google.com', 'mobile money & co'));
    assert.equal(url.pathname, '/rss/search');
    assert.equal(url.searchParams.get('q'), 'mobile money & co when:2d');
    assert.equal(url.searchParams.get('gl'), 'CI');
    assert.equal(url.searchParams.get('hl'), 'fr');
  });
});

describe('digestEmail', () => {
  const LINK = 'https://veille.ci/unsubscribe?u=0123456789abcdef01234567&t=signature';
  const article = {
    title: '<img src=x onerror=alert(1)>',
    url: 'https://exemple.ci/a?x=1&y="2"',
    topic: 'Tech',
    keyword: 'politique',
    score: 8,
    summary: 'Résumé <b>gras</b>',
  };

  it('échappe tout le contenu venu des flux dans la version HTML', () => {
    const { html } = digestEmail('a@b.ci', '<Emile>', '2026-11-19', [article], LINK);
    assert.ok(!html.includes('<img'));
    assert.ok(!html.includes('<Emile>'));
    assert.ok(!html.includes('<b>gras</b>'));
    assert.ok(html.includes('href="https://exemple.ci/a?x=1&amp;y=&quot;2&quot;"'));
  });

  it('affiche le mot-clé, sinon la catégorie, et la date française', () => {
    const { subject, text } = digestEmail('a@b.ci', 'Emile', '2026-11-19', [article, { ...article, keyword: null }], LINK);
    assert.equal(subject, 'Votre veille du 19/11/2026 — 2 articles');
    assert.ok(text.includes('[politique · 8/10]'));
    assert.ok(text.includes('[Tech · 8/10]'));
  });

  it('lien de désinscription dans le texte, le HTML et les en-têtes en un clic', () => {
    const { text, html, headers } = digestEmail('a@b.ci', 'Emile', '2026-11-19', [article], LINK);
    assert.ok(text.includes(LINK));
    assert.ok(html.includes(`href="${LINK.replace('&', '&amp;')}"`));
    assert.equal(headers?.['List-Unsubscribe'], `<${LINK}>`);
    assert.equal(headers?.['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  });

  it('escapeHtml couvre les 5 caractères dangereux', () => {
    assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('welcomeEmail', () => {
  const preferences = { topics: ['Backend', 'IA'], sendTime: '08:00', frequency: 'weekdays' };

  it('avec un lien : bienvenue et confirmation dans le même e-mail', () => {
    const { subject, text, html } = welcomeEmail('a@b.ci', '<Awa>', preferences, 'https://veille.ci/auth/verify-email?token=abc');
    assert.ok(subject.startsWith('Bienvenue'));
    assert.ok(text.includes('Confirmez votre adresse e-mail') && text.includes('https://veille.ci/auth/verify-email?token=abc'));
    assert.ok(text.includes('du lundi au vendredi à 08:00') && text.includes('Backend, IA'));
    assert.ok(!html.includes('<Awa>'));
  });

  it('sans lien (invitation) : pas de demande de confirmation', () => {
    const { text, html } = welcomeEmail('a@b.ci', 'Awa', preferences, null);
    assert.ok(!text.includes('Confirmez') && !html.includes('verify-email'));
  });
});

describe('lien de désinscription', () => {
  const secret = 'x'.repeat(48);
  const userId = '0123456789abcdef01234567';
  const params = (link: string) => new URL(link).searchParams;

  it('accepte le lien signé', () => {
    const link = params(unsubscribeLink('https://veille.ci', userId, secret));
    assert.equal(link.get('u'), userId);
    assert.ok(isValidUnsubscribe(link.get('u'), link.get('t'), secret));
  });

  it('refuse un autre compte, une signature modifiée ou un autre secret', () => {
    const signature = params(unsubscribeLink('https://veille.ci', userId, secret)).get('t');
    assert.ok(!isValidUnsubscribe('0123456789abcdef01234568', signature, secret));
    assert.ok(!isValidUnsubscribe(userId, `${signature}x`, secret));
    assert.ok(!isValidUnsubscribe(userId, signature, 'y'.repeat(48)));
    assert.ok(!isValidUnsubscribe(userId, undefined, secret));
    assert.ok(!isValidUnsubscribe(['a'], signature, secret));
  });
});
