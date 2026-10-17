import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  ForbiddenException,
  Header,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IfMatchVersion } from '../../common/decorators/if-match-version.decorator';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RequireCustomer } from '../auth/decorators/require-customer.decorator';
import { RequireStaff } from '../auth/decorators/require-staff.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import type { JobDetailView } from '../jobs/job-view';
import { IF_MATCH_HEADER } from '../jobs/jobs.controller';
import { BillingService } from './billing.service';
import {
  CloseJobDto,
  IssueInvoiceDto,
  ListCenterInvoicesQueryDto,
} from './dto/billing.dto';
import type { InvoiceView } from './invoice-view';
import type { Request } from 'express';
import { InvoiceWorkflowService } from './invoice-workflow.service';
import { InvoiceSelectionDto } from './dto/invoice-selection.dto';
import { TransactionalCommand } from '../idempotency/transactional-command.decorator';
import { billingCommandMeta } from './billing-config.controller';
import { BillingWrite } from './billing-write.guard';

const DESK = ['admin', 'manager', 'advisor'] as const;

@ApiTags('billing')
@ApiBearerAuth()
@RequireStaff()
@Controller('v1/jobs/:id')
export class JobBillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly workflow: InvoiceWorkflowService,
  ) {}

  @Get('invoice-options')
  @Roles(...DESK)
  @Permissions('billing:issue')
  @Header('Cache-Control', 'no-store')
  options(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.workflow.options(auth, id);
  }

  @Post('invoice-preview')
  @HttpCode(200)
  @Roles(...DESK)
  @Permissions('billing:issue')
  @TransactionalCommand()
  @Header('Cache-Control', 'no-store')
  preview(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InvoiceSelectionDto,
  ) {
    return this.workflow.preview(auth, id, dto);
  }

  @Post('invoice')
  @Header('Cache-Control', 'no-store')
  @BillingWrite('issue')
  @Roles(...DESK)
  @TransactionalCommand('BILLING_V2_ENABLED')
  @ApiHeader(IF_MATCH_HEADER)
  @ApiOperation({ summary: 'Issue the bill once the vehicle is ready' })
  issue(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IssueInvoiceDto,
    @IfMatchVersion() version?: number,
    @Req() req?: Request,
  ): Promise<InvoiceView> {
    if (this.workflow.enabled)
      return this.workflow.issue(auth, id, dto, billingCommandMeta(req!, dto));
    if (!auth.permissions.includes('billing:manage'))
      throw new ForbiddenException('Billing permission is required');
    return this.billing.issue(auth, id, dto, version);
  }

  @Get('invoice-history')
  @Header('Cache-Control', 'no-store')
  @Roles(...DESK)
  @Permissions('jobs:read')
  history(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.billing.history(a, id);
  }

  @Get('invoice')
  @Header('Cache-Control', 'no-store')
  @Roles(...DESK)
  @Permissions('jobs:read')
  @ApiOperation({ summary: 'The current bill for the job' })
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvoiceView> {
    return this.billing.getForJob(auth, id);
  }

  @Post('close')
  @Header('Cache-Control', 'no-store')
  @BillingWrite('close')
  @HttpCode(HttpStatus.OK)
  @Roles(...DESK)
  @TransactionalCommand('BILLING_V2_ENABLED')
  @ApiHeader(IF_MATCH_HEADER)
  @ApiOperation({ summary: 'Take payment and complete the job' })
  close(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseJobDto,
    @IfMatchVersion() version?: number,
    @Req() req?: Request,
  ): Promise<JobDetailView> {
    if (this.workflow.enabled)
      return this.workflow.close(auth, id, dto, billingCommandMeta(req!, dto));
    if (
      !auth.permissions.includes('jobs:update') ||
      !auth.permissions.includes('billing:manage')
    )
      throw new ForbiddenException(
        'Payment and job update permissions are required',
      );
    return this.billing.close(auth, id, dto, version);
  }
}

@ApiTags('billing')
@ApiBearerAuth()
@RequireStaff()
@Controller('v1/center/invoices')
export class CenterInvoicesController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Roles(...DESK)
  @Permissions('billing:manage')
  @ApiOperation({ summary: 'Bills issued by the center, newest first' })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListCenterInvoicesQueryDto,
  ): Promise<InvoiceView[]> {
    return this.billing.listForCenter(auth, query.status);
  }
}

@ApiTags('me')
@ApiBearerAuth()
@RequireCustomer()
@Controller('v1/me/invoices')
export class CustomerInvoicesController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'My bills, newest first' })
  list(@CurrentAuth() auth: AuthContext): Promise<InvoiceView[]> {
    return this.billing.listForCustomer(auth);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'One bill with lines and payments' })
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvoiceView> {
    return this.billing.getForCustomer(auth, id);
  }
}
