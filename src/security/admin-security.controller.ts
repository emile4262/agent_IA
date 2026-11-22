import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { SecuritySummaryQueryDto } from './dto/security.dto';
import { SecurityService, type SecuritySummary } from './security.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/security')
export class AdminSecurityController {
  constructor(private readonly securityService: SecurityService) {}

  /** Connexions échouées, blocages, accès refusés et scans des derniers jours, par type et par adresse IP. */
  @Get()
  summary(@Query() query: SecuritySummaryQueryDto): Promise<SecuritySummary> {
    return this.securityService.summary(query.days);
  }
}
