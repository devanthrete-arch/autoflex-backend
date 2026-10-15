import { RequireStaff } from '../auth/decorators/require-staff.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { BadRequestException } from '@nestjs/common';
import { TransactionalCommand } from '../idempotency/transactional-command.decorator';
import { commandMeta } from '../idempotency/transactional-receipt';
import type { IntakeJobReference } from './intake.service';
import { IfMatchVersion } from '../../common/decorators/if-match-version.decorator';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { CreateJobDto } from './dto/create-job.dto';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { UpdateJobStatusDto } from './dto/update-job-status.dto';
import type { JobDetailView, JobSummaryView } from './job-view';
import { JobsService } from './jobs.service';

export const IF_MATCH_HEADER = {
  name: 'If-Match',
  required: false,
  description: 'Job `version` the change is based on; 409 when stale',
};

@ApiTags('jobs')
@ApiBearerAuth()
@RequireStaff()
@Controller('v1/jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @TransactionalCommand()
  @Roles('admin', 'manager', 'advisor')
  @Permissions('jobs:create')
  @ApiOperation({ summary: 'Open a walk-in job card' })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateJobDto,
    @Req() req: Request,
  ): Promise<IntakeJobReference> {
    const count = req.rawHeaders.filter(
      (value, index) =>
        index % 2 === 0 && value.toLowerCase() === 'idempotency-key',
    ).length;
    if (count !== 1)
      throw new BadRequestException({
        code: 'INVALID_INTAKE_INPUT',
        message: 'Send exactly one Idempotency-Key',
      });
    return this.jobsService.create(auth, dto, commandMeta(req, dto, 201, true));
  }

  @Get()
  @Roles('admin', 'manager', 'advisor', 'technician')
  @Permissions('jobs:read')
  @ApiOperation({ summary: 'List jobs for the authenticated service center' })
  findAll(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListJobsQueryDto,
  ): Promise<{
    data: JobSummaryView[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.jobsService.findAll(auth, query);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'advisor', 'technician')
  @Permissions('jobs:read')
  @ApiOperation({
    summary:
      'Job card with customer, vehicle, lines, approvals, media, timeline',
  })
  findOne(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<JobDetailView> {
    return this.jobsService.findOne(auth, id);
  }

  @Patch(':id')
  @Roles('admin', 'manager', 'advisor')
  @Permissions('jobs:update')
  @ApiHeader(IF_MATCH_HEADER)
  @ApiOperation({ summary: 'Update job fields; status has its own commands' })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobDto,
    @IfMatchVersion() version?: number,
  ): Promise<JobDetailView> {
    return this.jobsService.update(auth, id, dto, version);
  }

  @Patch(':id/status')
  @Roles('admin', 'manager', 'advisor', 'technician')
  @Permissions('jobs:update')
  @ApiHeader(IF_MATCH_HEADER)
  @ApiOperation({
    summary:
      'Move along the floor: INSPECTION, IN_PROGRESS, QUALITY_CHECK, COMPLETED',
  })
  updateStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobStatusDto,
    @IfMatchVersion() version?: number,
  ): Promise<JobDetailView> {
    return this.jobsService.updateStatus(auth, id, dto, version);
  }

  @Delete(':id')
  @Roles('admin')
  @Permissions('jobs:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a job' })
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.jobsService.remove(auth, id);
  }
}
