import Parser from 'rss-parser';
import type { ArticleInput } from './AI';

const parser = new Parser();

const RSS_FEEDS = [
  'https://dev.to/feed/tag/backend',
  'https://dev.to/feed/tag/devops',
  'https://dev.to/feed/tag/ai',
  'https://medium.com/feed/tag/backend',
  'https://medium.com/feed/tag/devops',
  'https://medium.com/feed/tag/artificial-intelligence',
];
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const MAX_ARTICLES = 20;

async function fetchFeed(url: string): Promise<Awaited<ReturnType<typeof parser.parseString>>> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`Le flux RSS a répondu avec le statut HTTP ${response.status}.`);
  }
  return parser.parseString(await response.text());
}

// Fonction pour nettoyer les extraits d'articles
function cleanSnippet(value: string): string {
  const decoded = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hex ?? decimal ?? '0', hex ? 16 : 10);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '�';
    });

  return decoded.replace(/\s+/g, ' ').trim().slice(0, 1200);
}

export async function scrapeArticles(): Promise<ArticleInput[]> {
  const now = Date.now();
  const cutoff = now - MAX_AGE_MS;
  const results = await Promise.allSettled(
    RSS_FEEDS.map(async (url) => {
      const feed = await fetchFeed(url);
      const articles = (feed.items ?? []).flatMap((item) => {
        if (!item.title || !item.link) {
          return [];
        }
        const publishedAt = item.isoDate ?? item.pubDate;
        const publishedTime = publishedAt ? Date.parse(publishedAt) : Number.NaN;
        if (Number.isFinite(publishedTime) && (publishedTime < cutoff || publishedTime > now)) {
          return [];
        }
        const snippet = cleanSnippet(item.contentSnippet ?? item.content ?? '');
        return [{
          title: item.title,
          link: item.link,
          snippet,
          source: new URL(url).hostname,
          ...(Number.isFinite(publishedTime) ? { publishedAt: new Date(publishedTime).toISOString() } : {}),
        }];
      });
      console.log(`${new URL(url).hostname}${new URL(url).pathname} : ${articles.length} article(s) dans la période.`);
      return articles;
    }),
  );

  const articlesBySource = new Map<string, ArticleInput[]>();
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      for (const article of result.value) {
        const source = article.source ?? new URL(article.link).hostname;
        const sourceArticles = articlesBySource.get(source) ?? [];
        sourceArticles.push(article);
        articlesBySource.set(source, sourceArticles);
      }
    } else {
      console.error(`Impossible de lire le flux RSS ${RSS_FEEDS[index]} :`, result.reason);
    }
  }

  const uniqueArticles = [...new Map(
    [...articlesBySource.values()].flat().map((article) => [article.link, article]),
  ).values()];
  if (uniqueArticles.length === 0) {
    throw new Error('Aucun article récent n’a été récupéré depuis les flux RSS.');
  }

  const sortedBySource = new Map<string, ArticleInput[]>();
  for (const source of articlesBySource.keys()) {
    const sourceArticles = uniqueArticles
      .filter((article) => article.source === source)
      .sort((a, b) => {
      if (!a.publishedAt) return b.publishedAt ? 1 : 0;
      if (!b.publishedAt) return -1;
      return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
      });
    sortedBySource.set(source, sourceArticles);
  }

  const balancedArticles: ArticleInput[] = [];
  const sources = [...sortedBySource.keys()];
  while (balancedArticles.length < MAX_ARTICLES) {
    let addedThisRound = false;
    for (const source of sources) {
      const next = sortedBySource.get(source)?.shift();
      if (next) {
        balancedArticles.push(next);
        addedThisRound = true;
        if (balancedArticles.length === MAX_ARTICLES) break;
      }
    }
    if (!addedThisRound) break;
  }

  console.log(
    `Sélection équilibrée : ${[...new Set(balancedArticles.map((article) => article.source))]
      .map((source) => `${source} ${balancedArticles.filter((article) => article.source === source).length}`)
      .join(', ')}.`,
  );
  return balancedArticles;
}
