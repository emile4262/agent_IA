/**
 * Mots-clés libres de la veille (ex. « flutter », « mobile money ») : chacun devient une recherche
 * Google News, faite une seule fois pour tous les utilisateurs qui le suivent.
 */
export const MAX_KEYWORDS = 5;
export const KEYWORD_MIN_LENGTH = 2;
export const KEYWORD_MAX_LENGTH = 50;

/** « Mobile  Money » et « mobile money » désignent le même mot-clé. */
export function normalizeKeyword(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}
