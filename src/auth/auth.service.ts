import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { Env } from '../config/env.validation';
import { MailService } from '../mail/mail.service';
import { passwordResetEmail, verificationEmail } from '../mail/mail.templates';
import type { UserDocument, UserRole } from '../users/schemas/user.schema';
import { UsersService, type PublicUser } from '../users/users.service';
import type { ChangePasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from './dto/auth.dto';
import { hashPassword, verifyPassword } from './password';
import { Token, type TokenType } from './schemas/token.schema';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
}

export interface AuthResponse {
  accessToken: string;
  /** Durée de validité du jeton d'accès, en secondes. */
  expiresIn: number;
  refreshToken: string;
  user: PublicUser;
}

export interface MessageResponse {
  message: string;
}

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
/** Délai minimal entre deux e-mails du même type pour un même compte. */
const EMAIL_COOLDOWN_MS = 60 * 1000;

const FORGOT_PASSWORD_MESSAGE =
  'Si un compte existe avec cette adresse, un e-mail de réinitialisation vient d’être envoyé.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly config: ConfigService<Env, true>,
    @InjectModel(Token.name) private readonly tokenModel: Model<Token>,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const passwordHash = await hashPassword(dto.password);
    // Le rôle n'est jamais lu depuis la requête : toute inscription crée un compte « user ».
    const user = await this.usersService.create({
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      passwordHash,
    });
    // Un échec d'envoi ne bloque pas l'inscription : l'e-mail peut être renvoyé ensuite.
    await this.sendVerificationEmail(user).catch((error: unknown) =>
      this.logger.error(`E-mail de confirmation non envoyé à ${user.email}`, error instanceof Error ? error.stack : error),
    );
    return this.issueTokens(user);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.usersService.findByEmailWithPassword(dto.email);
    const passwordOk = await verifyPassword(dto.password, user?.passwordHash);
    if (!user || !passwordOk) {
      throw new UnauthorizedException('E-mail ou mot de passe incorrect.');
    }
    if (!user.active) {
      throw new UnauthorizedException('Ce compte est désactivé.');
    }
    return this.issueTokens(user);
  }

  /** Échange un jeton de renouvellement contre une nouvelle paire ; l'ancien devient inutilisable. */
  async refresh(refreshToken: string): Promise<AuthResponse> {
    const stored = await this.consumeToken(refreshToken, 'refresh');
    const user = stored ? await this.usersService.findById(stored.userId.toString()) : null;
    if (!user || !user.active) {
      throw new UnauthorizedException('Session expirée, reconnectez-vous.');
    }
    return this.issueTokens(user);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokenModel.deleteOne({ tokenHash: AuthService.sha256(refreshToken), type: 'refresh' });
  }

  /**
   * Change le mot de passe de la personne connectée, puis ferme toutes ses sessions
   * et en ouvre une nouvelle : un éventuel voleur de session est déconnecté.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<AuthResponse> {
    const user = await this.usersService.findByIdWithPassword(userId);
    if (!user || !(await verifyPassword(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Mot de passe actuel incorrect.');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('Le nouveau mot de passe doit être différent de l’actuel.');
    }

    user.passwordHash = await hashPassword(dto.newPassword);
    user.mustChangePassword = false;
    await user.save();
    await this.tokenModel.deleteMany({ userId: user._id, type: 'refresh' });
    return this.issueTokens(user);
  }

  /** Lien reçu par e-mail : confirme l'adresse. Le lien ne sert qu'une fois. */
  async verifyEmail(token: string): Promise<MessageResponse> {
    const stored = await this.consumeToken(token, 'email_verification');
    const user = stored ? await this.usersService.findById(stored.userId.toString()) : null;
    if (!user) {
      throw new BadRequestException('Lien de confirmation invalide ou expiré. Demandez-en un nouveau.');
    }
    user.emailVerified = true;
    await user.save();
    return { message: 'Adresse e-mail confirmée.' };
  }

  async resendVerification(userId: string): Promise<MessageResponse> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException();
    }
    if (user.emailVerified) {
      throw new BadRequestException('Votre adresse e-mail est déjà confirmée.');
    }
    if (await this.sentRecently(user, 'email_verification')) {
      throw new HttpException('Un e-mail vient d’être envoyé. Réessayez dans une minute.', HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.sendVerificationEmail(user);
    return { message: `E-mail de confirmation envoyé à ${user.email}.` };
  }

  /**
   * Toujours la même réponse, que le compte existe ou non, pour ne pas révéler
   * quelles adresses sont inscrites. L'envoi se fait en arrière-plan pour la même raison
   * (le temps de réponse ne doit pas dépendre de l'existence du compte).
   */
  async forgotPassword(email: string): Promise<MessageResponse> {
    const user = await this.usersService.findByEmailWithPassword(email);
    if (user && user.active && !(await this.sentRecently(user, 'password_reset'))) {
      this.sendPasswordResetEmail(user).catch((error: unknown) =>
        this.logger.error(
          `E-mail de réinitialisation non envoyé à ${user.email}`,
          error instanceof Error ? error.stack : error,
        ),
      );
    }
    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  /** Nouveau mot de passe à partir du code reçu par e-mail ; toutes les sessions sont fermées. */
  async resetPassword(dto: ResetPasswordDto): Promise<MessageResponse> {
    const stored = await this.consumeToken(dto.token, 'password_reset');
    const user = stored ? await this.usersService.findById(stored.userId.toString()) : null;
    if (!user || !user.active) {
      throw new BadRequestException('Code de réinitialisation invalide ou expiré. Refaites une demande.');
    }

    user.passwordHash = await hashPassword(dto.newPassword);
    user.mustChangePassword = false;
    // Recevoir le code prouve que la personne a accès à sa boîte mail.
    user.emailVerified = true;
    await user.save();
    await this.tokenModel.deleteMany({ userId: user._id, type: { $in: ['refresh', 'password_reset'] } });
    return { message: 'Mot de passe modifié. Connectez-vous avec le nouveau mot de passe.' };
  }

  private async sendVerificationEmail(user: UserDocument): Promise<void> {
    const token = await this.createSingleUseToken(user, 'email_verification', EMAIL_VERIFICATION_TTL_MS);
    const link = `${this.config.get('APP_URL', { infer: true })}/auth/verify-email?token=${token}`;
    await this.mailService.send(verificationEmail(user.email, user.firstName, link));
  }

  private async sendPasswordResetEmail(user: UserDocument): Promise<void> {
    const token = await this.createSingleUseToken(user, 'password_reset', PASSWORD_RESET_TTL_MS);
    await this.mailService.send(passwordResetEmail(user.email, user.firstName, token));
  }

  /** Crée un nouveau jeton et invalide les précédents du même type : seul le dernier e-mail compte. */
  private async createSingleUseToken(user: UserDocument, type: TokenType, ttlMs: number): Promise<string> {
    await this.tokenModel.deleteMany({ userId: user._id, type });
    return this.createToken(user, type, ttlMs);
  }

  private async createToken(user: UserDocument, type: TokenType, ttlMs: number): Promise<string> {
    const token = randomBytes(48).toString('base64url');
    await this.tokenModel.create({
      userId: user._id,
      type,
      tokenHash: AuthService.sha256(token),
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return token;
  }

  /** Retrouve un jeton valide et le supprime aussitôt : il ne peut servir qu'une fois. */
  private consumeToken(token: string, type: TokenType) {
    return this.tokenModel.findOneAndDelete({
      tokenHash: AuthService.sha256(token),
      type,
      expiresAt: { $gt: new Date() },
    });
  }

  private async sentRecently(user: UserDocument, type: TokenType): Promise<boolean> {
    const since = new Date(Date.now() - EMAIL_COOLDOWN_MS);
    return (await this.tokenModel.exists({ userId: user._id, type, createdAt: { $gt: since } })) !== null;
  }

  private async issueTokens(user: UserDocument): Promise<AuthResponse> {
    const payload: AccessTokenPayload = { sub: user.id as string, role: user.role };
    const accessToken = await this.jwtService.signAsync(payload);
    const refreshToken = await this.createToken(user, 'refresh', REFRESH_TOKEN_TTL_MS);
    return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, refreshToken, user: UsersService.toPublic(user) };
  }

  private static sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
