import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RequireStaff } from '../auth/decorators/require-staff.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import {
  CreateStaffDto,
  ListStaffQueryDto,
  UpdateStaffDto,
} from './dto/staff.dto';
import {
  StaffService,
  type StaffMeView,
  type StaffView,
} from './staff.service';

@ApiTags('staff')
@ApiBearerAuth()
@RequireStaff()
@Controller('v1/staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get('me')
  @ApiOperation({ summary: 'Signed-in staff member, their center and access' })
  me(@CurrentAuth() auth: AuthContext): Promise<StaffMeView> {
    return this.staffService.me(auth);
  }

  @Get()
  @Roles('admin', 'manager', 'advisor')
  @Permissions('staff:read')
  @ApiOperation({ summary: 'Center roster' })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListStaffQueryDto,
  ): Promise<StaffView[]> {
    return this.staffService.list(auth, query);
  }

  @Post()
  @Roles('admin', 'manager')
  @Permissions('staff:manage')
  @ApiOperation({ summary: 'Add an IAM user to the center roster' })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateStaffDto,
  ): Promise<StaffView> {
    return this.staffService.create(auth, dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @Permissions('staff:manage')
  @ApiOperation({ summary: 'Edit a staff profile or deactivate it' })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffDto,
  ): Promise<StaffView> {
    return this.staffService.update(auth, id, dto);
  }
}
