import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SourcesModule } from '../sources/sources.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]), SourcesModule],
  controllers: [PreferencesController],
  providers: [PreferencesService],
})
export class PreferencesModule {}
