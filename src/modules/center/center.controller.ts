import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RequireStaff } from '../auth/decorators/require-staff.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import type { DayHours } from '../tenancy/tenancy.service';
import { CenterService, type CenterView } from './center.service';
import { PutHoursDto, UpdateCenterDto } from './dto/center.dto';

@ApiTags('center')
@ApiBearerAuth()
@RequireStaff()
@Controller('v1/center')
export class CenterController {
  constructor(private readonly centerService: CenterService) {}

  @Get()
  @ApiOperation({ summary: "The caller's service center profile" })
  get(@CurrentAuth() auth: AuthContext): Promise<CenterView> {
    return this.centerService.get(auth);
  }

  @Patch()
  @Roles('admin', 'manager')
  @Permissions('center:manage')
  @ApiOperation({ summary: 'Edit the center profile and booking settings' })
  update(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: UpdateCenterDto,
  ): Promise<CenterView> {
    return this.centerService.update(auth, dto);
  }

  @Get('hours')
  @ApiOperation({ summary: 'Weekly operating hours, Sunday first' })
  getHours(@CurrentAuth() auth: AuthContext): Promise<DayHours[]> {
    return this.centerService.getHours(auth);
  }

  @Put('hours')
  @Roles('admin', 'manager')
  @Permissions('center:manage')
  @ApiOperation({ summary: 'Set operating hours for one or more weekdays' })
  putHours(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: PutHoursDto,
  ): Promise<DayHours[]> {
    return this.centerService.putHours(auth, dto);
  }
}
