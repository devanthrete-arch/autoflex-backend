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
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { CreateJobDto } from './dto/create-job.dto';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto';
import {
  JobResponseDto,
  PaginatedJobsResponseDto,
} from './dto/job-response.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { UpdateJobStatusDto } from './dto/update-job-status.dto';
import { ServiceJob } from './entities/service-job.entity';
import { JobsService } from './jobs.service';

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('v1/jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @Roles('admin', 'advisor')
  @Permissions('jobs:create')
  @ApiOperation({ summary: 'Create a service job card' })
  @ApiResponse({ status: 201, type: JobResponseDto })
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateJobDto,
  ): Promise<JobResponseDto> {
    const job = await this.jobsService.create(auth, dto);
    return this.toResponse(job);
  }

  @Get()
  @Roles('admin', 'advisor', 'technician')
  @Permissions('jobs:read')
  @ApiOperation({ summary: 'List jobs for the authenticated service center' })
  @ApiResponse({ status: 200, type: PaginatedJobsResponseDto })
  async findAll(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListJobsQueryDto,
  ): Promise<PaginatedJobsResponseDto> {
    const result = await this.jobsService.findAll(auth, query);
    return {
      ...result,
      data: result.data.map((job) => this.toResponse(job)),
    };
  }

  @Get(':id')
  @Roles('admin', 'advisor', 'technician')
  @Permissions('jobs:read')
  @ApiOperation({ summary: 'Get job detail' })
  @ApiResponse({ status: 200, type: JobResponseDto })
  async findOne(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<JobResponseDto> {
    const job = await this.jobsService.findOne(auth, id);
    return this.toResponse(job);
  }

  @Patch(':id')
  @Roles('admin', 'advisor')
  @Permissions('jobs:update')
  @ApiOperation({ summary: 'Update job fields (not status)' })
  @ApiResponse({ status: 200, type: JobResponseDto })
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobDto,
  ): Promise<JobResponseDto> {
    const job = await this.jobsService.update(auth, id, dto);
    return this.toResponse(job);
  }

  @Patch(':id/status')
  @Roles('admin', 'advisor', 'technician')
  @Permissions('jobs:update')
  @ApiOperation({ summary: 'Transition job workflow status' })
  @ApiResponse({ status: 200, type: JobResponseDto })
  async updateStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobStatusDto,
  ): Promise<JobResponseDto> {
    const job = await this.jobsService.updateStatus(auth, id, dto);
    return this.toResponse(job);
  }

  @Delete(':id')
  @Roles('admin')
  @Permissions('jobs:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a job' })
  @ApiResponse({ status: 204 })
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.jobsService.remove(auth, id);
  }

  private toResponse(job: ServiceJob): JobResponseDto {
    return {
      id: job.id,
      serviceCenterId: job.serviceCenterId,
      customerId: job.customerId,
      vehicleId: job.vehicleId,
      vehicleType: job.vehicleType,
      status: job.status,
      serviceType: job.serviceType,
      odometerKm: job.odometerKm,
      fuelLevel: job.fuelLevel,
      estimatedReadyAt: job.estimatedReadyAt,
      assignedTechnicianId: job.assignedTechnicianId,
      priority: job.priority,
      budgetCeiling: job.budgetCeiling,
      accessoriesChecklist: job.accessoriesChecklist,
      paymentMode: job.paymentMode,
      publicToken: job.publicToken,
      sourceBookingId: job.sourceBookingId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      closedAt: job.closedAt,
    };
  }
}
