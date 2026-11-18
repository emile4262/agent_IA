import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// Comme dans auth.dto.ts : règles vérifiées de bas en haut.

export class DigestHistoryQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @Min(1, { message: 'page doit être au moins 1.' })
  @IsInt({ message: 'page doit être un nombre entier.' })
  page = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @Max(50, { message: 'limit ne doit pas dépasser 50.' })
  @Min(1, { message: 'limit doit être au moins 1.' })
  @IsInt({ message: 'limit doit être un nombre entier.' })
  limit = 10;
}
