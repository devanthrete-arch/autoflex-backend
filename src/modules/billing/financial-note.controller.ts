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
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RequireCustomer } from '../auth/decorators/require-customer.decorator';
import { RequireFinance } from '../auth/decorators/require-finance.decorator';
import { RequireStaff } from '../auth/decorators/require-staff.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { TransactionalCommand } from '../idempotency/transactional-command.decorator';
import { billingCommandMeta } from './billing-config.controller';
import {
  IssueNoteDto,
  NoteDecisionDto,
  NotePaymentDto,
  ProposeNoteDto,
} from './dto/financial-note.dto';
import { FinancialNoteService } from './financial-note.service';

@Controller('v1/center')
@RequireStaff()
@Roles('admin', 'manager', 'advisor')
@TransactionalCommand()
export class StaffFinancialNoteController {
  constructor(private readonly notes: FinancialNoteService) {}
  @Get('invoices/:id/notes')
  @Permissions('jobs:read')
  @Header('Cache-Control', 'no-store')
  list(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.notes.list(a, id);
  }
  @Post('invoices/:id/notes')
  @Permissions('billing:correct')
  @Header('Cache-Control', 'no-store')
  propose(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ProposeNoteDto,
    @Req() req: Request,
  ) {
    return this.notes.propose(a, id, body, billingCommandMeta(req, body));
  }
  @Post('financial-notes/:id/withdraw')
  @HttpCode(200)
  @Permissions('billing:correct')
  @Header('Cache-Control', 'no-store')
  withdraw(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, never>,
    @Req() req: Request,
  ) {
    return this.notes.withdraw(a, id, billingCommandMeta(req, body));
  }
  @Post('financial-notes/:id/payment')
  @HttpCode(200)
  @Permissions('billing:record-payment')
  @Header('Cache-Control', 'no-store')
  pay(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: NotePaymentDto,
    @Req() req: Request,
  ) {
    return this.notes.pay(a, id, body, billingCommandMeta(req, body));
  }
}
@Controller('v1/me')
@RequireCustomer()
@TransactionalCommand()
export class CustomerFinancialNoteController {
  constructor(private readonly notes: FinancialNoteService) {}
  @Get('invoices/:id/notes')
  @Header('Cache-Control', 'no-store')
  list(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.notes.list(a, id);
  }
  @Post('financial-notes/:id/decision')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  decide(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: NoteDecisionDto,
    @Req() req: Request,
  ) {
    return this.notes.decision(a, id, body, billingCommandMeta(req, body));
  }
}
@Controller('v1/internal')
@RequireFinance()
@TransactionalCommand()
export class FinanceFinancialNoteController {
  constructor(private readonly notes: FinancialNoteService) {}
  @Get('invoices/:id/notes')
  @Header('Cache-Control', 'no-store')
  list(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.notes.list(a, id);
  }
  @Post('financial-notes/:id/issue')
  @Roles('finance_reviewer')
  @Permissions('billing:approve')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  issue(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: IssueNoteDto,
    @Req() req: Request,
  ) {
    return this.notes.issue(a, id, body, billingCommandMeta(req, body));
  }
}
