import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RequireFinance } from '../auth/decorators/require-finance.decorator';
import { RequireStaff } from '../auth/decorators/require-staff.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { TransactionalCommand } from '../idempotency/transactional-command.decorator';
import { commandMeta } from '../idempotency/transactional-receipt';
import { BillingConfigService } from './billing-config.service';
import {
  ApproveBillingConfigurationDto,
  CreateBillingConfigurationDto,
  SuspendBillingConfigurationDto,
} from './dto/billing-config.dto';

export function billingCommandMeta(req: Request, body: unknown) {
  for (const name of ['if-match', 'idempotency-key']) {
    let count = 0;
    for (let index = 0; index < req.rawHeaders.length; index += 2)
      if (req.rawHeaders[index].toLowerCase() === name) count++;
    if (count !== 1) throw new BadRequestException(`Send exactly one ${name}`);
  }
  return commandMeta(req, body);
}

@RequireFinance()
@Controller('v1/internal/centers/:centerId/billing-configurations')
export class BillingConfigController {
  constructor(private readonly billing: BillingConfigService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentAuth() auth: AuthContext,
    @Param('centerId', ParseUUIDPipe) centerId: string,
  ) {
    return this.billing.list(auth, centerId);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @Permissions('billing:configure')
  @Roles('finance_operator', 'finance_reviewer')
  @HttpCode(200)
  @TransactionalCommand()
  create(
    @CurrentAuth() auth: AuthContext,
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Body() dto: CreateBillingConfigurationDto,
    @Req() req: Request,
  ) {
    return this.billing.create(
      auth,
      centerId,
      dto,
      billingCommandMeta(req, dto),
    );
  }

  @Post(':id/approve')
  @Header('Cache-Control', 'no-store')
  @Permissions('billing:approve')
  @Roles('finance_reviewer')
  @HttpCode(200)
  @TransactionalCommand()
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveBillingConfigurationDto,
    @Req() req: Request,
  ) {
    return this.billing.approve(
      auth,
      centerId,
      id,
      dto,
      billingCommandMeta(req, dto),
    );
  }

  @Post(':id/suspend')
  @Header('Cache-Control', 'no-store')
  @Permissions('billing:approve')
  @Roles('finance_reviewer')
  @HttpCode(200)
  @TransactionalCommand()
  suspend(
    @CurrentAuth() auth: AuthContext,
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendBillingConfigurationDto,
    @Req() req: Request,
  ) {
    return this.billing.suspend(
      auth,
      centerId,
      id,
      dto,
      billingCommandMeta(req, dto),
    );
  }
}

@RequireStaff()
@Roles('admin', 'manager', 'advisor')
@Permissions('jobs:read')
@Controller('v1/center/billing-readiness')
export class BillingReadinessController {
  constructor(private readonly billing: BillingConfigService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  get(@CurrentAuth() auth: AuthContext) {
    return this.billing.readiness(auth);
  }
}
