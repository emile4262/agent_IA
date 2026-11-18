import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// Comme dans auth.dto.ts : règles vérifiées de bas en haut, « obligatoire » tout en bas.

const trimLower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateInvitationDto {
  @ApiProperty({ example: 'koffi@exemple.ci' })
  @Transform(trimLower)
  @IsEmail({}, { message: 'Adresse e-mail invalide.' })
  @IsNotEmpty({ message: 'L’adresse e-mail est obligatoire.' })
  email!: string;
}

export class CreateInviteLinkDto {
  @ApiPropertyOptional({ example: 'Groupe WhatsApp dev', maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @MaxLength(100, { message: 'Le libellé ne doit pas dépasser 100 caractères.' })
  @IsString({ message: 'Le libellé doit être un texte.' })
  label?: string;

  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 10000, description: 'Sans valeur : illimité.' })
  @IsOptional()
  @Max(10000, { message: 'maxUses ne doit pas dépasser 10000.' })
  @Min(1, { message: 'maxUses doit être au moins 1.' })
  @IsInt({ message: 'maxUses doit être un nombre entier.' })
  maxUses?: number;

  @ApiPropertyOptional({ example: 30, minimum: 1, maximum: 365, description: 'Sans valeur : pas d’expiration.' })
  @IsOptional()
  @Max(365, { message: 'expiresInDays ne doit pas dépasser 365.' })
  @Min(1, { message: 'expiresInDays doit être au moins 1.' })
  @IsInt({ message: 'expiresInDays doit être un nombre entier.' })
  expiresInDays?: number;
}
