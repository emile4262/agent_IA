import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  IsTimeZone,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { TOPICS, type Topic } from '../../sources/topics';
import { FREQUENCIES, type Frequency } from '../../users/schemas/preferences.schema';
import { KEYWORD_MAX_LENGTH, KEYWORD_MIN_LENGTH, MAX_KEYWORDS, normalizeKeyword } from '../keywords';

// Comme dans auth.dto.ts : règles vérifiées de bas en haut.

/** Champ facultatif qui, s'il est envoyé, ne peut pas valoir null (contrairement à @IsOptional). */
const Optional = () => ValidateIf((_object, value) => value !== undefined);

export const MAX_ARTICLES_LIMIT = 30;

/** Seuls les champs envoyés sont modifiés. */
export class UpdatePreferencesDto {
  @ApiPropertyOptional({ enum: TOPICS, isArray: true, example: ['Backend', 'IA'] })
  @Optional()
  @IsIn(TOPICS, { each: true, message: `Chaque sujet doit valoir ${TOPICS.join(', ')}.` })
  @ArrayUnique({ message: 'Un sujet ne peut apparaître qu’une fois.' })
  @IsArray({ message: 'topics doit être une liste.' })
  topics?: Topic[];

  @ApiPropertyOptional({
    type: [String],
    example: ['flutter', 'mobile money'],
    description: `Sujets libres (${MAX_KEYWORDS} au plus) : l’actualité correspondante est recherchée sur Google News.`,
  })
  @Optional()
  @Length(KEYWORD_MIN_LENGTH, KEYWORD_MAX_LENGTH, {
    each: true,
    message: `Chaque mot-clé doit faire entre ${KEYWORD_MIN_LENGTH} et ${KEYWORD_MAX_LENGTH} caractères.`,
  })
  @IsString({ each: true, message: 'Chaque mot-clé doit être un texte.' })
  @ArrayUnique({ message: 'Un mot-clé ne peut apparaître qu’une fois.' })
  @ArrayMaxSize(MAX_KEYWORDS, { message: `${MAX_KEYWORDS} mots-clés au plus.` })
  @IsArray({ message: 'keywords doit être une liste.' })
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? normalizeKeyword(item) : item)) : value,
  )
  keywords?: string[];

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    description: 'Identifiants pris dans GET /sources. null = toutes les sources, y compris les futures.',
  })
  @IsOptional()
  @IsMongoId({ each: true, message: 'Chaque source doit être un identifiant valide.' })
  @ArrayUnique({ message: 'Une source ne peut apparaître qu’une fois.' })
  @ArrayMaxSize(200, { message: 'Trop de sources.' })
  @ArrayMinSize(1, { message: 'Choisissez au moins une source, ou null pour toutes.' })
  @IsArray({ message: 'sourceIds doit être une liste ou null.' })
  sourceIds?: string[] | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 10, example: 6, description: 'Note minimale donnée par l’IA.' })
  @Optional()
  @Max(10, { message: 'minScore ne doit pas dépasser 10.' })
  @Min(1, { message: 'minScore doit être au moins 1.' })
  @IsInt({ message: 'minScore doit être un nombre entier.' })
  minScore?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_ARTICLES_LIMIT, example: 10 })
  @Optional()
  @Max(MAX_ARTICLES_LIMIT, { message: `maxArticles ne doit pas dépasser ${MAX_ARTICLES_LIMIT}.` })
  @Min(1, { message: 'maxArticles doit être au moins 1.' })
  @IsInt({ message: 'maxArticles doit être un nombre entier.' })
  maxArticles?: number;

  @ApiPropertyOptional({ example: '07:30', description: 'Heure d’envoi au format HH:mm.' })
  @Optional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'sendTime doit être une heure au format HH:mm (ex. 07:30).' })
  sendTime?: string;

  @ApiPropertyOptional({ example: 'Africa/Abidjan' })
  @Optional()
  @IsTimeZone({ message: 'timezone doit être un fuseau horaire valide (ex. Africa/Abidjan).' })
  timezone?: string;

  @ApiPropertyOptional({ enum: FREQUENCIES, description: 'weekly = le lundi.' })
  @Optional()
  @IsIn(FREQUENCIES, { message: `frequency doit valoir ${FREQUENCIES.join(', ')}.` })
  frequency?: Frequency;

  @ApiPropertyOptional({ description: 'false = mettre la veille en pause.' })
  @Optional()
  @IsBoolean({ message: 'active doit valoir true ou false.' })
  active?: boolean;
}
