import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';
import { UpdatePreferencesDto } from './dto/preferences.dto';
import { PreferencesService, type PreferencesView } from './preferences.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users/me/preferences')
export class PreferencesController {
  constructor(private readonly preferencesService: PreferencesService) {}

  /** Ses choix de veille : sujets, sources, note minimale, heure et fréquence d'envoi. */
  @Get()
  get(@CurrentUser() user: AuthUser): Promise<PreferencesView> {
    return this.preferencesService.get(user.id);
  }

  /** Modifier ses choix ; seuls les champs envoyés changent. */
  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdatePreferencesDto): Promise<PreferencesView> {
    return this.preferencesService.update(user.id, dto);
  }
}
