import { Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { Paginated } from '../users/users.service';
import {
  DigestService,
  type DeliveryView,
  type DigestRunReport,
  type DigestToday,
  type SendNowResult,
} from './digest.service';
import { DigestHistoryQueryDto } from './dto/digest.dto';

@ApiTags('digest')
@ApiBearerAuth()
@Controller('digest')
export class DigestController {
  constructor(private readonly digestService: DigestService) {}

  /** Sa veille du jour : l'envoi déjà fait, et les articles qui seraient envoyés maintenant. */
  @Get('today')
  today(@CurrentUser() user: AuthUser): Promise<DigestToday> {
    return this.digestService.today(user.id);
  }

  /** Ses envois passés, du plus récent au plus ancien. */
  @Get('history')
  history(@CurrentUser() user: AuthUser, @Query() query: DigestHistoryQueryDto): Promise<Paginated<DeliveryView>> {
    return this.digestService.history(user.id, query.page, query.limit);
  }

  /** Recevoir sa veille tout de suite par e-mail (au plus 3 fois par jour). */
  @Post('send-now')
  @HttpCode(HttpStatus.OK)
  sendNow(@CurrentUser() user: AuthUser): Promise<SendNowResult> {
    return this.digestService.sendNow(user.id);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/digest')
export class AdminDigestController {
  constructor(private readonly digestService: DigestService) {}

  /** Lancer tout de suite la vérification des envois, sans attendre la planification. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  run(): Promise<DigestRunReport> {
    return this.digestService.runScheduled();
  }
}
