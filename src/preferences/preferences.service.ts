import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { SourcesService } from '../sources/sources.service';
import type { Topic } from '../sources/topics';
import type { Frequency, Preferences } from '../users/schemas/preferences.schema';
import { User } from '../users/schemas/user.schema';
import type { UpdatePreferencesDto } from './dto/preferences.dto';

export interface PreferencesView {
  topics: Topic[];
  /** null = toutes les sources actives. */
  sourceIds: string[] | null;
  /** Sujets libres, recherchés sur Google News. */
  keywords: string[];
  minScore: number;
  maxArticles: number;
  sendTime: string;
  timezone: string;
  frequency: Frequency;
  active: boolean;
}

@Injectable()
export class PreferencesService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly sourcesService: SourcesService,
  ) {}

  async get(userId: string): Promise<PreferencesView> {
    return PreferencesService.toView(await this.getUserOrThrow(userId));
  }

  async update(userId: string, dto: UpdatePreferencesDto): Promise<PreferencesView> {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException('Indiquez au moins un champ à modifier.');
    }
    if (dto.sourceIds) {
      await this.sourcesService.assertActiveIds(dto.sourceIds);
    }

    const user = await this.getUserOrThrow(userId);
    const { sourceIds, ...rest } = dto;
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) user.set(`preferences.${key}`, value);
    }
    if (sourceIds !== undefined) {
      user.set('preferences.sourceIds', sourceIds && sourceIds.map((id) => new Types.ObjectId(id)));
    }
    if (user.preferences.topics.length === 0 && user.preferences.keywords.length === 0) {
      throw new BadRequestException('Choisissez au moins un sujet ou un mot-clé.');
    }
    await user.save();
    return PreferencesService.toView(user);
  }

  private async getUserOrThrow(userId: string) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable.');
    }
    return user;
  }

  static toView(user: { preferences: Preferences }): PreferencesView {
    const preferences = user.preferences;
    return {
      topics: [...preferences.topics],
      sourceIds: preferences.sourceIds && preferences.sourceIds.map((id) => id.toString()),
      keywords: [...preferences.keywords],
      minScore: preferences.minScore,
      maxArticles: preferences.maxArticles,
      sendTime: preferences.sendTime,
      timezone: preferences.timezone,
      frequency: preferences.frequency,
      active: preferences.active,
    };
  }
}
