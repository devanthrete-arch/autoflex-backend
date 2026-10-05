import {
  Body,
  Controller,
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
import { GarageVehicleStatus } from '../../common/enums/garage-vehicle-status.enum';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { RequireCustomer } from '../auth/decorators/require-customer.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import {
  CreateGarageVehicleDto,
  ListGarageVehiclesQueryDto,
  UpdateGarageVehicleDto,
} from './dto/customer-me.dto';
import { GarageService } from './garage.service';
import { GarageVehicle } from './entities/garage-vehicle.entity';

@ApiTags('me')
@ApiBearerAuth()
@RequireCustomer()
@Controller('v1/me/vehicles')
export class GarageController {
  constructor(private readonly garageService: GarageService) {}

  @Get()
  @ApiOperation({ summary: 'List garage vehicles (active by default)' })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListGarageVehiclesQueryDto,
  ): Promise<GarageVehicle[]> {
    return this.garageService.list(auth, query);
  }

  @Post()
  @ApiOperation({ summary: 'Add a garage vehicle' })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateGarageVehicleDto,
  ): Promise<GarageVehicle> {
    return this.garageService.create(auth, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one garage vehicle' })
  getOne(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GarageVehicle> {
    return this.garageService.getOwned(auth, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a garage vehicle' })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGarageVehicleDto,
  ): Promise<GarageVehicle> {
    return this.garageService.update(auth, id, dto);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a garage vehicle; history is kept' })
  archive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GarageVehicle> {
    return this.garageService.setStatus(auth, id, GarageVehicleStatus.ARCHIVED);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore an archived garage vehicle' })
  restore(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GarageVehicle> {
    return this.garageService.setStatus(auth, id, GarageVehicleStatus.ACTIVE);
  }
}
