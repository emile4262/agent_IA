import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { DashboardService, type DashboardView } from './dashboard.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** Résumé des comptes, des veilles et des envois. */
  @Get()
  overview(): Promise<DashboardView> {
    return this.dashboardService.overview();
  }
}
