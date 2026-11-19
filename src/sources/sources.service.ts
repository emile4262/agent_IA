import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, type Model } from 'mongoose';
import { User } from '../users/schemas/user.schema';
import type { CreateSourceDto, UpdateSourceDto } from './dto/sources.dto';
import { Source, type SourceDocument } from './schemas/source.schema';
import type { Topic } from './topics';

/** Ce que voient les utilisateurs dans le catalogue. */
export interface PublicSource {
  id: string;
  name: string;
  topic: Topic;
}

/** Vue administrateur : état et santé du flux. */
export interface AdminSourceView extends PublicSource {
  feedUrl: string;
  active: boolean;
  lastFetchedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

/** Les flux de l'ancien agent, importés au premier lancement. */
const DEFAULT_SOURCES: { name: string; feedUrl: string; topic: Topic }[] = [
  { name: 'dev.to · Backend', feedUrl: 'https://dev.to/feed/tag/backend', topic: 'Backend' },
  { name: 'dev.to · DevOps', feedUrl: 'https://dev.to/feed/tag/devops', topic: 'DevOps' },
  { name: 'dev.to · IA', feedUrl: 'https://dev.to/feed/tag/ai', topic: 'IA' },
  { name: 'Medium · Backend', feedUrl: 'https://medium.com/feed/tag/backend', topic: 'Backend' },
  { name: 'Medium · DevOps', feedUrl: 'https://medium.com/feed/tag/devops', topic: 'DevOps' },
  { name: 'Medium · IA', feedUrl: 'https://medium.com/feed/tag/artificial-intelligence', topic: 'IA' },
];

const DUPLICATE_KEY = 11000;

@Injectable()
export class SourcesService {
  constructor(
    @InjectModel(Source.name) private readonly sourceModel: Model<Source>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  /** Remplit le catalogue s'il est vide ; renvoie le nombre de sources ajoutées. */
  async seedDefaults(): Promise<number> {
    if ((await this.sourceModel.estimatedDocumentCount()) > 0) {
      return 0;
    }
    await this.sourceModel.insertMany(DEFAULT_SOURCES);
    return DEFAULT_SOURCES.length;
  }

  async listActive(): Promise<PublicSource[]> {
    const sources = await this.sourceModel.find({ active: true }).sort({ topic: 1, name: 1 }).exec();
    return sources.map((source) => SourcesService.toPublic(source));
  }

  async listAll(): Promise<AdminSourceView[]> {
    const sources = await this.sourceModel.find().sort({ topic: 1, name: 1 }).exec();
    return sources.map((source) => SourcesService.toAdminView(source));
  }

  /** Sources à lire par la collecte. */
  findActive(): Promise<SourceDocument[]> {
    return this.sourceModel.find({ active: true }).exec();
  }

  /** Note le résultat de la dernière lecture du flux (error = null si tout s'est bien passé). */
  async recordFetch(id: string, error: string | null): Promise<void> {
    await this.sourceModel.updateOne({ _id: id }, { lastFetchedAt: new Date(), lastError: error });
  }

  /** Vérifie qu'une liste d'identifiants ne contient que des sources actives du catalogue. */
  async assertActiveIds(ids: string[]): Promise<void> {
    const invalid = ids.filter((id) => !isValidObjectId(id));
    const found = await this.sourceModel
      .find({ _id: { $in: ids.filter((id) => isValidObjectId(id)) }, active: true })
      .select('_id')
      .exec();
    const foundIds = new Set(found.map((source) => source.id as string));
    invalid.push(...ids.filter((id) => isValidObjectId(id) && !foundIds.has(id)));
    if (invalid.length > 0) {
      throw new BadRequestException(`Sources inconnues ou désactivées : ${invalid.join(', ')}.`);
    }
  }

  async create(dto: CreateSourceDto): Promise<AdminSourceView> {
    try {
      return SourcesService.toAdminView(await this.sourceModel.create(dto));
    } catch (error) {
      throw SourcesService.duplicateOr(error);
    }
  }

  async update(id: string, dto: UpdateSourceDto): Promise<AdminSourceView> {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException('Indiquez au moins un champ à modifier.');
    }
    const source = await this.getOrThrow(id);
    source.set(dto);
    try {
      await source.save();
    } catch (error) {
      throw SourcesService.duplicateOr(error);
    }
    return SourcesService.toAdminView(source);
  }

  /** Supprime une source et la retire des préférences de tous les utilisateurs. */
  async remove(id: string): Promise<void> {
    const source = await this.getOrThrow(id);
    await source.deleteOne();
    // Filtre obligatoire : $pull échoue sur sourceIds = null (« toutes les sources »).
    await this.userModel.updateMany(
      { 'preferences.sourceIds': source._id },
      { $pull: { 'preferences.sourceIds': source._id } },
    );
  }

  private async getOrThrow(id: string): Promise<SourceDocument> {
    const source = isValidObjectId(id) ? await this.sourceModel.findById(id).exec() : null;
    if (!source) {
      throw new NotFoundException('Source introuvable.');
    }
    return source;
  }

  private static duplicateOr(error: unknown): unknown {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === DUPLICATE_KEY) {
      return new ConflictException('Ce flux est déjà dans le catalogue.');
    }
    return error;
  }

  static toPublic(source: SourceDocument): PublicSource {
    return { id: source.id as string, name: source.name, topic: source.topic };
  }

  static toAdminView(source: SourceDocument): AdminSourceView {
    return {
      ...SourcesService.toPublic(source),
      feedUrl: source.feedUrl,
      active: source.active,
      lastFetchedAt: source.lastFetchedAt,
      lastError: source.lastError,
      createdAt: source.createdAt,
    };
  }
}
