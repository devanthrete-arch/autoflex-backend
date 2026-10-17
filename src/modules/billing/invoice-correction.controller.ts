import {
  Body,
  Controller,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { RequireStaff } from '../auth/decorators/require-staff.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { TransactionalCommand } from '../idempotency/transactional-command.decorator';
import { commandMeta } from '../idempotency/transactional-receipt';
import {
  CancelInvoiceDto,
  InvoiceCorrectionService,
} from './invoice-correction.service';
@Controller('v1/center/invoices')
@RequireStaff()
@Roles('admin', 'manager', 'advisor')
@Permissions('billing:correct')
@TransactionalCommand()
export class InvoiceCorrectionController {
  constructor(private readonly correction: InvoiceCorrectionService) {}
  @Post(':id/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  cancel(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelInvoiceDto,
    @Req() req: Request,
  ) {
    return this.correction.cancel(a, id, body, commandMeta(req, body));
  }
}
