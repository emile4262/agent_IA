/** Articles gardés par recherche, les plus récents : limite le coût des résumés. */
export const ARTICLES_PER_KEYWORD = 10;
/** Plafond de recherches par collecte ; les mots-clés les plus suivis passent en premier. */
export const MAX_KEYWORD_SEARCHES = 100;

/**
 * Flux RSS de recherche Google News pour un mot-clé : l'actualité des 2 derniers jours,
 * en français, édition Côte d'Ivoire. Gratuit et sans clé.
 */
export function googleNewsSearchUrl(baseUrl: string, keyword: string): string {
  const query = encodeURIComponent(`${keyword} when:2d`);
  return `${baseUrl}/rss/search?q=${query}&hl=fr&gl=CI&ceid=CI:fr`;
}
