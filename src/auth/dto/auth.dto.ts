import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

// Les règles sont vérifiées de bas en haut et seul le premier échec est renvoyé
// (stopAtFirstError) : « obligatoire » est donc placé tout en bas.

const trimLower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RegisterDto {
  @ApiProperty({ example: 'awa@exemple.ci' })
  @Transform(trimLower)
  @IsEmail({}, { message: 'Adresse e-mail invalide.' })
  @IsNotEmpty({ message: 'L’adresse e-mail est obligatoire.' })
  email!: string;

  // bcrypt ignore tout ce qui dépasse 72 octets : on refuse plutôt que de tronquer en silence.
  @ApiProperty({ example: 'motdepasse123', minLength: 8, maxLength: 72 })
  @MaxLength(72, { message: 'Le mot de passe ne doit pas dépasser 72 caractères.' })
  @MinLength(8, { message: 'Le mot de passe doit faire au moins 8 caractères.' })
  @IsString({ message: 'Le mot de passe doit être un texte.' })
  @IsNotEmpty({ message: 'Le mot de passe est obligatoire.' })
  password!: string;

  @ApiProperty({ example: 'Awa', maxLength: 50 })
  @Transform(trim)
  @MaxLength(50, { message: 'Le prénom ne doit pas dépasser 50 caractères.' })
  @IsString({ message: 'Le prénom doit être un texte.' })
  @IsNotEmpty({ message: 'Le prénom est obligatoire.' })
  firstName!: string;

  @ApiProperty({ example: 'Koné', maxLength: 50 })
  @Transform(trim)
  @MaxLength(50, { message: 'Le nom ne doit pas dépasser 50 caractères.' })
  @IsString({ message: 'Le nom doit être un texte.' })
  @IsNotEmpty({ message: 'Le nom est obligatoire.' })
  lastName!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'awa@exemple.ci' })
  @Transform(trimLower)
  @IsEmail({}, { message: 'Adresse e-mail invalide.' })
  @IsNotEmpty({ message: 'L’adresse e-mail est obligatoire.' })
  email!: string;

  @ApiProperty({ example: 'motdepasse123' })
  @IsString({ message: 'Le mot de passe doit être un texte.' })
  @IsNotEmpty({ message: 'Le mot de passe est obligatoire.' })
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'motdepasse123' })
  @IsString({ message: 'Le mot de passe actuel doit être un texte.' })
  @IsNotEmpty({ message: 'Le mot de passe actuel est obligatoire.' })
  currentPassword!: string;

  @ApiProperty({ example: 'nouveauMotDePasse456', minLength: 8, maxLength: 72 })
  @MaxLength(72, { message: 'Le nouveau mot de passe ne doit pas dépasser 72 caractères.' })
  @MinLength(8, { message: 'Le nouveau mot de passe doit faire au moins 8 caractères.' })
  @IsString({ message: 'Le nouveau mot de passe doit être un texte.' })
  @IsNotEmpty({ message: 'Le nouveau mot de passe est obligatoire.' })
  newPassword!: string;
}

export class VerifyEmailQueryDto {
  @ApiProperty({ description: 'Le code reçu dans le lien de confirmation.' })
  @IsString({ message: 'token doit être un texte.' })
  @IsNotEmpty({ message: 'Le lien de confirmation est incomplet.' })
  token!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'awa@exemple.ci' })
  @Transform(trimLower)
  @IsEmail({}, { message: 'Adresse e-mail invalide.' })
  @IsNotEmpty({ message: 'L’adresse e-mail est obligatoire.' })
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Le code reçu par e-mail.' })
  @IsString({ message: 'token doit être un texte.' })
  @IsNotEmpty({ message: 'Le code de réinitialisation est obligatoire.' })
  token!: string;

  @ApiProperty({ example: 'nouveauMotDePasse456', minLength: 8, maxLength: 72 })
  @MaxLength(72, { message: 'Le nouveau mot de passe ne doit pas dépasser 72 caractères.' })
  @MinLength(8, { message: 'Le nouveau mot de passe doit faire au moins 8 caractères.' })
  @IsString({ message: 'Le nouveau mot de passe doit être un texte.' })
  @IsNotEmpty({ message: 'Le nouveau mot de passe est obligatoire.' })
  newPassword!: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'Le refreshToken reçu à la connexion.' })
  @IsString({ message: 'refreshToken doit être un texte.' })
  @IsNotEmpty({ message: 'refreshToken est obligatoire.' })
  refreshToken!: string;
}
