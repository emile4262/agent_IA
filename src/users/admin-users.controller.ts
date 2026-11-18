import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ListUsersQueryDto, SetUserStatusDto } from './dto/users.dto';
import { UsersService, type AdminUserView, type Paginated } from './users.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Liste des inscrits, du plus récent au plus ancien. */
  @Get()
  list(@Query() query: ListUsersQueryDto): Promise<Paginated<AdminUserView>> {
    return this.usersService.list(query.page, query.limit);
  }

  /** Désactiver (active: false) ou réactiver (active: true) un compte. */
  @Patch(':id/status')
  setStatus(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() dto: SetUserStatusDto,
  ): Promise<AdminUserView> {
    return this.usersService.setActive(admin.id, id, dto.active);
  }
}
