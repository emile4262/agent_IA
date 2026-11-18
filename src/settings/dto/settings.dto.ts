import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty } from 'class-validator';
import { REGISTRATION_MODES, type RegistrationMode } from '../schemas/settings.schema';

export class UpdateSettingsDto {
  @ApiProperty({
    enum: REGISTRATION_MODES,
    example: 'invitation',
    description: 'open : inscription libre. invitation : seulement avec une invitation ou un lien partagé.',
  })
  @IsIn(REGISTRATION_MODES, { message: 'registrationMode doit valoir open ou invitation.' })
  @IsNotEmpty({ message: 'registrationMode est obligatoire.' })
  registrationMode!: RegistrationMode;
}
