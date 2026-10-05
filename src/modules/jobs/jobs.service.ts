import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { JobEventType } from '../../common/enums/job-event-type.enum';
import { JobPriority } from '../../common/enums/job-priority.enum';
import {
  JobStatus,
  VALID_JOB_TRANSITIONS,
} from '../../common/enums/job-status.enum';
import { JobLineKind, JobLineStatus } from '../../common/enums/job-work.enum';
import { VehicleType } from '../../common/enums/vehicle-type.enum';
import { inr, lineAmount } from '../../common/money';
import { generateReference } from '../../common/reference-number';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { BookingItem } from '../bookings/entities/booking-item.entity';
import { Customer } from '../customers/entities/customer.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { GarageVehicle } from '../customers/entities/garage-vehicle.entity';
import { Vehicle } from '../customers/entities/vehicle.entity';
import { EventsService } from '../events/events.service';
import { StaffProfile } from '../tenancy/entities/staff-profile.entity';
import { CreateJobDto } from './dto/create-job.dto';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { UpdateJobStatusDto } from './dto/update-job-status.dto';
import { JobAssignment } from './entities/job-assignment.entity';
import { JobLineItem } from './entities/job-line-item.entity';
import { ServiceJob } from './entities/service-job.entity';
import { JobStoreService, STAFF_JOB_RELATIONS } from './job-store.service';
import {
  JobDetailView,
  JobSummaryView,
  toJobDetail,
  toJobSummary,
} from './job-view';

export interface OpenFromBookingInput {
  bookingId: string;
  profile: CustomerProfile;
  garageVehicle: GarageVehicle;
  serviceType: string;
  paymentMode: string;
  items?: BookingItem[];
  customerRequest?: string | null;
  odometerKm?: number;
  fuelLevel?: string;
  accessoriesChecklist?: Record<string, unknown>;
  assignedTechnicianId?: string;
  estimatedReadyAt?: Date;
  priority?: JobPriority;
  budgetCeiling?: number;
  waitingOnSite?: boolean;
}

const ALLOWED_SORT_FIELDS: Record<string, string> = {
  createdAt: 'job.created_at',
  updatedAt: 'job.updated_at',
  status: 'job.status',
  priority: 'job.priority',
  estimatedReadyAt: 'job.estimated_ready_at',
};

/**
 * Statuses with their own command, because they carry a reason, a decision,
 * or a check result that a bare status change would lose.
 */
const COMMAND_ONLY_TARGETS: Partial<Record<JobStatus, string>> = {
  [JobStatus.AWAITING_APPROVAL]: 'POST /v1/jobs/:id/approvals',
  [JobStatus.ON_HOLD]: 'POST /v1/jobs/:id/hold',
  [JobStatus.CANCELLED]: 'POST /v1/jobs/:id/cancel',
  [JobStatus.READY_FOR_PICKUP]: 'POST /v1/jobs/:id/qc',
  [JobStatus.COMPLETED]: 'POST /v1/jobs/:id/close',
};

const COMMAND_ONLY_SOURCES: Partial<Record<JobStatus, string>> = {
  [JobStatus.ON_HOLD]: 'POST /v1/jobs/:id/resume',
  [JobStatus.AWAITING_APPROVAL]:
    'the approval decision, or POST /v1/jobs/:id/approvals/:approvalId/withdraw',
};

const TRACKED_FIELDS = [
  'serviceType',
  'odometerKm',
  'fuelLevel',
  'priority',
  'budgetCeiling',
  'accessoriesChecklist',
  'paymentMode',
  'estimatedReadyAt',
  'customerRequest',
  'waitingOnSite',
  'pickupNote',
] as const;

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
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly store: JobStoreService,
    private readonly eventsService: EventsService,
  ) {}

  async create(auth: AuthContext, dto: CreateJobDto): Promise<JobDetailView> {
    const serviceCenterId = this.requireStaffCenter(auth);
    if (dto.assignedTechnicianId) {
      await this.assertStaffInCenter(dto.assignedTechnicianId, serviceCenterId);
    }
    if (dto.comebackOfJobId) {
      const earlier = await this.store.get(
        serviceCenterId,
        dto.comebackOfJobId,
      );
      if (earlier.status !== JobStatus.COMPLETED) {
        throw new UnprocessableEntityException(
          'A comeback must refer to a completed job',
        );
      }
    }

    const customer = await this.findOrCreateCustomer(serviceCenterId, dto);
    const vehicle = await this.findOrCreateVehicle(
      serviceCenterId,
      customer.id,
      dto,
    );

    const saved = await this.dataSource.transaction(async (manager) => {
      const job = await manager.getRepository(ServiceJob).save(
        manager.getRepository(ServiceJob).create({
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
          jobNumber: generateReference('JC'),
          customerRequest: dto.customerRequest ?? null,
          waitingOnSite: dto.waitingOnSite ?? false,
          comebackOfJobId: dto.comebackOfJobId ?? null,
          comebackReason: dto.comebackReason ?? null,
          warrantyIntent: dto.warrantyIntent ?? false,
        }),
      );
      await this.afterOpen(auth, job, manager, {
        comebackOfJobId: dto.comebackOfJobId,
      });
      return job;
    });

    return this.findOne(auth, saved.id);
  }

  /**
   * Opens the job for a booked visit. The center's customer and vehicle
   * copies are found or created and linked to the owner's profile and garage
   * vehicle; booked services become the job's included lines.
   */
  async openFromBooking(
    auth: AuthContext,
    input: OpenFromBookingInput,
  ): Promise<ServiceJob> {
    const serviceCenterId = this.requireStaffCenter(auth);
    if (input.assignedTechnicianId) {
      await this.assertStaffInCenter(
        input.assignedTechnicianId,
        serviceCenterId,
      );
    }
    const { profile, garageVehicle } = input;
    if (!profile.phone) {
      throw new UnprocessableEntityException(
        'The customer has no phone number on their profile',
      );
    }

    let customer = await this.customerRepository.findOne({
      where: { serviceCenterId, phone: profile.phone },
    });
    if (customer) {
      customer.customerProfileId = profile.id;
      customer.name = customer.name ?? profile.displayName;
    } else {
      customer = this.customerRepository.create({
        serviceCenterId,
        phone: profile.phone,
        name: profile.displayName,
        locale: profile.locale,
        customerProfileId: profile.id,
      });
    }
    customer = await this.customerRepository.save(customer);

    const registrationNumber = garageVehicle.registrationNumber;
    let vehicle = await this.vehicleRepository.findOne({
      where: { serviceCenterId, registrationNumber },
    });
    vehicle ??= this.vehicleRepository.create({
      serviceCenterId,
      registrationNumber,
    });
    vehicle.customerId = customer.id;
    vehicle.garageVehicleId = garageVehicle.id;
    vehicle.make = garageVehicle.make;
    vehicle.model = garageVehicle.model;
    vehicle.variant = garageVehicle.variant;
    vehicle.makeModel = [garageVehicle.make, garageVehicle.model]
      .filter(Boolean)
      .join(' ');
    vehicle.chassisNumber =
      garageVehicle.chassisNumber ?? vehicle.chassisNumber;
    vehicle.engineNumber = garageVehicle.engineNumber ?? vehicle.engineNumber;
    vehicle = await this.vehicleRepository.save(vehicle);
    const customerId = customer.id;
    const vehicleId = vehicle.id;

    return this.dataSource.transaction(async (manager) => {
      const jobs = manager.getRepository(ServiceJob);
      const job = await jobs.save(
        jobs.create({
          serviceCenterId,
          customerId,
          vehicleId,
          vehicleType: garageVehicle.vehicleType,
          status: JobStatus.CHECKED_IN,
          serviceType: input.serviceType,
          odometerKm: input.odometerKm ?? null,
          fuelLevel: input.fuelLevel ?? null,
          estimatedReadyAt: input.estimatedReadyAt ?? null,
          assignedTechnicianId: input.assignedTechnicianId ?? null,
          priority: input.priority,
          budgetCeiling:
            input.budgetCeiling !== undefined
              ? String(input.budgetCeiling)
              : null,
          accessoriesChecklist: input.accessoriesChecklist ?? null,
          paymentMode: input.paymentMode,
          publicToken: this.generatePublicToken(),
          sourceBookingId: input.bookingId,
          jobNumber: generateReference('JC'),
          customerRequest: input.customerRequest ?? null,
          waitingOnSite: input.waitingOnSite ?? false,
        }),
      );

      const items = input.items ?? [];
      if (items.length) {
        const lines = manager.getRepository(JobLineItem);
        await lines.save(
          items.map((item) =>
            lines.create({
              jobId: job.id,
              serviceCenterId,
              kind: JobLineKind.LABOUR,
              description: item.name,
              quantity: String(item.quantity),
              unitPriceInr: String(item.priceInr),
              amountInr: lineAmount(item.quantity, item.priceInr),
              status: JobLineStatus.INCLUDED,
              sourceBookingItemId: item.id,
              createdByStaffProfileId: auth.staffProfileId,
            }),
          ),
        );
      }

      await this.afterOpen(auth, job, manager, {
        sourceBookingId: input.bookingId,
      });
      return job;
    });
  }

  async findAll(
    auth: AuthContext,
    query: ListJobsQueryDto,
  ): Promise<{
    data: JobSummaryView[];
    total: number;
    page: number;
    limit: number;
  }> {
    const serviceCenterId = this.requireStaffCenter(auth);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortColumn =
      ALLOWED_SORT_FIELDS[query.sortBy ?? ''] ?? 'job.created_at';
    const sortOrder = query.sortOrder ?? 'DESC';

    const qb = this.jobRepository
      .createQueryBuilder('job')
      .leftJoinAndSelect('job.customer', 'customer')
      .leftJoinAndSelect('job.vehicle', 'vehicle')
      .where('job.service_center_id = :serviceCenterId', { serviceCenterId })
      .andWhere('job.deleted_at IS NULL');

    if (query.status) {
      qb.andWhere('job.status = :status', { status: query.status });
    }
    if (query.active) {
      qb.andWhere('job.status NOT IN (:...closed)', {
        closed: [JobStatus.COMPLETED, JobStatus.CANCELLED],
      });
    }
    if (query.priority) {
      qb.andWhere('job.priority = :priority', { priority: query.priority });
    }
    if (query.assignedTo) {
      const staffId =
        query.assignedTo === 'me' ? auth.staffProfileId : query.assignedTo;
      qb.andWhere('job.assigned_technician_id = :staffId', { staffId });
    }
    if (query.search) {
      qb.andWhere(
        '(customer.phone ILIKE :search OR vehicle.registration_number ILIKE :search OR job.job_number ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    qb.orderBy(sortColumn, sortOrder)
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();
    return { data: rows.map(toJobSummary), total, page, limit };
  }

  async findOne(auth: AuthContext, jobId: string): Promise<JobDetailView> {
    const job = await this.store.get(this.requireStaffCenter(auth), jobId, {
      relations: STAFF_JOB_RELATIONS,
    });
    return toJobDetail(job);
  }

  async update(
    auth: AuthContext,
    jobId: string,
    dto: UpdateJobDto,
    expectedVersion?: number,
  ): Promise<JobDetailView> {
    const serviceCenterId = this.requireStaffCenter(auth);
    const job = await this.store.get(serviceCenterId, jobId, {
      expectedVersion,
    });
    this.store.assertOpen(job);

    const changes: QueryDeepPartialEntity<ServiceJob> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const field of TRACKED_FIELDS) {
      const value = dto[field];
      if (value === undefined) continue;
      const next =
        field === 'budgetCeiling' ? inr(value as number) : (value as unknown);
      const current =
        field === 'budgetCeiling' && job.budgetCeiling !== null
          ? inr(job.budgetCeiling)
          : (job[field] as unknown);
      if (JSON.stringify(current) === JSON.stringify(next)) continue;
      before[field] = current;
      after[field] = next;
      (changes as Record<string, unknown>)[field] = next;
    }

    if (Object.keys(changes).length) {
      await this.store.commit(job, changes);
      await this.eventsService.writeAuditLog({
        serviceCenterId,
        entityType: 'ServiceJob',
        entityId: job.id,
        action: 'UPDATE',
        actorStaffProfileId: auth.staffProfileId,
        before,
        after,
      });
    }

    if (
      dto.assignedTechnicianId !== undefined &&
      dto.assignedTechnicianId !== job.assignedTechnicianId
    ) {
      await this.assign(auth, job.id, dto.assignedTechnicianId);
    }

    return this.findOne(auth, job.id);
  }

  async updateStatus(
    auth: AuthContext,
    jobId: string,
    dto: UpdateJobStatusDto,
    expectedVersion?: number,
  ): Promise<JobDetailView> {
    const serviceCenterId = this.requireStaffCenter(auth);
    const job = await this.store.get(serviceCenterId, jobId, {
      expectedVersion,
    });
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
    const viaTarget = COMMAND_ONLY_TARGETS[dto.status];
    const viaSource = COMMAND_ONLY_SOURCES[fromStatus];
    if (viaTarget || viaSource) {
      throw new UnprocessableEntityException(
        `Use ${viaTarget ?? viaSource} for this change`,
      );
    }

    await this.store.commit(job, { status: dto.status });
    await this.eventsService.appendStatusChange({
      jobId: job.id,
      serviceCenterId,
      fromStatus,
      toStatus: dto.status,
      staffProfileId: auth.staffProfileId,
      note: dto.note,
    });

    return this.findOne(auth, job.id);
  }

  /**
   * Sets or clears the technician, closing the previous assignment row so the
   * history shows who worked on the job and when.
   */
  async assign(
    auth: AuthContext,
    jobId: string,
    staffProfileId: string | null,
    expectedVersion?: number,
  ): Promise<JobDetailView> {
    const serviceCenterId = this.requireStaffCenter(auth);
    const job = await this.store.get(serviceCenterId, jobId, {
      expectedVersion,
    });
    this.store.assertOpen(job);
    const staff = staffProfileId
      ? await this.assertStaffInCenter(staffProfileId, serviceCenterId)
      : null;
    if (job.assignedTechnicianId === staffProfileId) {
      return this.findOne(auth, job.id);
    }

    await this.dataSource.transaction(async (manager) => {
      const now = new Date();
      const assignments = manager.getRepository(JobAssignment);
      await assignments.update(
        { jobId: job.id, unassignedAt: IsNull() },
        { unassignedAt: now },
      );
      if (staffProfileId) {
        await assignments.save(
          assignments.create({
            jobId: job.id,
            serviceCenterId,
            staffProfileId,
            role: 'TECHNICIAN',
            assignedAt: now,
          }),
        );
      }
      const previous = job.assignedTechnicianId;
      await this.store.commit(
        job,
        { assignedTechnicianId: staffProfileId },
        manager,
      );
      await this.eventsService.append(
        {
          jobId: job.id,
          serviceCenterId,
          type: JobEventType.ASSIGNED,
          payload: {
            staffProfileId,
            displayName: staff?.displayName ?? null,
            previousStaffProfileId: previous,
          },
          visibleToCustomer: false,
          staffProfileId: auth.staffProfileId,
        },
        manager,
      );
    });

    return this.findOne(auth, job.id);
  }

  async remove(auth: AuthContext, jobId: string): Promise<void> {
    const serviceCenterId = this.requireStaffCenter(auth);
    const job = await this.store.get(serviceCenterId, jobId);
    await this.jobRepository.softRemove(job);

    await this.eventsService.writeAuditLog({
      serviceCenterId,
      entityType: 'ServiceJob',
      entityId: job.id,
      action: 'DELETE',
      actorStaffProfileId: auth.staffProfileId,
    });
  }

  private async afterOpen(
    auth: AuthContext,
    job: ServiceJob,
    manager: EntityManager,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.eventsService.append(
      {
        jobId: job.id,
        serviceCenterId: job.serviceCenterId,
        type: JobEventType.STATUS_CHANGE,
        toStatus: JobStatus.CHECKED_IN,
        payload: { message: 'Job created', jobNumber: job.jobNumber },
        staffProfileId: auth.staffProfileId,
      },
      manager,
    );
    if (job.assignedTechnicianId) {
      const assignments = manager.getRepository(JobAssignment);
      await assignments.save(
        assignments.create({
          jobId: job.id,
          serviceCenterId: job.serviceCenterId,
          staffProfileId: job.assignedTechnicianId,
          role: 'TECHNICIAN',
          assignedAt: new Date(),
        }),
      );
    }
    const cleaned = Object.fromEntries(
      Object.entries(metadata).filter(([, value]) => value !== undefined),
    );
    await this.eventsService.writeAuditLog(
      {
        serviceCenterId: job.serviceCenterId,
        entityType: 'ServiceJob',
        entityId: job.id,
        action: 'CREATE',
        actorStaffProfileId: auth.staffProfileId,
        metadata: Object.keys(cleaned).length ? cleaned : undefined,
      },
      manager,
    );
  }

  private requireStaffCenter(auth: AuthContext): string {
    if (auth.actorType !== 'staff' || !auth.serviceCenterId) {
      throw new ForbiddenException('Staff token required');
    }
    return auth.serviceCenterId;
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
    const registration = dto.vehicleRegistration
      .replace(/[\s-]/g, '')
      .toUpperCase();
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

  private async assertStaffInCenter(
    staffProfileId: string,
    serviceCenterId: string,
  ): Promise<StaffProfile> {
    const profile = await this.staffProfileRepository.findOne({
      where: { id: staffProfileId, serviceCenterId, isActive: true },
    });
    if (!profile) {
      throw new NotFoundException(
        'Assigned technician not found in this center',
      );
    }
    return profile;
  }

  private generatePublicToken(): string {
    return randomBytes(32).toString('base64url');
  }
}
