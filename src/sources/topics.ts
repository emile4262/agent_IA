/** Sujets de veille ; ce sont aussi les catégories attribuées par l'IA à chaque article. */
export const TOPICS = ['Backend', 'DevOps', 'IA', 'Tech'] as const;
export type Topic = (typeof TOPICS)[number];
