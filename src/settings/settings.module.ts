import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminSettingsController } from './admin-settings.controller';
import { Settings, SettingsSchema } from './schemas/settings.schema';
import { SettingsService } from './settings.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Settings.name, schema: SettingsSchema }])],
  controllers: [AdminSettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
