import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { TOPICS, type Topic } from '../topics';

// Comme dans auth.dto.ts : règles vérifiées de bas en haut, « obligatoire » tout en bas.

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const URL_OPTIONS = { protocols: ['http', 'https'], require_protocol: true };
const TOPIC_MESSAGE = `topic doit valoir ${TOPICS.join(', ')}.`;

export class CreateSourceDto {
  @ApiProperty({ example: 'dev.to · TypeScript', maxLength: 100 })
  @Transform(trim)
  @MaxLength(100, { message: 'Le nom ne doit pas dépasser 100 caractères.' })
  @IsString({ message: 'Le nom doit être un texte.' })
  @IsNotEmpty({ message: 'Le nom est obligatoire.' })
  name!: string;

  @ApiProperty({ example: 'https://dev.to/feed/tag/typescript' })
  @Transform(trim)
  @IsUrl(URL_OPTIONS, { message: 'feedUrl doit être une adresse http(s) valide.' })
  @IsNotEmpty({ message: 'feedUrl est obligatoire.' })
  feedUrl!: string;

  @ApiProperty({ enum: TOPICS, example: 'Backend' })
  @IsIn(TOPICS, { message: TOPIC_MESSAGE })
  @IsNotEmpty({ message: 'topic est obligatoire.' })
  topic!: Topic;
}

export class UpdateSourceDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @MaxLength(100, { message: 'Le nom ne doit pas dépasser 100 caractères.' })
  @IsString({ message: 'Le nom doit être un texte.' })
  @IsNotEmpty({ message: 'Le nom ne peut pas être vide.' })
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsUrl(URL_OPTIONS, { message: 'feedUrl doit être une adresse http(s) valide.' })
  feedUrl?: string;

  @ApiPropertyOptional({ enum: TOPICS })
  @IsOptional()
  @IsIn(TOPICS, { message: TOPIC_MESSAGE })
  topic?: Topic;

  @ApiPropertyOptional({ description: 'false = retirer la source du catalogue sans la supprimer.' })
  @IsOptional()
  @IsBoolean({ message: 'active doit valoir true ou false.' })
  active?: boolean;
}
