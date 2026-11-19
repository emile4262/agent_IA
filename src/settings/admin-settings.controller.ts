import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { UpdateSettingsDto } from './dto/settings.dto';
import { SettingsService, type SettingsView } from './settings.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  get(): Promise<SettingsView> {
    return this.settingsService.get();
  }

  /** Choisir qui peut s'inscrire : tout le monde (open) ou seulement les invités (invitation). */
  @Patch()
  update(@Body() dto: UpdateSettingsDto): Promise<SettingsView> {
    return this.settingsService.update(dto);
  }
}
