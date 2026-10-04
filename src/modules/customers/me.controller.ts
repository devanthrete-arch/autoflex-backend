import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { RequireCustomer } from '../auth/decorators/require-customer.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { UpsertProfileDto } from './dto/customer-me.dto';
import { MeService } from './me.service';
import { CustomerProfile } from './entities/customer-profile.entity';

@ApiTags('me')
@ApiBearerAuth()
@RequireCustomer()
@Controller('v1/me')
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get customer profile' })
  getProfile(@CurrentAuth() auth: AuthContext): Promise<CustomerProfile> {
    return this.meService.getProfile(auth);
  }

  @Put('profile')
  @ApiOperation({ summary: 'Upsert customer profile' })
  upsertProfile(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: UpsertProfileDto,
  ): Promise<CustomerProfile> {
    return this.meService.upsertProfile(auth, dto);
  }
}
