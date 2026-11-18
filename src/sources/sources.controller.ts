import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { SourcesService, type PublicSource } from './sources.service';
import { TOPICS, type Topic } from './topics';

/** Le catalogue, consultable sans compte (affiché à l'inscription). */
@ApiTags('catalogue')
@Public()
@Controller()
export class SourcesController {
  constructor(private readonly sourcesService: SourcesService) {}

  @Get('topics')
  topics(): readonly Topic[] {
    return TOPICS;
  }

  /** Sources actives, à choisir dans ses préférences. */
  @Get('sources')
  sources(): Promise<PublicSource[]> {
    return this.sourcesService.listActive();
  }
}
