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
import { IsIn } from 'class-validator';
import type { Request } from 'express';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { RequireStaff } from '../auth/decorators/require-staff.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { TransactionalCommand } from '../idempotency/transactional-command.decorator';
import { commandMeta } from '../idempotency/transactional-receipt';
import { JobTrackingService, ROTATION_REASONS } from './job-tracking.service';
import type { RotationReason } from './job-tracking.service';

class RotatePublicTokenDto {
  @IsIn(ROTATION_REASONS)
  reason: RotationReason;
}

@RequireStaff()
@Roles('admin', 'manager', 'advisor')
@Controller('v1/jobs/:id/public-token')
export class JobTrackingController {
  constructor(private readonly tracking: JobTrackingService) {}

  @Get()
  @Permissions('jobs:read')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  current(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tracking.current(auth, id);
  }

  @Post('rotate')
  @HttpCode(200)
  @Permissions('jobs:read', 'jobs:update')
  @TransactionalCommand()
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  rotate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RotatePublicTokenDto,
    @Req() req: Request,
  ) {
    // Node may join duplicate headers; inspect raw headers before normalization.
    for (const name of ['if-match', 'idempotency-key']) {
      if (
        req.rawHeaders.filter(
          (_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === name,
        ).length !== 1
      )
        throw new BadRequestException(`Exactly one ${name} header is required`);
    }
    const meta = commandMeta(
      {
        method: req.method,
        headers: req.headers,
        body: req.body,
        originalUrl: `/v1/jobs/${id.toLowerCase()}/public-token/rotate`,
      },
      { reason: dto.reason },
    );
    if (!meta.version || meta.version > 2147483647)
      throw new BadRequestException('If-Match exceeds the job version range');
    return this.tracking.rotate(auth, id, dto.reason, meta);
  }
}
