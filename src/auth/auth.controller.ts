import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LoginThrottle, SensitiveThrottle } from '../common/rate-limit';
import { SettingsService, type SettingsView } from '../settings/settings.service';
import { AuthService, type AuthResponse, type MessageResponse } from './auth.service';
import { AllowPendingPassword } from './decorators/allow-pending-password.decorator';
import { CurrentUser, type AuthUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailQueryDto,
} from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly settingsService: SettingsService,
  ) {}

  /** Indique si l'inscription est libre (open) ou seulement sur invitation (invitation). */
  @Public()
  @Get('registration-mode')
  registrationMode(): Promise<SettingsView> {
    return this.settingsService.get();
  }

  /**
   * Crée un compte « user ». Selon le mode d'inscription, il faut un invitationToken
   * (invitation reçue par e-mail) ou un inviteCode (lien partagé par l'admin).
   */
  @Public()
  @SensitiveThrottle()
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.authService.register(dto);
  }

  @Public()
  @LoginThrottle()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthResponse> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Body() dto: RefreshTokenDto): Promise<void> {
    return this.authService.logout(dto.refreshToken);
  }

  /** Réservé aux personnes connectées. Obligatoire pour l'admin créé au premier lancement. */
  @ApiBearerAuth()
  @AllowPendingPassword()
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto): Promise<AuthResponse> {
    return this.authService.changePassword(user.id, dto);
  }

  /** Lien de confirmation envoyé par e-mail à l'inscription. */
  @Public()
  @SensitiveThrottle()
  @Get('verify-email')
  verifyEmail(@Query() query: VerifyEmailQueryDto): Promise<MessageResponse> {
    return this.authService.verifyEmail(query.token);
  }

  /** Renvoie l'e-mail de confirmation à la personne connectée (au plus un par minute). */
  @ApiBearerAuth()
  @AllowPendingPassword()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  resendVerification(@CurrentUser() user: AuthUser): Promise<MessageResponse> {
    return this.authService.resendVerification(user.id);
  }

  /** Envoie un code de réinitialisation par e-mail. Réponse identique que le compte existe ou non. */
  @Public()
  @SensitiveThrottle()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<MessageResponse> {
    return this.authService.forgotPassword(dto.email);
  }

  /** Choisit un nouveau mot de passe avec le code reçu par e-mail. */
  @Public()
  @SensitiveThrottle()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<MessageResponse> {
    return this.authService.resetPassword(dto);
  }
}
