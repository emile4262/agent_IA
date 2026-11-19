import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ARTICLE_STATUSES, type ArticleStatus } from '../../articles/schemas/article.schema';

// Comme dans auth.dto.ts : règles vérifiées de bas en haut.

export class ListArticlesQueryDto {
  @ApiPropertyOptional({ enum: ARTICLE_STATUSES })
  @IsOptional()
  @IsIn(ARTICLE_STATUSES, { message: `status doit valoir ${ARTICLE_STATUSES.join(', ')}.` })
  status?: ArticleStatus;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @Min(1, { message: 'page doit être au moins 1.' })
  @IsInt({ message: 'page doit être un nombre entier.' })
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @Max(100, { message: 'limit ne doit pas dépasser 100.' })
  @Min(1, { message: 'limit doit être au moins 1.' })
  @IsInt({ message: 'limit doit être un nombre entier.' })
  limit = 20;
}
