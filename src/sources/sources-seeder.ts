import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { SourcesService } from './sources.service';

/** Au premier lancement, importe dans le catalogue les flux de l'ancien agent. */
@Injectable()
export class SourcesSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(SourcesSeeder.name);

  constructor(private readonly sourcesService: SourcesService) {}

  async onApplicationBootstrap(): Promise<void> {
    const added = await this.sourcesService.seedDefaults();
    if (added > 0) {
      this.logger.log(`Catalogue vide : ${added} sources par défaut importées.`);
    }
  }
}
