import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { UserDocument, UserRole } from '../users/schemas/user.schema';
import { UsersService, type PublicUser } from '../users/users.service';
import type { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';
import { hashPassword, verifyPassword } from './password';
import { Token } from './schemas/token.schema';

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

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
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
    const stored = await this.tokenModel.findOneAndDelete({
      tokenHash: AuthService.sha256(refreshToken),
      type: 'refresh',
      expiresAt: { $gt: new Date() },
    });
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

  private async issueTokens(user: UserDocument): Promise<AuthResponse> {
    const payload: AccessTokenPayload = { sub: user.id as string, role: user.role };
    const accessToken = await this.jwtService.signAsync(payload);

    const refreshToken = randomBytes(48).toString('base64url');
    await this.tokenModel.create({
      userId: user._id,
      type: 'refresh',
      tokenHash: AuthService.sha256(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });

    return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, refreshToken, user: UsersService.toPublic(user) };
  }

  private static sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
