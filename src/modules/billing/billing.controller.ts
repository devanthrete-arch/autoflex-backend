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

const DESK = ['admin', 'manager', 'advisor'] as const;

@ApiTags('billing')
@ApiBearerAuth()
@RequireStaff()
@Controller('v1/jobs/:id')
export class JobBillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('invoice')
  @Roles(...DESK)
  @Permissions('billing:manage')
  @ApiHeader(IF_MATCH_HEADER)
  @ApiOperation({ summary: 'Issue the bill once the vehicle is ready' })
  issue(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IssueInvoiceDto,
    @IfMatchVersion() version?: number,
  ): Promise<InvoiceView> {
    return this.billing.issue(auth, id, dto, version);
  }

  @Get('invoice')
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
  @HttpCode(HttpStatus.OK)
  @Roles(...DESK)
  @Permissions('jobs:update', 'billing:manage')
  @ApiHeader(IF_MATCH_HEADER)
  @ApiOperation({ summary: 'Take payment and complete the job' })
  close(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseJobDto,
    @IfMatchVersion() version?: number,
  ): Promise<JobDetailView> {
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
  @ApiOperation({ summary: 'My bills, newest first' })
  list(@CurrentAuth() auth: AuthContext): Promise<InvoiceView[]> {
    return this.billing.listForCustomer(auth);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One bill with lines and payments' })
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvoiceView> {
    return this.billing.getForCustomer(auth, id);
  }
}
