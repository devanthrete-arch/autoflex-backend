import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ReceptionRateLimitGuard } from '../../reception/reception-rate-limit.guard';
import type { Response } from 'express';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { RequireCustomer } from '../../auth/decorators/require-customer.decorator';
import { RequireFinance } from '../../auth/decorators/require-finance.decorator';
import { RequireStaff } from '../../auth/decorators/require-staff.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import type { AuthContext } from '../../auth/interfaces/auth-context.interface';
import { TransactionalCommand } from '../../idempotency/transactional-command.decorator';
import { InvoiceDocumentService } from './invoice-document.service';
async function send(
  service: InvoiceDocumentService,
  a: AuthContext,
  id: string,
  res: Response,
  noteDocument = false,
) {
  const file = await service.download(a, id, noteDocument);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${file.filename}"`,
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(file.bytes);
}
@UseGuards(ReceptionRateLimitGuard)
@Controller('v1/me/invoices')
@RequireCustomer()
@TransactionalCommand()
export class CustomerInvoiceDocumentController {
  constructor(private readonly docs: InvoiceDocumentService) {}
  @Get(':id/document') @Header('Cache-Control', 'no-store') status(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.docs.status(a, id);
  }
  @Post(':id/document')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  prepare(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.docs.request(a, id);
  }
  @Get(':id/pdf') @Header('Cache-Control', 'no-store') pdf(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    return send(this.docs, a, id, res);
  }
}
@UseGuards(ReceptionRateLimitGuard)
@Controller('v1/center/invoices')
@RequireStaff()
@Roles('admin', 'manager', 'advisor')
@Permissions('jobs:read')
@TransactionalCommand()
export class StaffInvoiceDocumentController {
  constructor(private readonly docs: InvoiceDocumentService) {}
  @Get(':id/document') @Header('Cache-Control', 'no-store') status(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.docs.status(a, id);
  }
  @Post(':id/document')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  prepare(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.docs.request(a, id);
  }
  @Post(':id/document/retry')
  @HttpCode(200)
  @Permissions('billing:correct')
  @Header('Cache-Control', 'no-store')
  retry(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.docs.retry(a, id);
  }
  @Get(':id/pdf') @Header('Cache-Control', 'no-store') pdf(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    return send(this.docs, a, id, res);
  }
}

@UseGuards(ReceptionRateLimitGuard)
@Controller('v1/me/financial-notes')
@RequireCustomer()
@TransactionalCommand()
export class CustomerFinancialNoteDocumentController {
  constructor(private readonly docs: InvoiceDocumentService) {}
  @Get(':id/document')
  @Header('Cache-Control', 'no-store')
  status(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.docs.status(a, id, true);
  }
  @Post(':id/document')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  request(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.docs.request(a, id, true);
  }
  @Get(':id/pdf')
  @Header('Cache-Control', 'no-store')
  pdf(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    return send(this.docs, a, id, res, true);
  }
}

@UseGuards(ReceptionRateLimitGuard)
@Controller('v1/center/financial-notes')
@RequireStaff()
@Roles('admin', 'manager', 'advisor')
@Permissions('jobs:read')
@TransactionalCommand()
export class StaffFinancialNoteDocumentController {
  constructor(private readonly docs: InvoiceDocumentService) {}
  @Get(':id/document')
  @Header('Cache-Control', 'no-store')
  status(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.docs.status(a, id, true);
  }
  @Post(':id/document')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  request(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.docs.request(a, id, true);
  }
  @Post(':id/document/retry')
  @HttpCode(200)
  @Permissions('billing:correct')
  @Header('Cache-Control', 'no-store')
  retry(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.docs.retry(a, id, true);
  }
  @Get(':id/pdf')
  @Header('Cache-Control', 'no-store')
  pdf(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    return send(this.docs, a, id, res, true);
  }
}

@UseGuards(ReceptionRateLimitGuard)
@Controller('v1/internal/financial-notes')
@RequireFinance()
@Permissions('billing:approve')
@Roles('finance_reviewer')
@TransactionalCommand()
export class FinanceFinancialNoteDocumentController {
  constructor(private readonly docs: InvoiceDocumentService) {}
  @Get(':id/document')
  @Header('Cache-Control', 'no-store')
  status(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.docs.status(a, id, true);
  }
  @Post(':id/document')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  request(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.docs.request(a, id, true);
  }
  @Get(':id/pdf')
  @Header('Cache-Control', 'no-store')
  pdf(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    return send(this.docs, a, id, res, true);
  }
}
