import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { Topic } from '../sources/topics';
import type { Paginated } from '../users/users.service';
import {
  ARTICLE_STATUSES,
  Article,
  MAX_SUMMARY_ATTEMPTS,
  type ArticleDocument,
  type ArticleStatus,
} from './schemas/article.schema';

export interface AdminArticleView {
  id: string;
  url: string;
  /** null = trouvé par une recherche par mot-clé. */
  sourceId: string | null;
  keywords: string[];
  title: string;
  titleFr: string | null;
  topic: Topic | null;
  summary: string | null;
  score: number | null;
  status: ArticleStatus;
  attempts: number;
  lastError: string | null;
  publishedAt: Date | null;
  summarizedAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class ArticlesService {
  constructor(@InjectModel(Article.name) private readonly articleModel: Model<Article>) {}

  async list(status: ArticleStatus | undefined, page: number, limit: number): Promise<Paginated<AdminArticleView>> {
    const filter = status ? { status } : {};
    const [articles, total] = await Promise.all([
      this.articleModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.articleModel.countDocuments(filter),
    ]);
    return { items: articles.map((article) => ArticlesService.toAdminView(article)), total, page, limit };
  }

  /** Nombre d'articles par état. */
  async countByStatus(): Promise<Record<ArticleStatus, number>> {
    const rows = await this.articleModel.aggregate<{ _id: ArticleStatus; count: number }>([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const counts = Object.fromEntries(ARTICLE_STATUSES.map((status) => [status, 0])) as Record<ArticleStatus, number>;
    for (const row of rows) counts[row._id] = row.count;
    return counts;
  }

  /** Redonne leur chance aux articles abandonnés (ex. après un quota IA épuisé) ; renvoie leur nombre. */
  async retryAbandoned(): Promise<number> {
    const result = await this.articleModel.updateMany(
      { status: 'failed', attempts: { $gte: MAX_SUMMARY_ATTEMPTS } },
      { status: 'pending', attempts: 0 },
    );
    return result.modifiedCount;
  }

  static toAdminView(article: ArticleDocument): AdminArticleView {
    return {
      id: article.id as string,
      url: article.url,
      sourceId: article.sourceId?.toString() ?? null,
      keywords: [...article.keywords],
      title: article.title,
      titleFr: article.titleFr,
      topic: article.topic,
      summary: article.summary,
      score: article.score,
      status: article.status,
      attempts: article.attempts,
      lastError: article.lastError,
      publishedAt: article.publishedAt,
      summarizedAt: article.summarizedAt,
      createdAt: article.createdAt,
    };
  }
}
