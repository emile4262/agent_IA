import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminSecurityController } from './admin-security.controller';
import { SecurityEvent, SecurityEventSchema } from './schemas/security-event.schema';
import { SecurityService } from './security.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: SecurityEvent.name, schema: SecurityEventSchema }])],
  controllers: [AdminSecurityController],
  providers: [SecurityService],
  exports: [SecurityService],
})
export class SecurityModule {}
