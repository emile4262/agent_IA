import Parser from 'rss-parser';

// Repris de legacy/scraper.ts.

const parser = new Parser();
const FETCH_TIMEOUT_MS = 10_000;
/** Les articles plus anciens ne sont pas collectés. */
export const MAX_ARTICLE_AGE_MS = 48 * 60 * 60 * 1000;

export interface FeedItem {
  url: string;
  title: string;
  snippet: string;
  publishedAt: Date | null;
}

/** Lit un flux RSS et renvoie ses articles récents. Lève une erreur si le flux est injoignable ou illisible. */
export async function readFeed(feedUrl: string, now = Date.now()): Promise<FeedItem[]> {
  const response = await fetch(feedUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Le flux a répondu avec le statut HTTP ${response.status}.`);
  }
  const feed = await parser.parseString(await response.text());
  const cutoff = now - MAX_ARTICLE_AGE_MS;

  return (feed.items ?? []).flatMap((item) => {
    if (!item.title || !item.link || !cleanSnippet(item.title)) {
      return [];
    }
    const publishedAt = item.isoDate ?? item.pubDate;
    const publishedTime = publishedAt ? Date.parse(publishedAt) : Number.NaN;
    if (Number.isFinite(publishedTime) && (publishedTime < cutoff || publishedTime > now)) {
      return [];
    }
    return [
      {
        url: item.link.trim(),
        title: cleanSnippet(item.title).slice(0, 300),
        snippet: cleanSnippet(item.contentSnippet ?? item.content ?? ''),
        publishedAt: Number.isFinite(publishedTime) ? new Date(publishedTime) : null,
      },
    ];
  });
}

/** Retire le HTML et décode les entités courantes d'un titre ou d'un extrait. */
export function cleanSnippet(value: string): string {
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
