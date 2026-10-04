import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  JobStatus,
  VALID_JOB_TRANSITIONS,
} from '../../common/enums/job-status.enum';
import { VehicleType } from '../../common/enums/vehicle-type.enum';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { Customer } from '../customers/entities/customer.entity';
import { Vehicle } from '../customers/entities/vehicle.entity';
import { EventsService } from '../events/events.service';
import { StaffProfile } from '../tenancy/entities/staff-profile.entity';
import { CreateJobDto } from './dto/create-job.dto';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { UpdateJobStatusDto } from './dto/update-job-status.dto';
import { ServiceJob } from './entities/service-job.entity';

const ALLOWED_SORT_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'status',
  'priority',
  'estimatedReadyAt',
]);

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(ServiceJob)
    private readonly jobRepository: Repository<ServiceJob>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Vehicle)
    private readonly vehicleRepository: Repository<Vehicle>,
    @InjectRepository(StaffProfile)
    private readonly staffProfileRepository: Repository<StaffProfile>,
    private readonly eventsService: EventsService,
  ) {}

  async create(auth: AuthContext, dto: CreateJobDto): Promise<ServiceJob> {
    const serviceCenterId = this.requireStaffCenter(auth);
    if (dto.assignedTechnicianId) {
      await this.assertTechnicianInTenant(
        dto.assignedTechnicianId,
        serviceCenterId,
      );
    }

    const customer = await this.findOrCreateCustomer(serviceCenterId, dto);
    const vehicle = await this.findOrCreateVehicle(
      serviceCenterId,
      customer.id,
      dto,
    );

    const job = this.jobRepository.create({
      serviceCenterId,
      customerId: customer.id,
      vehicleId: vehicle.id,
      vehicleType: dto.vehicleType ?? VehicleType.TWO_WHEELER,
      status: JobStatus.CHECKED_IN,
      serviceType: dto.serviceType,
      odometerKm: dto.odometerKm ?? null,
      fuelLevel: dto.fuelLevel ?? null,
      estimatedReadyAt: dto.estimatedReadyAt ?? null,
      assignedTechnicianId: dto.assignedTechnicianId ?? null,
      priority: dto.priority,
      budgetCeiling:
        dto.budgetCeiling !== undefined ? String(dto.budgetCeiling) : null,
      accessoriesChecklist: dto.accessoriesChecklist ?? null,
      paymentMode: dto.paymentMode ?? null,
      publicToken: this.generatePublicToken(),
    });

    const saved = await this.jobRepository.save(job);

    await this.eventsService.appendJobCreated({
      jobId: saved.id,
      serviceCenterId,
      staffProfileId: auth.staffProfileId as string,
    });

    await this.eventsService.writeAuditLog({
      serviceCenterId,
      entityType: 'ServiceJob',
      entityId: saved.id,
      action: 'CREATE',
      actorStaffProfileId: auth.staffProfileId ?? undefined,
    });

    return saved;
  }

  async findAll(
    auth: AuthContext,
    query: ListJobsQueryDto,
  ): Promise<{
    data: ServiceJob[];
    total: number;
    page: number;
    limit: number;
  }> {
    const serviceCenterId = this.requireStaffCenter(auth);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = ALLOWED_SORT_FIELDS.has(query.sortBy ?? '')
      ? (query.sortBy as keyof ServiceJob)
      : 'createdAt';
    const sortOrder = query.sortOrder ?? 'DESC';

    const qb = this.jobRepository
      .createQueryBuilder('job')
      .leftJoinAndSelect('job.customer', 'customer')
      .leftJoinAndSelect('job.vehicle', 'vehicle')
      .where('job.service_center_id = :serviceCenterId', {
        serviceCenterId,
      })
      .andWhere('job.deleted_at IS NULL');

    if (query.status) {
      qb.andWhere('job.status = :status', { status: query.status });
    }

    if (query.priority) {
      qb.andWhere('job.priority = :priority', { priority: query.priority });
    }

    if (query.search) {
      qb.andWhere(
        '(customer.phone ILIKE :search OR vehicle.registration_number ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    const sortColumnMap: Record<string, string> = {
      createdAt: 'job.created_at',
      updatedAt: 'job.updated_at',
      status: 'job.status',
      priority: 'job.priority',
      estimatedReadyAt: 'job.estimated_ready_at',
    };
    qb.orderBy(sortColumnMap[String(sortBy)] ?? 'job.created_at', sortOrder)
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }

  async findOne(auth: AuthContext, jobId: string): Promise<ServiceJob> {
    return this.getJobForTenant(jobId, this.requireStaffCenter(auth), true);
  }

  async update(
    auth: AuthContext,
    jobId: string,
    dto: UpdateJobDto,
  ): Promise<ServiceJob> {
    const serviceCenterId = this.requireStaffCenter(auth);
    const job = await this.getJobForTenant(jobId, serviceCenterId);

    if (dto.assignedTechnicianId) {
      await this.assertTechnicianInTenant(
        dto.assignedTechnicianId,
        serviceCenterId,
      );
    }

    if (dto.serviceType !== undefined) job.serviceType = dto.serviceType;
    if (dto.odometerKm !== undefined) job.odometerKm = dto.odometerKm;
    if (dto.fuelLevel !== undefined) job.fuelLevel = dto.fuelLevel;
    if (dto.priority !== undefined) job.priority = dto.priority;
    if (dto.budgetCeiling !== undefined) {
      job.budgetCeiling = String(dto.budgetCeiling);
    }
    if (dto.accessoriesChecklist !== undefined) {
      job.accessoriesChecklist = dto.accessoriesChecklist;
    }
    if (dto.paymentMode !== undefined) job.paymentMode = dto.paymentMode;
    if (dto.estimatedReadyAt !== undefined) {
      job.estimatedReadyAt = dto.estimatedReadyAt;
    }
    if (dto.assignedTechnicianId !== undefined) {
      job.assignedTechnicianId = dto.assignedTechnicianId;
    }

    const saved = await this.jobRepository.save(job);

    await this.eventsService.writeAuditLog({
      serviceCenterId,
      entityType: 'ServiceJob',
      entityId: saved.id,
      action: 'UPDATE',
      actorStaffProfileId: auth.staffProfileId ?? undefined,
      metadata: { fields: Object.keys(dto) },
    });

    return saved;
  }

  async updateStatus(
    auth: AuthContext,
    jobId: string,
    dto: UpdateJobStatusDto,
  ): Promise<ServiceJob> {
    const serviceCenterId = this.requireStaffCenter(auth);
    const job = await this.getJobForTenant(jobId, serviceCenterId);
    const fromStatus = job.status;

    if (fromStatus === dto.status) {
      throw new BadRequestException('Job is already in the requested status');
    }

    const allowed = VALID_JOB_TRANSITIONS[fromStatus] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new UnprocessableEntityException(
        `Invalid status transition from ${fromStatus} to ${dto.status}`,
      );
    }

    job.status = dto.status;
    if (dto.status === JobStatus.COMPLETED) {
      job.closedAt = new Date();
    }

    const saved = await this.jobRepository.save(job);

    await this.eventsService.appendStatusChange({
      jobId: saved.id,
      serviceCenterId,
      fromStatus,
      toStatus: dto.status,
      staffProfileId: auth.staffProfileId as string,
      note: dto.note,
    });

    return saved;
  }

  async remove(auth: AuthContext, jobId: string): Promise<void> {
    const serviceCenterId = this.requireStaffCenter(auth);
    const job = await this.getJobForTenant(jobId, serviceCenterId);
    await this.jobRepository.softRemove(job);

    await this.eventsService.writeAuditLog({
      serviceCenterId,
      entityType: 'ServiceJob',
      entityId: job.id,
      action: 'DELETE',
      actorStaffProfileId: auth.staffProfileId ?? undefined,
    });
  }

  private requireStaffCenter(auth: AuthContext): string {
    if (auth.actorType !== 'staff' || !auth.serviceCenterId) {
      throw new ForbiddenException('Staff token required');
    }
    return auth.serviceCenterId;
  }

  private async getJobForTenant(
    jobId: string,
    serviceCenterId: string,
    withRelations = false,
  ): Promise<ServiceJob> {
    const job = await this.jobRepository.findOne({
      where: { id: jobId, serviceCenterId },
      relations: withRelations
        ? { customer: true, vehicle: true, events: true }
        : undefined,
    });

    if (!job) {
      throw new NotFoundException();
    }

    return job;
  }

  private async findOrCreateCustomer(
    serviceCenterId: string,
    dto: CreateJobDto,
  ): Promise<Customer> {
    const existing = await this.customerRepository.findOne({
      where: { serviceCenterId, phone: dto.customerPhone },
    });

    if (existing) {
      if (dto.customerName && existing.name !== dto.customerName) {
        existing.name = dto.customerName;
        return this.customerRepository.save(existing);
      }
      return existing;
    }

    const customer = this.customerRepository.create({
      serviceCenterId,
      phone: dto.customerPhone,
      name: dto.customerName ?? null,
    });
    return this.customerRepository.save(customer);
  }

  private async findOrCreateVehicle(
    serviceCenterId: string,
    customerId: string,
    dto: CreateJobDto,
  ): Promise<Vehicle> {
    const registration = dto.vehicleRegistration.toUpperCase();
    const existing = await this.vehicleRepository.findOne({
      where: { serviceCenterId, registrationNumber: registration },
    });

    if (existing) {
      if (dto.vehicleMakeModel && existing.makeModel !== dto.vehicleMakeModel) {
        existing.makeModel = dto.vehicleMakeModel;
        return this.vehicleRepository.save(existing);
      }
      return existing;
    }

    const vehicle = this.vehicleRepository.create({
      serviceCenterId,
      customerId,
      registrationNumber: registration,
      makeModel: dto.vehicleMakeModel ?? null,
    });
    return this.vehicleRepository.save(vehicle);
  }

  private async assertTechnicianInTenant(
    staffProfileId: string,
    serviceCenterId: string,
  ): Promise<void> {
    const profile = await this.staffProfileRepository.findOne({
      where: {
        id: staffProfileId,
        serviceCenterId,
        isActive: true,
      },
    });

    if (!profile) {
      throw new NotFoundException(
        'Assigned technician not found in this center',
      );
    }
  }

  private generatePublicToken(): string {
    return randomBytes(32).toString('base64url');
  }
}
