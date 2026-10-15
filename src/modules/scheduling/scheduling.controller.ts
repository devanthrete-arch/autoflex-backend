import {
  Body,
  Controller,
  Get,
  HttpCode,
  Header,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RequireStaff } from '../auth/decorators/require-staff.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { TransactionalCommand } from '../idempotency/transactional-command.decorator';
import { commandMeta } from '../idempotency/transactional-receipt';
import type { BookingSchedule } from './schedule';
import { SchedulingService } from './scheduling.service';

@RequireStaff()
@Roles('admin', 'manager')
@Permissions('center:manage')
@Controller('v1/center/booking-schedule')
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  get(@CurrentAuth() auth: AuthContext) {
    return this.scheduling.get(auth);
  }
  @Post('preview')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @TransactionalCommand()
  preview(
    @CurrentAuth() auth: AuthContext,
    @Body() body: BookingSchedule,
    @Query('date') date?: string,
  ) {
    return this.scheduling.preview(auth, body, date);
  }
  @Put()
  @Header('Cache-Control', 'no-store')
  @TransactionalCommand()
  save(
    @CurrentAuth() auth: AuthContext,
    @Body() body: BookingSchedule,
    @Req() req: Request,
  ) {
    return this.scheduling.save(auth, body, commandMeta(req, body));
  }
}
