import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { RequireCustomer } from '../auth/decorators/require-customer.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import {
  CompleteMaintenanceItemDto,
  CreateMaintenanceItemDto,
  ListMaintenanceQueryDto,
  SnoozeMaintenanceItemDto,
  UpdateMaintenanceItemDto,
} from './dto/maintenance.dto';
import {
  MaintenanceService,
  type MaintenanceItemView,
} from './maintenance.service';

@ApiTags('me')
@ApiBearerAuth()
@RequireCustomer()
@Controller('v1/me/maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  @ApiOperation({ summary: 'Reminders, most urgent first' })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListMaintenanceQueryDto,
  ): Promise<MaintenanceItemView[]> {
    return this.maintenance.list(auth, query);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateMaintenanceItemDto,
  ): Promise<MaintenanceItemView> {
    return this.maintenance.create(auth, dto);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MaintenanceItemView> {
    return this.maintenance.get(auth, id);
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMaintenanceItemDto,
  ): Promise<MaintenanceItemView> {
    return this.maintenance.update(auth, id, dto);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark done; repeating reminders roll forward' })
  complete(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteMaintenanceItemDto,
  ): Promise<MaintenanceItemView> {
    return this.maintenance.complete(auth, id, dto);
  }

  @Post(':id/snooze')
  @HttpCode(HttpStatus.OK)
  snooze(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SnoozeMaintenanceItemDto,
  ): Promise<MaintenanceItemView> {
    return this.maintenance.snooze(auth, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.maintenance.remove(auth, id);
  }
}
