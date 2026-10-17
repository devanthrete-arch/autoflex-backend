import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { RequireStaff } from '../auth/decorators/require-staff.decorator';
import { RequireCustomer } from '../auth/decorators/require-customer.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { TransactionalCommand } from '../idempotency/transactional-command.decorator';
import { commandMeta } from '../idempotency/transactional-receipt';
import { ReceptionRateLimitGuard } from './reception-rate-limit.guard';
import {
  ConsentRegistrationDto,
  RegistrationChallengeDto,
  StartRegistrationDto,
} from './dto/registration.dto';
import { ReceptionService } from './reception.service';
@Controller('v1/center/registration-sessions')
@RequireStaff()
@Roles('admin', 'manager', 'advisor')
@Permissions('jobs:create', 'customers:register')
@UseGuards(ReceptionRateLimitGuard)
@TransactionalCommand()
export class ReceptionStaffController {
  constructor(private readonly reception: ReceptionService) {}
  @Post()
  @Header('Cache-Control', 'no-store')
  start(
    @CurrentAuth() a: AuthContext,
    @Body() body: StartRegistrationDto,
    @Req() req: Request,
  ) {
    return this.reception.start(
      a,
      body.phone,
      commandMeta(req, body, 201, true),
    );
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  status(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reception.status(a, id);
  }
  @Post(':id/finalize')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  finish(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, never>,
    @Req() req: Request,
  ) {
    return this.reception.finish(a, id, commandMeta(req, body));
  }
  @Post(':id/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  cancel(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, never>,
    @Req() req: Request,
  ) {
    return this.reception.finish(a, id, commandMeta(req, body), true);
  }
}
@UseGuards(ReceptionRateLimitGuard)
@Controller('v1/me/reception-sessions')
@RequireCustomer()
@TransactionalCommand()
export class ReceptionCustomerController {
  constructor(private readonly reception: ReceptionService) {}
  @Post(':id/context')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  context(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RegistrationChallengeDto,
  ) {
    return this.reception.customerContext(a, id, body.challenge);
  }
  @Post(':id/verification')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  verification(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RegistrationChallengeDto,
  ) {
    return this.reception.verification(a, id, body.challenge);
  }
  @Post(':id/consent')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  consent(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ConsentRegistrationDto,
    @Req() req: Request,
  ) {
    return this.reception.consent(a, id, body, commandMeta(req, body));
  }
}
