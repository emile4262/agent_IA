import 'dotenv/config';
import { GoogleGenAI, Type } from '@google/genai';

// Initialisation du client avec ta clé stockée dans le fichier .env
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    timeout: 45_000,
    retryOptions: { attempts: 1 },
  },
});

export interface ArticleInput {
  title: string;
  link: string;
  snippet?: string;
  publishedAt?: string;
  source?: string;
}

export interface CuratedArticle {
  title_fr: string;
  category: 'Backend' | 'DevOps' | 'IA' | 'Tech';
  summary: string;
  relevance_score: number;
  url: string;
}

function getApiStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = error.status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const BATCH_SIZE = 4;

async function summarizeBatch(rawArticles: ArticleInput[]): Promise<CuratedArticle[]> {
  const articlesForCuration = rawArticles.map(({ title, link, snippet, source }) => ({
    title,
    link,
    snippet: snippet?.slice(0, 700),
    source,
  }));
  const contents = `Tu es un rédacteur technique francophone spécialisé en Backend, DevOps et IA.
Résume chacun des ${rawArticles.length} articles fournis. N'en omets aucun et n'en ajoute aucun.
Pour chaque article :
- Écris un résumé fidèle en français naturel de 2 ou 3 phrases complètes.
- Décris les faits présents dans le titre et l'extrait. N'invente aucun détail absent.
- Si l'extrait manque de détails, indique-le clairement dans le résumé au lieu d'inventer.
- Traduis le titre en français et recopie exactement l'URL source.
- Retourne exactement un objet par URL fournie.
Retourne uniquement les données au format demandé.

Articles RSS :
${JSON.stringify(articlesForCuration)}`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title_fr: { type: Type.STRING, description: 'Titre de l’article, traduit en français' },
                category: { type: Type.STRING, enum: ['Backend', 'DevOps', 'IA', 'Tech'] },
                summary: { type: Type.STRING, description: 'Résumé fidèle du contenu en français, en 2 ou 3 phrases complètes' },
                relevance_score: { type: Type.NUMBER, description: 'Score de pertinence technique de 1 à 10' },
                url: { type: Type.STRING, description: 'URL exacte de l’article source' },
              },
              required: ['title_fr', 'category', 'summary', 'relevance_score', 'url'],
            },
          },
        },
      });

      if (!response.text) {
        throw new Error("Aucune réponse reçue de l'IA.");
      }

      const curatedArticles: CuratedArticle[] = JSON.parse(response.text);
      if (!Array.isArray(curatedArticles)) {
        throw new Error("La réponse de l'IA n'est pas une liste d'articles.");
      }
      return curatedArticles;
    } catch (error) {
      const status = getApiStatus(error);
      const isAbort =
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'AbortError';
      const isRetryable =
        isAbort || status === 429 || status === 500 || status === 503 || status === 504;
      if (!isRetryable || attempt === 2) {
        throw error;
      }

      const delay = 2000 * (attempt + 1);
      console.warn(
        `Gemini n'a pas répondu correctement${status ? ` (${status})` : ''}; nouvel essai dans ${delay / 1000} s.`,
      );
      await wait(delay);
    }
  }

  throw new Error("La curation IA a échoué après plusieurs tentatives.");
}

/**
 * Résume chaque article dans de petits lots afin que Gemini n'en omette pas,
 * puis renvoie les articles triés par score de pertinence décroissant.
 */
export async function filterAndCurateArticles(rawArticles: ArticleInput[]): Promise<CuratedArticle[]> {
  const results: CuratedArticle[] = [];

  for (let offset = 0; offset < rawArticles.length; offset += BATCH_SIZE) {
    const batch = rawArticles.slice(offset, offset + BATCH_SIZE);
    const expectedUrls = new Set(batch.map((article) => article.link));
    let summaries = await summarizeBatch(batch);
    const validByUrl = new Map(
      summaries
        .filter((summary) => expectedUrls.has(summary.url))
        .map((summary) => [summary.url, summary]),
    );
    const missingArticles = batch.filter((article) => !validByUrl.has(article.link));

    if (missingArticles.length > 0) {
      console.warn(
        `Gemini a omis ${missingArticles.length} article(s) du lot ${Math.floor(offset / BATCH_SIZE) + 1}; nouvel essai ciblé.`,
      );
      summaries = await summarizeBatch(missingArticles);
      for (const summary of summaries) {
        if (missingArticles.some((article) => article.link === summary.url)) {
          validByUrl.set(summary.url, summary);
        }
      }
    }

    const stillMissing = batch.filter((article) => !validByUrl.has(article.link));
    if (stillMissing.length > 0) {
      throw new Error(
        `Gemini n'a pas résumé tous les articles : ${stillMissing.map((article) => article.link).join(', ')}`,
      );
    }

    for (const article of batch) {
      const summary = validByUrl.get(article.link);
      if (!summary) {
        throw new Error(`Résumé manquant pour ${article.link}.`);
      }
      results.push(summary);
    }
  }

  // Classe les articles du plus pertinent au moins pertinent.
  // Le tri est stable : à score égal, l'ordre de récupération est conservé.
  return results.sort((a, b) => b.relevance_score - a.relevance_score);
}