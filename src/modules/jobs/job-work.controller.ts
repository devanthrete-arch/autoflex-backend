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
  Put,
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
import { RequireStaff } from '../auth/decorators/require-staff.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import {
  AddJobMediaDto,
  AddJobNoteDto,
  AssignJobDto,
  CancelJobDto,
  CreateLineItemDto,
  HoldJobDto,
  OverrideApprovalDto,
  RecordInspectionDto,
  RecordQcDto,
  SkipStepDto,
  RequestApprovalDto,
  UpdateJobMediaDto,
} from './dto/job-work.dto';
import { JobEstimateService } from './job-estimate.service';
import { JobMediaService } from './job-media.service';
import type {
  JobDetailView,
  LineItemView,
  MediaView,
  TimelineEntryView,
} from './job-view';
import { JobWorkflowService } from './job-workflow.service';
import { JobsService } from './jobs.service';
import { IF_MATCH_HEADER } from './jobs.controller';

const FLOOR = ['admin', 'manager', 'advisor', 'technician'] as const;
const DESK = ['admin', 'manager', 'advisor'] as const;

/** Job commands. Each returns the refreshed job card unless noted. */
@ApiTags('jobs')
@ApiBearerAuth()
@RequireStaff()
@Controller('v1/jobs/:id')
export class JobWorkController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly workflow: JobWorkflowService,
    private readonly estimate: JobEstimateService,
    private readonly media: JobMediaService,
  ) {}

  @Post('hold')
  @HttpCode(HttpStatus.OK)
  @Roles(...FLOOR)
  @Permissions('jobs:update')
  @ApiHeader(IF_MATCH_HEADER)
  @ApiOperation({ summary: 'Put the job on hold with a reason' })
  hold(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HoldJobDto,
    @IfMatchVersion() version?: number,
  ): Promise<JobDetailView> {
    return this.workflow.hold(auth, id, dto, version);
  }

  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @Roles(...FLOOR)
  @Permissions('jobs:update')
  @ApiHeader(IF_MATCH_HEADER)
  @ApiOperation({ summary: 'Resume to the status the job was held in' })
  resume(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatchVersion() version?: number,
  ): Promise<JobDetailView> {
    return this.workflow.resume(auth, id, version);
  }

  @Post('skip')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'manager', 'advisor')
  @Permissions('jobs:update')
  @ApiHeader(IF_MATCH_HEADER)
  @ApiOperation({ summary: 'Express path: skip inspection or QC' })
  skip(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SkipStepDto,
    @IfMatchVersion() version?: number,
  ): Promise<JobDetailView> {
    return this.workflow.skip(auth, id, dto, version);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(...DESK)
  @Permissions('jobs:update')
  @ApiHeader(IF_MATCH_HEADER)
  @ApiOperation({ summary: 'Cancel the job with a reason' })
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelJobDto,
    @IfMatchVersion() version?: number,
  ): Promise<JobDetailView> {
    return this.workflow.cancel(auth, id, dto, version);
  }

  @Put('inspection')
  @Roles(...FLOOR)
  @Permissions('jobs:update')
  @ApiHeader(IF_MATCH_HEADER)
  @ApiOperation({ summary: 'Save the inspection checklist' })
  inspection(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordInspectionDto,
    @IfMatchVersion() version?: number,
  ): Promise<JobDetailView> {
    return this.workflow.recordInspection(auth, id, dto, version);
  }

  @Post('qc')
  @HttpCode(HttpStatus.OK)
  @Roles(...FLOOR)
  @Permissions('jobs:update')
  @ApiHeader(IF_MATCH_HEADER)
  @ApiOperation({ summary: 'Record the quality check result' })
  qc(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordQcDto,
    @IfMatchVersion() version?: number,
  ): Promise<JobDetailView> {
    return this.workflow.recordQc(auth, id, dto, version);
  }

  @Post('notes')
  @Roles(...FLOOR)
  @Permissions('jobs:update')
  @ApiOperation({ summary: 'Add a timeline note; returns the entry' })
  note(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddJobNoteDto,
  ): Promise<TimelineEntryView> {
    return this.workflow.addNote(auth, id, dto);
  }

  @Post('assign')
  @HttpCode(HttpStatus.OK)
  @Roles(...DESK)
  @Permissions('jobs:update')
  @ApiHeader(IF_MATCH_HEADER)
  @ApiOperation({ summary: 'Assign or unassign the technician' })
  assign(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignJobDto,
    @IfMatchVersion() version?: number,
  ): Promise<JobDetailView> {
    return this.jobsService.assign(
      auth,
      id,
      dto.staffProfileId ?? null,
      version,
    );
  }

  @Get('line-items')
  @Roles(...FLOOR)
  @Permissions('jobs:read')
  @ApiOperation({ summary: 'Line items on the job' })
  lines(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LineItemView[]> {
    return this.estimate.listLines(auth, id);
  }

  @Post('line-items')
  @Roles(...DESK)
  @Permissions('jobs:update')
  @ApiHeader(IF_MATCH_HEADER)
  @ApiOperation({
    summary: 'Add agreed scope before work starts; returns the line',
  })
  addLine(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateLineItemDto,
    @IfMatchVersion() version?: number,
  ): Promise<LineItemView> {
    return this.estimate.addIncludedLine(auth, id, dto, version);
  }

  @Delete('line-items/:lineId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...DESK)
  @Permissions('jobs:update')
  @ApiHeader(IF_MATCH_HEADER)
  @ApiOperation({ summary: 'Remove an agreed-scope line before work starts' })
  async removeLine(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @IfMatchVersion() version?: number,
  ): Promise<void> {
    await this.estimate.removeIncludedLine(auth, id, lineId, version);
  }

  @Post('approvals')
  @Roles(...DESK)
  @Permissions('jobs:update')
  @ApiHeader(IF_MATCH_HEADER)
  @ApiOperation({ summary: 'Ask the owner to approve extra work' })
  async requestApproval(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestApprovalDto,
    @IfMatchVersion() version?: number,
  ): Promise<JobDetailView> {
    await this.estimate.requestApproval(auth, id, dto, version);
    return this.jobsService.findOne(auth, id);
  }

  @Post('approvals/:approvalId/override')
  @HttpCode(HttpStatus.OK)
  @Roles(...DESK)
  @Permissions('jobs:update', 'approvals:override')
  @ApiOperation({ summary: 'Record a decision given by phone or in person' })
  async override(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Body() dto: OverrideApprovalDto,
  ): Promise<JobDetailView> {
    await this.estimate.override(auth, id, approvalId, dto);
    return this.jobsService.findOne(auth, id);
  }

  @Post('approvals/:approvalId/withdraw')
  @HttpCode(HttpStatus.OK)
  @Roles(...DESK)
  @Permissions('jobs:update')
  @ApiOperation({ summary: 'Withdraw a request the owner has not answered' })
  async withdraw(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
  ): Promise<JobDetailView> {
    await this.estimate.withdraw(auth, id, approvalId);
    return this.jobsService.findOne(auth, id);
  }

  @Get('media')
  @Roles(...FLOOR)
  @Permissions('jobs:read')
  @ApiOperation({ summary: 'Photos and videos on the job' })
  listMedia(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MediaView[]> {
    return this.media.list(auth, id);
  }

  @Post('media')
  @Roles(...FLOOR)
  @Permissions('jobs:update')
  @ApiOperation({
    summary: 'Register a photo or video; upload, then confirm',
  })
  addMedia(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddJobMediaDto,
  ): Promise<MediaView> {
    return this.media.add(auth, id, dto);
  }

  @Post('media/:mediaId/confirm')
  @HttpCode(HttpStatus.OK)
  @Roles(...FLOOR)
  @Permissions('jobs:update')
  @ApiOperation({ summary: 'Mark an upload as stored' })
  confirmMedia(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ): Promise<MediaView> {
    return this.media.confirm(auth, id, mediaId);
  }

  @Patch('media/:mediaId')
  @Roles(...FLOOR)
  @Permissions('jobs:update')
  @ApiOperation({ summary: 'Edit caption or customer visibility' })
  updateMedia(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Body() dto: UpdateJobMediaDto,
  ): Promise<MediaView> {
    return this.media.update(auth, id, mediaId, dto);
  }

  @Delete('media/:mediaId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...DESK)
  @Permissions('jobs:update')
  @ApiOperation({ summary: 'Remove a photo or video' })
  async removeMedia(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ): Promise<void> {
    await this.media.remove(auth, id, mediaId);
  }
}
