import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RequireCustomer } from '../auth/decorators/require-customer.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { CustomerJobsService } from './customer-jobs.service';
import type { CustomerJobSummary } from './customer-jobs.service';
import { DecideApprovalDto } from './dto/job-work.dto';
import type { CustomerJobView, PublicTrackingView } from './job-view';

@ApiTags('me')
@ApiBearerAuth()
@RequireCustomer()
@Controller('v1/me/jobs')
export class CustomerJobsController {
  constructor(private readonly customerJobs: CustomerJobsService) {}

  @Get()
  @ApiOperation({ summary: 'Service visits on my vehicles' })
  list(@CurrentAuth() auth: AuthContext): Promise<CustomerJobSummary[]> {
    return this.customerJobs.list(auth);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One visit: progress, estimate, photos, requests' })
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerJobView> {
    return this.customerJobs.get(auth, id);
  }

  @Post(':id/approvals/:approvalId/decision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve or decline requested extra work' })
  decide(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Body() dto: DecideApprovalDto,
  ): Promise<CustomerJobView> {
    return this.customerJobs.decide(auth, id, approvalId, dto);
  }
}

@ApiTags('tracking')
@Public()
@Controller('v1/track')
export class TrackingController {
  constructor(private readonly customerJobs: CustomerJobsService) {}

  @Get(['', ':publicToken', '*path'])
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow, noarchive')
  @ApiOperation({ summary: 'Progress for whoever holds the tracking link' })
  track(
    @Param('publicToken') publicToken: string,
  ): Promise<PublicTrackingView> {
    return this.customerJobs.track(publicToken);
  }
}
