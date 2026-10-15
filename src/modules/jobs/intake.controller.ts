import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RequireStaff } from '../auth/decorators/require-staff.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { TransactionalCommand } from '../idempotency/transactional-command.decorator';
import {
  ListIntakeVehiclesDto,
  LookupIntakeCustomerDto,
  LookupIntakeVehicleDto,
  WalkInAttemptStatusDto,
} from './dto/intake-lookup.dto';
import { IntakeRateLimitGuard } from './intake-rate-limit.guard';
import { IntakeService } from './intake.service';

@ApiTags('center')
@ApiBearerAuth()
@RequireStaff()
@Roles('admin', 'manager', 'advisor')
@Permissions('jobs:create')
@UseGuards(IntakeRateLimitGuard)
@TransactionalCommand() // POST transport, read-only semantics: never global receipts.
@Controller('v1/center')
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  @Post('customers/lookup')
  @HttpCode(200)
  lookupCustomer(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: LookupIntakeCustomerDto,
  ) {
    return this.intake.lookupCustomer(auth, dto.phone);
  }

  @Get('customers/:id/vehicles')
  vehicles(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListIntakeVehiclesDto,
  ) {
    return this.intake.listVehicles(auth, id, query);
  }

  @Post('customers/:id/vehicle-lookup')
  @HttpCode(200)
  lookupVehicle(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LookupIntakeVehicleDto,
  ) {
    return this.intake.lookupVehicle(auth, id, dto.registrationNumber);
  }

  @Post('walk-ins/attempt-status')
  @HttpCode(200)
  attemptStatus(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: WalkInAttemptStatusDto,
  ) {
    return this.intake.attemptStatus(auth, dto);
  }
}
