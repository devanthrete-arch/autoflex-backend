import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { RequireCustomer } from '../auth/decorators/require-customer.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { CreateGarageVehicleDto } from './dto/customer-me.dto';
import { GarageService } from './garage.service';
import { GarageVehicle } from './entities/garage-vehicle.entity';

@ApiTags('me')
@ApiBearerAuth()
@RequireCustomer()
@Controller('v1/me/vehicles')
export class GarageController {
  constructor(private readonly garageService: GarageService) {}

  @Get()
  @ApiOperation({ summary: 'List garage vehicles' })
  list(@CurrentAuth() auth: AuthContext): Promise<GarageVehicle[]> {
    return this.garageService.list(auth);
  }

  @Post()
  @ApiOperation({ summary: 'Add a garage vehicle' })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateGarageVehicleDto,
  ): Promise<GarageVehicle> {
    return this.garageService.create(auth, dto);
  }
}
