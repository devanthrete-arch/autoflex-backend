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
import {
  CommandMeta,
  withCommandReceipt,
} from '../idempotency/transactional-receipt';
import {
  IntakeJobReference,
  IntakeService,
  WalkInReceipt,
} from './intake.service';
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
    private readonly intake: IntakeService,
  ) {}

  async create(
    auth: AuthContext,
    dto: CreateJobDto,
    meta?: CommandMeta,
  ): Promise<IntakeJobReference> {
    this.intake.authorize(auth);
    if (
      !meta?.key ||
      !/^[A-Za-z0-9_.:-]{8,128}$/.test(meta.key) ||
      !/^[a-f0-9]{64}$/.test(meta.hash)
    )
      throw new BadRequestException({
        code: 'INVALID_INTAKE_INPUT',
        message: 'A single valid Idempotency-Key is required',
      });
    return this.dataSource.transaction(async (manager) => {
      const center = await this.intake.lockCenter(manager, auth);
      const value = await withCommandReceipt<WalkInReceipt>(
        manager,
        `staff:${auth.staffProfileId}`,
        meta,
        async () => {
          this.validateIntakeVisit(dto);
          const { customer, vehicle, vehicleType } =
            await this.intake.resolveWalkIn(manager, auth, center, dto);
          if (dto.assignedTechnicianId)
            await this.assertStaffInCenter(
              dto.assignedTechnicianId,
              center.id,
              manager,
            );
          if (dto.comebackOfJobId) {
            const earlier = await manager.getRepository(ServiceJob).findOne({
              where: { id: dto.comebackOfJobId, serviceCenterId: center.id },
              lock: { mode: 'pessimistic_write' },
            });
            if (
              !earlier ||
              earlier.status !== JobStatus.COMPLETED ||
              earlier.customerId !== customer.id ||
              earlier.vehicleId !== vehicle.id
            )
              throw new UnprocessableEntityException({
                code: 'COMEBACK_REFERENCE_INVALID',
                message:
                  'A comeback must refer to a completed visit for this customer and vehicle at this center',
              });
          }
          const repo = manager.getRepository(ServiceJob);
          const job = await repo.save(
            repo.create({
              serviceCenterId: center.id,
              customerId: customer.id,
              vehicleId: vehicle.id,
              vehicleType,
              status: JobStatus.CHECKED_IN,
              serviceType: dto.serviceType.trim(),
              odometerKm: dto.odometerKm ?? null,
              fuelLevel: dto.fuelLevel?.trim() ?? null,
              estimatedReadyAt: dto.estimatedReadyAt ?? null,
              assignedTechnicianId: dto.assignedTechnicianId ?? null,
              priority: dto.priority,
              budgetCeiling:
                dto.budgetCeiling !== undefined
                  ? String(dto.budgetCeiling)
                  : null,
              accessoriesChecklist: dto.accessoriesChecklist ?? null,
              paymentMode: dto.paymentMode?.trim() ?? null,
              publicToken: this.generatePublicToken(),
              jobNumber: generateReference('JC'),
              customerRequest: dto.customerRequest?.trim() ?? null,
              waitingOnSite: dto.waitingOnSite ?? false,
              comebackOfJobId: dto.comebackOfJobId ?? null,
              comebackReason: dto.comebackReason?.trim() ?? null,
              warrantyIntent: dto.warrantyIntent ?? false,
            }),
          );
          await this.afterOpen(auth, job, manager, {
            comebackOfJobId: dto.comebackOfJobId,
            customerId: customer.id,
            vehicleId: vehicle.id,
          });
          return {
            kind: 'RETURNING_WALK_IN',
            serviceCenterId: center.id,
            job: this.intake.reference(job),
          };
        },
        async (receipt) => {
          await this.intake.receiptReference(manager, auth, receipt);
        },
      );
      // Also projects known legacy full-job receipts, without returning old PII/tokens.
      return this.intake.receiptReference(manager, auth, value);
    });
  }

  private validateIntakeVisit(dto: CreateJobDto): void {
    const invalid = () => {
      throw new BadRequestException({
        code: 'INVALID_INTAKE_INPUT',
        message: 'Enter valid bounded visit details',
      });
    };
    if (
      typeof dto.serviceType !== 'string' ||
      !dto.serviceType.trim() ||
      dto.serviceType.length > 128
    )
      invalid();
    for (const [key, max] of [
      ['customerRequest', 2000],
      ['comebackReason', 1000],
      ['fuelLevel', 32],
      ['paymentMode', 32],
    ] as const) {
      const value = dto[key];
      if (
        value !== undefined &&
        (typeof value !== 'string' || value.length > max)
      )
        invalid();
    }
    if (
      dto.odometerKm !== undefined &&
      (!Number.isInteger(dto.odometerKm) ||
        dto.odometerKm < 0 ||
        dto.odometerKm > 2147483647)
    )
      invalid();
    if (
      dto.budgetCeiling !== undefined &&
      (!Number.isFinite(dto.budgetCeiling) ||
        dto.budgetCeiling < 0 ||
        dto.budgetCeiling > 9999999999.99)
    )
      invalid();
    if (
      dto.estimatedReadyAt !== undefined &&
      (!(dto.estimatedReadyAt instanceof Date) ||
        !Number.isFinite(dto.estimatedReadyAt.getTime()))
    )
      invalid();
    if (
      dto.accessoriesChecklist !== undefined &&
      (!dto.accessoriesChecklist ||
        typeof dto.accessoriesChecklist !== 'object' ||
        Array.isArray(dto.accessoriesChecklist) ||
        JSON.stringify(dto.accessoriesChecklist).length > 8192)
    )
      invalid();
  }

  /**
   * Opens the job for a booked visit. The center's customer and vehicle
   * copies are found or created and linked to the owner's profile and garage
   * vehicle; booked services become the job's included lines.
   */
  async openFromBooking(
    auth: AuthContext,
    input: OpenFromBookingInput,
    transaction?: EntityManager,
  ): Promise<ServiceJob> {
    this.intake.authorize(auth);
    if (!transaction)
      return this.dataSource.transaction((manager) =>
        this.openFromBooking(auth, input, manager),
      );
    const manager = transaction;
    const center = await this.intake.lockCenter(manager, auth);
    const serviceCenterId = center.id;
    if (!input.profile || !input.garageVehicle)
      throw new UnprocessableEntityException({
        code: 'ACCOUNT_LINK_REQUIRED',
        message:
          'The booking owner or vehicle is unavailable; resolve the account association',
      });
    const profile = await manager.getRepository(CustomerProfile).findOne({
      where: { id: input.profile.id },
      lock: { mode: 'pessimistic_write' },
    });
    const garageVehicle = await manager.getRepository(GarageVehicle).findOne({
      where: { id: input.garageVehicle.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!profile || !garageVehicle)
      throw new UnprocessableEntityException({
        code: 'ACCOUNT_LINK_REQUIRED',
        message:
          'The booking owner or vehicle is unavailable; resolve the account association',
      });
    if (input.assignedTechnicianId)
      await this.assertStaffInCenter(
        input.assignedTechnicianId,
        serviceCenterId,
        manager,
      );
    const { customer, vehicle } = await this.intake.resolveBooking(
      manager,
      auth,
      center,
      profile,
      garageVehicle,
    );
    const customerId = customer.id;
    const vehicleId = vehicle.id;
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
            scope: item.scope ?? [],
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

  private async assertStaffInCenter(
    staffProfileId: string,
    serviceCenterId: string,
    manager?: EntityManager,
  ): Promise<StaffProfile> {
    const profile = await (
      manager?.getRepository(StaffProfile) ?? this.staffProfileRepository
    ).findOne({
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
