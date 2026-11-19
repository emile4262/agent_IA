import { GoogleGenAI, Type } from '@google/genai';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { TOPICS, type Topic } from '../sources/topics';

// Repris de legacy/AI.ts.

export interface ArticleToSummarize {
  url: string;
  title: string;
  snippet: string;
  /** Mots-clés dont la recherche a trouvé l'article : il est alors noté par rapport à eux. */
  keywords: string[];
}

export interface Summary {
  titleFr: string;
  topic: Topic;
  summary: string;
  score: number;
}

/** Erreur après laquelle il est inutile de continuer la collecte (clé refusée, quota épuisé…). */
export class SummarizerUnavailableError extends Error {}

const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUSES = new Set([429, 500, 503, 504]);
const BLOCKING_STATUSES = new Set([401, 403, 404, 429]);

@Injectable()
export class SummarizerService {
  private readonly logger = new Logger(SummarizerService.name);
  private readonly client: GoogleGenAI | null;
  private readonly model: string | null;

  constructor(config: ConfigService<Env, true>) {
    const gemini = config.get('gemini', { infer: true });
    this.model = gemini?.model ?? null;
    this.client = gemini
      ? new GoogleGenAI({
          apiKey: gemini.apiKey,
          httpOptions: {
            timeout: 45_000,
            retryOptions: { attempts: 1 },
            ...(gemini.baseUrl ? { baseUrl: gemini.baseUrl } : {}),
          },
        })
      : null;
  }

  /** false si GEMINI_API_KEY est absent : les articles restent alors en attente. */
  get enabled(): boolean {
    return this.client !== null;
  }

  /**
   * Résume un petit lot d'articles. Renvoie les résumés trouvés, par URL :
   * un article oublié par l'IA est simplement absent de la réponse.
   */
  async summarize(articles: ArticleToSummarize[]): Promise<Map<string, Summary>> {
    if (!this.client || !this.model) {
      throw new SummarizerUnavailableError('GEMINI_API_KEY n’est pas configuré.');
    }
    const expected = new Set(articles.map((article) => article.url));
    const contents = `Tu es un rédacteur francophone qui prépare une veille d'actualité, spécialisé en Backend, DevOps et IA.
Résume chacun des ${articles.length} articles fournis. N'en omets aucun et n'en ajoute aucun.
Pour chaque article :
- Écris un résumé fidèle en français naturel de 2 ou 3 phrases complètes.
- Décris les faits présents dans le titre et l'extrait. N'invente aucun détail absent.
- Si l'extrait manque de détails, indique-le clairement dans le résumé au lieu d'inventer.
- Traduis le titre en français et recopie exactement l'URL source.
- Donne une note de pertinence de 1 à 10 :
  - si l'article a un champ "sujets", il a été trouvé en cherchant ces sujets : note son lien direct avec eux
    et la qualité de l'information, quel que soit le domaine (politique, économie, sport…) ;
  - sinon, note sa pertinence technique pour un développeur Backend, DevOps ou IA.
- Pour la catégorie, choisis la plus proche ; un article sans rapport avec la technique va dans Tech.
- Retourne exactement un objet par URL fournie.
Retourne uniquement les données au format demandé.

Articles RSS :
${JSON.stringify(
      articles.map(({ url, title, snippet, keywords }) => ({
        title,
        link: url,
        snippet: snippet.slice(0, 700),
        ...(keywords.length > 0 ? { sujets: keywords } : {}),
      })),
    )}`;

    const text = await this.generate(contents);
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error('La réponse de l’IA n’est pas une liste d’articles.');
    }

    const summaries = new Map<string, Summary>();
    for (const item of parsed as Record<string, unknown>[]) {
      const summary = SummarizerService.toSummary(item);
      if (summary && typeof item.url === 'string' && expected.has(item.url)) {
        summaries.set(item.url, summary);
      }
    }
    return summaries;
  }

  private async generate(contents: string): Promise<string> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await this.client!.models.generateContent({
          model: this.model!,
          contents,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title_fr: { type: Type.STRING, description: 'Titre de l’article, traduit en français' },
                  category: { type: Type.STRING, enum: [...TOPICS] },
                  summary: { type: Type.STRING, description: 'Résumé fidèle du contenu en français, en 2 ou 3 phrases complètes' },
                  relevance_score: { type: Type.NUMBER, description: 'Score de pertinence de 1 à 10' },
                  url: { type: Type.STRING, description: 'URL exacte de l’article source' },
                },
                required: ['title_fr', 'category', 'summary', 'relevance_score', 'url'],
              },
            },
          },
        });
        if (!response.text) {
          throw new Error('Aucune réponse reçue de l’IA.');
        }
        return response.text;
      } catch (error) {
        const status = SummarizerService.statusOf(error);
        const isAbort = error instanceof Error && error.name === 'AbortError';
        const retryable = isAbort || (status !== undefined && RETRYABLE_STATUSES.has(status));
        if (!retryable || attempt === MAX_ATTEMPTS) {
          if (status !== undefined && BLOCKING_STATUSES.has(status)) {
            throw new SummarizerUnavailableError(`Gemini indisponible (HTTP ${status}).`);
          }
          throw error;
        }
        const delay = 2000 * attempt;
        this.logger.warn(`Gemini n'a pas répondu correctement${status ? ` (${status})` : ''} ; nouvel essai dans ${delay / 1000} s.`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /** Vérifie un objet renvoyé par l'IA ; null s'il est inutilisable. */
  private static toSummary(item: Record<string, unknown>): Summary | null {
    const { title_fr: titleFr, category, summary, relevance_score: score } = item;
    if (typeof titleFr !== 'string' || !titleFr.trim() || typeof summary !== 'string' || !summary.trim()) {
      return null;
    }
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      return null;
    }
    return {
      titleFr: titleFr.trim(),
      topic: TOPICS.includes(category as Topic) ? (category as Topic) : 'Tech',
      summary: summary.trim(),
      score: Math.min(10, Math.max(1, Math.round(score))),
    };
  }

  private static statusOf(error: unknown): number | undefined {
    if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
      return error.status;
    }
    return undefined;
  }
}
