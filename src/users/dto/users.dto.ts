import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// Comme dans auth.dto.ts : règles vérifiées de bas en haut, « obligatoire » tout en bas.

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Champs modifiables par la personne elle-même. Ni l'e-mail ni le rôle n'en font partie. */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Awa', maxLength: 50 })
  @IsOptional()
  @Transform(trim)
  @MaxLength(50, { message: 'Le prénom ne doit pas dépasser 50 caractères.' })
  @IsString({ message: 'Le prénom doit être un texte.' })
  @IsNotEmpty({ message: 'Le prénom ne peut pas être vide.' })
  firstName?: string;

  @ApiPropertyOptional({ example: 'Koné', maxLength: 50 })
  @IsOptional()
  @Transform(trim)
  @MaxLength(50, { message: 'Le nom ne doit pas dépasser 50 caractères.' })
  @IsString({ message: 'Le nom doit être un texte.' })
  @IsNotEmpty({ message: 'Le nom ne peut pas être vide.' })
  lastName?: string;
}

export class DeleteAccountDto {
  @ApiProperty({ description: 'Mot de passe actuel, pour confirmer la suppression.' })
  @IsString({ message: 'Le mot de passe doit être un texte.' })
  @IsNotEmpty({ message: 'Le mot de passe est obligatoire pour supprimer le compte.' })
  password!: string;
}

export class ListUsersQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @Min(1, { message: 'page doit être au moins 1.' })
  @IsInt({ message: 'page doit être un nombre entier.' })
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @Max(100, { message: 'limit ne doit pas dépasser 100.' })
  @Min(1, { message: 'limit doit être au moins 1.' })
  @IsInt({ message: 'limit doit être un nombre entier.' })
  limit = 20;

  @ApiPropertyOptional({ description: 'Filtre sur l’e-mail, le prénom ou le nom.', maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @MaxLength(100, { message: 'search ne doit pas dépasser 100 caractères.' })
  @IsString({ message: 'search doit être un texte.' })
  search?: string;
}

export class SetUserStatusDto {
  @ApiProperty({ example: false, description: 'false = désactiver le compte, true = le réactiver.' })
  @IsBoolean({ message: 'active doit valoir true ou false.' })
  active!: boolean;
}
