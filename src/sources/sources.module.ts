import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AdminSourcesController } from './admin-sources.controller';
import { Source, SourceSchema } from './schemas/source.schema';
import { SourcesController } from './sources.controller';
import { SourcesSeeder } from './sources-seeder';
import { SourcesService } from './sources.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Source.name, schema: SourceSchema },
      // Pour retirer une source supprimée des préférences des utilisateurs.
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [SourcesController, AdminSourcesController],
  providers: [SourcesService, SourcesSeeder],
  exports: [SourcesService],
})
export class SourcesModule {}
