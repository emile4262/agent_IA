import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateSourceDto, UpdateSourceDto } from './dto/sources.dto';
import { SourcesService, type AdminSourceView } from './sources.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/sources')
export class AdminSourcesController {
  constructor(private readonly sourcesService: SourcesService) {}

  /** Toutes les sources, actives ou non, avec l'état de la dernière collecte. */
  @Get()
  list(): Promise<AdminSourceView[]> {
    return this.sourcesService.listAll();
  }

  @Post()
  create(@Body() dto: CreateSourceDto): Promise<AdminSourceView> {
    return this.sourcesService.create(dto);
  }

  /** Renommer, changer l'URL ou le sujet, ou désactiver (active: false). */
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSourceDto): Promise<AdminSourceView> {
    return this.sourcesService.update(id, dto);
  }

  /** Suppression définitive ; la source est aussi retirée des préférences des utilisateurs. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.sourcesService.remove(id);
  }
}
