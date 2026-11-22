import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { SECURITY_EVENT_RETENTION_DAYS } from '../schemas/security-event.schema';

export class SecuritySummaryQueryDto {
  @ApiPropertyOptional({ default: 7, minimum: 1, maximum: SECURITY_EVENT_RETENTION_DAYS })
  @IsOptional()
  @Type(() => Number)
  @Max(SECURITY_EVENT_RETENTION_DAYS, { message: `days ne doit pas dépasser ${SECURITY_EVENT_RETENTION_DAYS}.` })
  @Min(1, { message: 'days doit être au moins 1.' })
  @IsInt({ message: 'days doit être un nombre entier.' })
  days = 7;
}
