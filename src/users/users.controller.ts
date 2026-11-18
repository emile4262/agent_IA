import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AllowPendingPassword } from '../auth/decorators/allow-pending-password.decorator';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';
import { DeleteAccountDto, UpdateProfileDto } from './dto/users.dto';
import { UsersService, type PublicUser } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Profil de la personne connectée (accessible même avant le changement du mot de passe provisoire). */
  @AllowPendingPassword()
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<PublicUser> {
    return this.usersService.getProfile(user.id);
  }

  /** Modifier son prénom et/ou son nom. */
  @Patch('me')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto): Promise<PublicUser> {
    return this.usersService.updateProfile(user.id, dto);
  }

  /** Supprimer définitivement son compte (mot de passe demandé). */
  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Body() dto: DeleteAccountDto): Promise<void> {
    return this.usersService.deleteAccount(user.id, dto.password);
  }
}
