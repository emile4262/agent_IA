import { Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArticlesService, type AdminArticleView } from '../articles/articles.service';
import type { ArticleStatus } from '../articles/schemas/article.schema';
import { Roles } from '../auth/decorators/roles.decorator';
import type { Paginated } from '../users/users.service';
import { CollectorService, type CollectReport } from './collector.service';
import { ListArticlesQueryDto } from './dto/collector.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin')
export class AdminCollectorController {
  constructor(
    private readonly collectorService: CollectorService,
    private readonly articlesService: ArticlesService,
  ) {}

  /** État de la collecte : planification, dernier rapport, nombre d'articles par état. */
  @Get('collector')
  async status(): Promise<CollectorService['status'] & { articles: Record<ArticleStatus, number> }> {
    return { ...this.collectorService.status, articles: await this.articlesService.countByStatus() };
  }

  /** Lancer une collecte maintenant, sans attendre la planification. */
  @Post('collector/run')
  @HttpCode(HttpStatus.OK)
  run(): Promise<CollectReport> {
    return this.collectorService.run();
  }

  @Get('articles')
  list(@Query() query: ListArticlesQueryDto): Promise<Paginated<AdminArticleView>> {
    return this.articlesService.list(query.status, query.page, query.limit);
  }

  /** Remettre en attente les articles abandonnés après trop d'échecs. */
  @Post('articles/retry-failed')
  @HttpCode(HttpStatus.OK)
  async retryFailed(): Promise<{ requeued: number }> {
    return { requeued: await this.articlesService.retryAbandoned() };
  }
}
