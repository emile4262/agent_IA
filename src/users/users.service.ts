import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, type Model } from 'mongoose';
import { verifyPassword } from '../auth/password';
import { Token } from '../auth/schemas/token.schema';
import type { UpdateProfileDto } from './dto/users.dto';
import { User, type UserDocument, type UserRole } from './schemas/user.schema';

/** Ce que l'API renvoie d'un utilisateur : jamais le mot de passe. */
export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  emailVerified: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
}

/** Vue administrateur : ajoute l'état du compte. */
export interface AdminUserView extends PublicUser {
  active: boolean;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Token.name) private readonly tokenModel: Model<Token>,
  ) {}

  async create(data: {
    email: string;
    firstName: string;
    lastName: string;
    passwordHash: string;
    role?: UserRole;
    mustChangePassword?: boolean;
  }): Promise<UserDocument> {
    if (await this.userModel.exists({ email: data.email.toLowerCase() })) {
      throw new ConflictException('Un compte existe déjà avec cette adresse e-mail.');
    }
    return this.userModel.create({ role: 'user', ...data });
  }

  async hasAdmin(): Promise<boolean> {
    return (await this.userModel.exists({ role: 'admin' })) !== null;
  }

  /** Recherche par e-mail, avec le mot de passe haché (pour la connexion). */
  findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).select('+passwordHash').exec();
  }

  findByIdWithPassword(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).select('+passwordHash').exec();
  }

  findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async getProfile(id: string): Promise<PublicUser> {
    return UsersService.toPublic(await this.getOrThrow(id));
  }

  async updateProfile(id: string, dto: UpdateProfileDto): Promise<PublicUser> {
    if (dto.firstName === undefined && dto.lastName === undefined) {
      throw new BadRequestException('Indiquez au moins firstName ou lastName.');
    }
    const user = await this.getOrThrow(id);
    if (dto.firstName !== undefined) user.firstName = dto.firstName;
    if (dto.lastName !== undefined) user.lastName = dto.lastName;
    await user.save();
    return UsersService.toPublic(user);
  }

  /** Suppression définitive du compte et de ses sessions, après confirmation du mot de passe. */
  async deleteAccount(id: string, password: string): Promise<void> {
    const user = await this.findByIdWithPassword(id);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException('Mot de passe incorrect.');
    }
    if (user.role === 'admin') {
      throw new ForbiddenException('Le compte administrateur ne peut pas être supprimé.');
    }
    await this.tokenModel.deleteMany({ userId: user._id });
    await user.deleteOne();
  }

  async list(page: number, limit: number): Promise<Paginated<AdminUserView>> {
    const [users, total] = await Promise.all([
      this.userModel
        .find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments(),
    ]);
    return { items: users.map((user) => UsersService.toAdminView(user)), total, page, limit };
  }

  /** Active ou désactive un compte. Une désactivation ferme aussi toutes ses sessions. */
  async setActive(adminId: string, targetId: string, active: boolean): Promise<AdminUserView> {
    if (adminId === targetId) {
      throw new ForbiddenException('Vous ne pouvez pas modifier l’état de votre propre compte.');
    }
    const user = await this.getOrThrow(targetId);
    if (user.role === 'admin') {
      throw new ForbiddenException('Un compte administrateur ne peut pas être désactivé.');
    }
    user.active = active;
    await user.save();
    if (!active) {
      await this.tokenModel.deleteMany({ userId: user._id, type: 'refresh' });
    }
    return UsersService.toAdminView(user);
  }

  private async getOrThrow(id: string): Promise<UserDocument> {
    const user = isValidObjectId(id) ? await this.findById(id) : null;
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable.');
    }
    return user;
  }

  static toPublic(user: UserDocument): PublicUser {
    return {
      id: user.id as string,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      emailVerified: user.emailVerified,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt,
    };
  }

  static toAdminView(user: UserDocument): AdminUserView {
    return { ...UsersService.toPublic(user), active: user.active };
  }
}
