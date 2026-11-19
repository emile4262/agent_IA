import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { UpdateSettingsDto } from './dto/settings.dto';
import { Settings, type RegistrationMode } from './schemas/settings.schema';

export interface SettingsView {
  registrationMode: RegistrationMode;
}

const GLOBAL_KEY = 'global';

@Injectable()
export class SettingsService {
  constructor(@InjectModel(Settings.name) private readonly settingsModel: Model<Settings>) {}

  /** Lit les réglages ; le document est créé avec les valeurs par défaut s'il n'existe pas encore. */
  get(): Promise<SettingsView> {
    return this.upsert({});
  }

  update(dto: UpdateSettingsDto): Promise<SettingsView> {
    return this.upsert({ registrationMode: dto.registrationMode });
  }

  private async upsert(changes: Partial<Settings>): Promise<SettingsView> {
    const settings = await this.settingsModel
      .findOneAndUpdate(
        { key: GLOBAL_KEY },
        Object.keys(changes).length > 0 ? { $set: changes } : { $setOnInsert: { key: GLOBAL_KEY } },
        { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
      )
      .orFail()
      .exec();
    return { registrationMode: settings.registrationMode };
  }
}
