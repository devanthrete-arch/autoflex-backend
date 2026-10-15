import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { GarageVehicleStatus } from '../../common/enums/garage-vehicle-status.enum';
import { JobStatus } from '../../common/enums/job-status.enum';
import { ServiceCenterStatus } from '../../common/enums/service-center-status.enum';
import { VehicleType } from '../../common/enums/vehicle-type.enum';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { Customer } from '../customers/entities/customer.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { GarageVehicle } from '../customers/entities/garage-vehicle.entity';
import { Vehicle } from '../customers/entities/vehicle.entity';
import { EventsService } from '../events/events.service';
import { CommandIdempotency } from '../idempotency/command-idempotency.entity';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import { StaffProfile } from '../tenancy/entities/staff-profile.entity';
import { CreateJobDto } from './dto/create-job.dto';
import {
  ListIntakeVehiclesDto,
  WalkInAttemptStatusDto,
} from './dto/intake-lookup.dto';
import { ServiceJob } from './entities/service-job.entity';
import {
  canonicalIntakePhone,
  canonicalIntakePlate,
  tryCanonicalPhone,
  tryCanonicalPlate,
} from './intake-identity';

export type IntakeJobReference = {
  id: string;
  jobNumber: string | null;
  status: JobStatus;
};
export type IntakeVehicleView = {
  id: string;
  revision: number;
  registrationNumber: string;
  makeModel: string | null;
  vehicleType: VehicleType | null;
  hasActiveJob: boolean;
  activeJob?: IntakeJobReference;
};
export type WalkInReceipt = {
  kind: 'RETURNING_WALK_IN';
  serviceCenterId: string;
  job: IntakeJobReference;
};

/** Center association validation is not RC/legal ownership verification. */
@Injectable()
export class IntakeService {
  constructor(
    private readonly db: DataSource,
    private readonly events: EventsService,
  ) {}

  authorize(auth: AuthContext): string {
    if (
      auth.actorType !== 'staff' ||
      !auth.staffProfileId ||
      !auth.serviceCenterId ||
      !auth.roles.some((r) => ['admin', 'manager', 'advisor'].includes(r)) ||
      !auth.permissions.includes('jobs:create')
    )
      throw new ForbiddenException();
    return auth.serviceCenterId;
  }

  private async authorizeRead(auth: AuthContext): Promise<string> {
    const center = this.authorize(auth);
    const [staff, row] = await Promise.all([
      this.db.getRepository(StaffProfile).findOne({
        where: {
          id: auth.staffProfileId!,
          serviceCenterId: center,
          isActive: true,
        },
      }),
      this.db
        .getRepository(ServiceCenter)
        .findOne({ where: { id: center, status: ServiceCenterStatus.ACTIVE } }),
    ]);
    if (!staff || !row) throw new ForbiddenException();
    return center;
  }

  async lockCenter(
    manager: EntityManager,
    auth: AuthContext,
  ): Promise<ServiceCenter> {
    const id = this.authorize(auth);
    const staff = await manager.getRepository(StaffProfile).findOne({
      where: {
        id: auth.staffProfileId!,
        serviceCenterId: id,
        isActive: true,
      },
    });
    if (!staff) throw new ForbiddenException();
    const center = await manager
      .getRepository(ServiceCenter)
      .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!center || center.status !== ServiceCenterStatus.ACTIVE)
      throw new NotFoundException();
    return center;
  }

  private conflict(code: string, message: string): never {
    throw new ConflictException({ code, message });
  }
  private invalid(
    message = 'Confirm the customer and vehicle before opening a job',
  ): never {
    throw new BadRequestException({ code: 'INVALID_INTAKE_INPUT', message });
  }

  async customersForPhone(
    manager: EntityManager,
    center: string,
    phone: string,
  ): Promise<Customer[]> {
    const rows = await manager
      .getRepository(Customer)
      .createQueryBuilder('c')
      .where('c.service_center_id = :center', { center })
      .andWhere('c.deleted_at IS NULL')
      .andWhere(
        "(c.phone_canonical = :phone OR (c.phone_canonical IS NULL AND regexp_replace(c.phone, '[^0-9]', '', 'g') IN (:...digits)))",
        { phone, digits: [phone.slice(1), phone.slice(3)] },
      )
      .orderBy('c.id', 'ASC')
      .take(2)
      .getMany();
    if (rows.length > 1)
      this.conflict(
        'CUSTOMER_LOOKUP_AMBIGUOUS',
        'More than one center record matches this phone; contact an authorized manager for resolution',
      );
    if (rows.some((row) => tryCanonicalPhone(row.phone) !== phone))
      this.conflict(
        'CUSTOMER_DATA_REPAIR_REQUIRED',
        'The matching legacy contact has invalid identity data; resolve it before intake',
      );
    return rows;
  }

  async vehiclesForPlate(
    manager: EntityManager,
    center: string,
    plate: string,
  ): Promise<Vehicle[]> {
    const rows = await manager
      .getRepository(Vehicle)
      .createQueryBuilder('v')
      .where('v.service_center_id = :center', { center })
      .andWhere('v.deleted_at IS NULL')
      .andWhere(
        "(v.registration_canonical = :plate OR (v.registration_canonical IS NULL AND upper(regexp_replace(v.registration_number, '[^a-zA-Z0-9]', '', 'g')) = :plate))",
        { plate },
      )
      .orderBy('v.id', 'ASC')
      .take(2)
      .getMany();
    if (rows.length > 1)
      this.conflict(
        'VEHICLE_LOOKUP_AMBIGUOUS',
        'More than one center record matches this vehicle; contact an authorized manager for resolution',
      );
    if (rows.some((row) => tryCanonicalPlate(row.registrationNumber) !== plate))
      this.conflict(
        'VEHICLE_DATA_REPAIR_REQUIRED',
        'The matching legacy vehicle has invalid identity data; resolve it before intake',
      );
    return rows;
  }

  async selectedCustomer(
    manager: EntityManager,
    center: string,
    id: string,
    lock = false,
  ): Promise<Customer> {
    const customer = await manager.getRepository(Customer).findOne({
      where: { id, serviceCenterId: center },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!customer) throw new NotFoundException();
    return customer;
  }

  async lookupCustomer(auth: AuthContext, rawPhone: string) {
    const center = await this.authorizeRead(auth);
    const phone = canonicalIntakePhone(rawPhone);
    const [customer] = await this.customersForPhone(
      this.db.manager,
      center,
      phone,
    );
    if (!customer) return { status: 'NOT_FOUND' as const };
    const linked = customer.customerProfileId
      ? await this.db.getRepository(CustomerProfile).findOne({
          where: { id: customer.customerProfileId },
          select: { id: true },
        })
      : null;
    return {
      status: 'FOUND' as const,
      customer: {
        id: customer.id,
        revision: customer.revision,
        name: customer.name,
        phone,
        accountLinkState: linked
          ? ('ACCOUNT_LINKED' as const)
          : ('LINK_REQUIRED' as const),
      },
    };
  }

  async listVehicles(
    auth: AuthContext,
    customerId: string,
    query: ListIntakeVehiclesDto,
  ) {
    const center = await this.authorizeRead(auth);
    const customer = await this.selectedCustomer(
      this.db.manager,
      center,
      customerId,
    );
    const limit = query.limit ?? 20;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (query.cursor && !isUUID(query.cursor))
    )
      this.invalid('Invalid vehicle page');
    const qb = this.db
      .getRepository(Vehicle)
      .createQueryBuilder('v')
      .where('v.service_center_id = :center AND v.customer_id = :customerId', {
        center,
        customerId,
      })
      .andWhere('v.deleted_at IS NULL')
      .orderBy('v.id', 'ASC')
      .take(limit + 1);
    if (query.cursor) qb.andWhere('v.id > :cursor', { cursor: query.cursor });
    const rows = await qb.getMany();
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      customerRevision: customer.revision,
      items: await Promise.all(page.map((v) => this.vehicleView(auth, v))),
      nextCursor: more ? page[page.length - 1].id : null,
    };
  }

  async lookupVehicle(auth: AuthContext, customerId: string, rawPlate: string) {
    const center = await this.authorizeRead(auth);
    const customer = await this.selectedCustomer(
      this.db.manager,
      center,
      customerId,
    );
    const registrationNumber = canonicalIntakePlate(rawPlate);
    const [vehicle] = await this.vehiclesForPlate(
      this.db.manager,
      center,
      registrationNumber,
    );
    if (!vehicle)
      return {
        status: 'NOT_FOUND' as const,
        registrationNumber,
        customerRevision: customer.revision,
      };
    if (vehicle.customerId !== customer.id) this.ownerConflict();
    return {
      status: 'FOUND' as const,
      vehicle: await this.vehicleView(auth, vehicle),
      customerRevision: customer.revision,
    };
  }

  private async activeJob(
    manager: EntityManager,
    center: string,
    vehicleId: string,
  ) {
    return manager
      .getRepository(ServiceJob)
      .createQueryBuilder('j')
      .where('j.service_center_id = :center AND j.vehicle_id = :vehicleId', {
        center,
        vehicleId,
      })
      .andWhere('j.deleted_at IS NULL')
      .andWhere('CAST(j.status AS text) NOT IN (:...closed)', {
        closed: [JobStatus.COMPLETED, JobStatus.CANCELLED],
      })
      .orderBy('j.created_at', 'ASC')
      .getOne();
  }

  private async vehicleView(
    auth: AuthContext,
    vehicle: Vehicle,
  ): Promise<IntakeVehicleView> {
    const active = await this.activeJob(
      this.db.manager,
      this.authorize(auth),
      vehicle.id,
    );
    return {
      id: vehicle.id,
      revision: vehicle.revision,
      registrationNumber: vehicle.registrationNumber,
      makeModel: vehicle.makeModel,
      vehicleType: vehicle.vehicleType,
      hasActiveJob: !!active,
      ...(active && auth.permissions.includes('jobs:read')
        ? { activeJob: this.reference(active) }
        : {}),
    };
  }

  reference(job: ServiceJob): IntakeJobReference {
    return { id: job.id, jobNumber: job.jobNumber, status: job.status };
  }

  async assertNoActiveJob(
    manager: EntityManager,
    auth: AuthContext,
    vehicleId: string,
  ): Promise<void> {
    const active = await this.activeJob(
      manager,
      this.authorize(auth),
      vehicleId,
    );
    if (active)
      throw new ConflictException({
        code: 'ACTIVE_JOB_EXISTS',
        message: 'This vehicle already has an active visit at this center',
        ...(auth.permissions.includes('jobs:read')
          ? { activeJob: this.reference(active) }
          : {}),
      });
  }

  ownerConflict(): never {
    this.conflict(
      'VEHICLE_CUSTOMER_CONFLICT',
      'This vehicle is already registered to another account. Contact an authorized manager for resolution.',
    );
  }

  private assertType(
    center: ServiceCenter,
    type: VehicleType | null | undefined,
  ): asserts type is VehicleType {
    if (!type)
      throw new UnprocessableEntityException({
        code: 'VEHICLE_TYPE_REQUIRED',
        message: 'Confirm whether this is a two-wheeler or four-wheeler',
      });
    if (
      !Object.values(VehicleType).includes(type) ||
      !center.supportedVehicleTypes.includes(type)
    )
      throw new UnprocessableEntityException({
        code: 'VEHICLE_TYPE_CONFLICT',
        message:
          'The vehicle type is conflicting or is not supported by this center',
      });
  }

  async resolveWalkIn(
    manager: EntityManager,
    auth: AuthContext,
    center: ServiceCenter,
    dto: CreateJobDto,
  ) {
    const legacy = [
      'customerPhone',
      'customerName',
      'vehicleRegistration',
      'vehicleMakeModel',
      'vehicleType',
    ] as const;
    if (
      legacy.some((k) => dto[k] !== undefined) ||
      !dto.customerId ||
      !isUUID(dto.customerId) ||
      !Number.isSafeInteger(dto.customerRevision) ||
      dto.customerRevision! < 1 ||
      dto.customerRevision! > 2147483647
    )
      this.invalid();
    const existing = dto.vehicleId !== undefined;
    if (
      existing
        ? !dto.vehicleId ||
          !isUUID(dto.vehicleId) ||
          !Number.isSafeInteger(dto.vehicleRevision) ||
          dto.vehicleRevision! < 1 ||
          dto.newVehicle !== undefined
        : !dto.newVehicle ||
          dto.vehicleRevision !== undefined ||
          dto.confirmedVehicleType !== undefined
    )
      this.invalid('Choose exactly one existing or new vehicle');
    // Discover stable linked rows, then acquire locks in the shared order:
    // center -> receipt -> profile -> garage -> customer -> center vehicle -> job.
    const before = await this.selectedCustomer(
      manager,
      center.id,
      dto.customerId,
    );
    let linkedProfile: CustomerProfile | null = null;
    if (before.customerProfileId)
      linkedProfile = await manager.getRepository(CustomerProfile).findOne({
        where: { id: before.customerProfileId },
        lock: { mode: 'pessimistic_write' },
      });
    const beforeVehicle = existing
      ? await manager.getRepository(Vehicle).findOne({
          where: { id: dto.vehicleId!, serviceCenterId: center.id },
        })
      : null;
    let garageId = beforeVehicle?.garageVehicleId;
    if (
      !garageId &&
      before.customerProfileId &&
      (beforeVehicle || dto.newVehicle)
    ) {
      const requestedPlate = canonicalIntakePlate(
        beforeVehicle?.registrationNumber ?? dto.newVehicle!.registrationNumber,
      );
      const garages = await manager
        .getRepository(GarageVehicle)
        .createQueryBuilder('g')
        .withDeleted()
        .where('g.customer_profile_id = :profile', {
          profile: before.customerProfileId,
        })
        .andWhere(
          "upper(regexp_replace(g.registration_number, '[\\s-]', '', 'g')) = :plate",
          { plate: requestedPlate },
        )
        .take(2)
        .getMany();
      if (garages.length > 1)
        this.conflict(
          'VEHICLE_LOOKUP_AMBIGUOUS',
          'More than one owner garage record matches this plate; resolve the association',
        );
      garageId = garages[0]?.id;
    }
    const linkedGarage = garageId
      ? await manager.getRepository(GarageVehicle).findOne({
          where: { id: garageId },
          lock: { mode: 'pessimistic_write' },
        })
      : null;
    const customer = await this.selectedCustomer(
      manager,
      center.id,
      dto.customerId,
      true,
    );
    if (customer.revision !== dto.customerRevision)
      this.conflict(
        'CUSTOMER_SELECTION_CHANGED',
        'The customer record changed; find and confirm the customer again',
      );
    if (
      !customer.customerProfileId ||
      !linkedProfile ||
      linkedProfile.id !== customer.customerProfileId
    )
      this.conflict(
        'ACCOUNT_LINK_REQUIRED',
        'Customer registration or verified account linking is required before this intake can proceed',
      );
    if (!customer.phoneCanonical && customer.phone)
      canonicalIntakePhone(customer.phone);
    // Confirmed customer selection cannot bypass a legacy canonical collision.
    const customerPhone = canonicalIntakePhone(customer.phone);
    await this.customersForPhone(manager, center.id, customerPhone);
    let vehicle: Vehicle;
    if (existing) {
      const found = await manager.getRepository(Vehicle).findOne({
        where: { id: dto.vehicleId!, serviceCenterId: center.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!found) throw new NotFoundException();
      if (found.customerId !== customer.id) this.ownerConflict();
      if (found.revision !== dto.vehicleRevision)
        this.conflict(
          'VEHICLE_SELECTION_CHANGED',
          'The vehicle record changed; select and confirm it again',
        );
      vehicle = found;
      if (vehicle.garageVehicleId !== beforeVehicle?.garageVehicleId)
        this.conflict(
          'VEHICLE_SELECTION_CHANGED',
          'The vehicle garage association changed; confirm it again',
        );
      await this.vehiclesForPlate(
        manager,
        center.id,
        canonicalIntakePlate(vehicle.registrationNumber),
      );
      if (
        vehicle.vehicleType &&
        dto.confirmedVehicleType &&
        dto.confirmedVehicleType !== vehicle.vehicleType
      )
        throw new UnprocessableEntityException({
          code: 'VEHICLE_TYPE_CONFLICT',
          message: 'The selected vehicle already has a different known type',
        });
      const type = vehicle.vehicleType ?? dto.confirmedVehicleType;
      this.assertType(center, type);
      if (garageId) {
        const garage = linkedGarage;
        if (vehicle.garageVehicleId && garageId !== vehicle.garageVehicleId)
          this.conflict(
            'VEHICLE_SELECTION_CHANGED',
            'The vehicle garage association changed; confirm it again',
          );
        if (!garage)
          throw new UnprocessableEntityException({
            code: 'VEHICLE_ARCHIVED',
            message:
              'This owner garage vehicle is unavailable or archived; the owner must reactivate it before intake',
          });
        if (
          garage.customerProfileId !== customer.customerProfileId ||
          canonicalIntakePlate(garage.registrationNumber) !==
            canonicalIntakePlate(vehicle.registrationNumber)
        )
          this.ownerConflict();
        if (garage.status !== GarageVehicleStatus.ACTIVE)
          throw new UnprocessableEntityException({
            code: 'VEHICLE_ARCHIVED',
            message:
              'This owner garage vehicle is archived; the owner must reactivate it before intake',
          });
        if (garage.vehicleType !== type)
          throw new UnprocessableEntityException({
            code: 'VEHICLE_TYPE_CONFLICT',
            message:
              'The owner garage has a conflicting vehicle type; resolve it before intake',
          });
      }
      if (!vehicle.vehicleType) {
        await manager
          .getRepository(Vehicle)
          .update(
            { id: vehicle.id, revision: vehicle.revision },
            { vehicleType: type, revision: vehicle.revision + 1 },
          );
        await this.events.writeAuditLog(
          {
            serviceCenterId: center.id,
            entityType: 'Vehicle',
            entityId: vehicle.id,
            action: 'INTAKE_TYPE_CONFIRMED',
            actorStaffProfileId: auth.staffProfileId,
            before: { vehicleType: null, revision: vehicle.revision },
            after: { vehicleType: type, revision: vehicle.revision + 1 },
          },
          manager,
        );
        vehicle.vehicleType = type;
        vehicle.revision++;
      }
    } else {
      const input = dto.newVehicle!;
      const plate = canonicalIntakePlate(input.registrationNumber);
      this.assertType(center, input.vehicleType);
      if (
        input.makeModel !== undefined &&
        (typeof input.makeModel !== 'string' ||
          !input.makeModel.trim() ||
          input.makeModel.length > 255)
      )
        this.invalid('Enter a valid vehicle make/model');
      const [matched] = await this.vehiclesForPlate(manager, center.id, plate);
      if (matched) {
        if (matched.customerId !== customer.id) this.ownerConflict();
        this.conflict(
          'VEHICLE_SELECTION_CHANGED',
          'This plate now has a saved vehicle; select and confirm the existing record',
        );
      }
      if (
        linkedGarage &&
        (linkedGarage.customerProfileId !== customer.customerProfileId ||
          canonicalIntakePlate(linkedGarage.registrationNumber) !== plate)
      )
        this.ownerConflict();
      if (
        garageId &&
        (!linkedGarage || linkedGarage.status !== GarageVehicleStatus.ACTIVE)
      )
        throw new UnprocessableEntityException({
          code: 'VEHICLE_ARCHIVED',
          message:
            'This owner garage vehicle is unavailable or archived; the owner must reactivate it before intake',
        });
      if (linkedGarage && linkedGarage.vehicleType !== input.vehicleType)
        throw new UnprocessableEntityException({
          code: 'VEHICLE_TYPE_CONFLICT',
          message: 'The owner garage has a different known vehicle type',
        });
      vehicle = await manager.getRepository(Vehicle).save(
        manager.getRepository(Vehicle).create({
          serviceCenterId: center.id,
          customerId: customer.id,
          registrationNumber: plate,
          registrationCanonical: plate,
          makeModel: linkedGarage
            ? [linkedGarage.make, linkedGarage.model].filter(Boolean).join(' ')
            : (input.makeModel?.trim() ?? null),
          garageVehicleId: linkedGarage?.id ?? null,
          vehicleType: input.vehicleType,
          revision: 1,
        }),
      );
    }
    await this.assertNoActiveJob(manager, auth, vehicle.id);
    return { customer, vehicle, vehicleType: vehicle.vehicleType! };
  }

  async resolveBooking(
    manager: EntityManager,
    auth: AuthContext,
    center: ServiceCenter,
    profile: CustomerProfile,
    garage: GarageVehicle,
  ) {
    if (
      !profile ||
      !garage ||
      garage.customerProfileId !== profile.id ||
      garage.status !== GarageVehicleStatus.ACTIVE ||
      garage.deletedAt ||
      profile.deletedAt
    )
      throw new UnprocessableEntityException({
        code: 'ACCOUNT_LINK_REQUIRED',
        message:
          'The booking owner or vehicle is unavailable; resolve the account association',
      });
    const phone = canonicalIntakePhone(profile.phone ?? '');
    const plate = canonicalIntakePlate(garage.registrationNumber);
    this.assertType(center, garage.vehicleType);
    const [phoneCustomer] = await this.customersForPhone(
      manager,
      center.id,
      phone,
    );
    const linked = await manager.getRepository(Customer).find({
      where: { serviceCenterId: center.id, customerProfileId: profile.id },
      take: 2,
    });
    if (linked.length > 1)
      this.conflict(
        'CUSTOMER_LOOKUP_AMBIGUOUS',
        'Multiple center records are linked to this account; resolve the association',
      );
    let customer = linked[0] ?? phoneCustomer;
    if (phoneCustomer && customer && phoneCustomer.id !== customer.id)
      this.conflict(
        'CUSTOMER_SELECTION_CHANGED',
        'The booking phone conflicts with another center record; resolve the association',
      );
    if (customer) {
      customer = await this.selectedCustomer(
        manager,
        center.id,
        customer.id,
        true,
      );
      if (!customer.customerProfileId)
        this.conflict(
          'ACCOUNT_LINK_REQUIRED',
          'An existing center record requires verified account linking before check-in',
        );
      if (customer.customerProfileId !== profile.id)
        this.conflict(
          'ACCOUNT_LINK_REQUIRED',
          'The booking does not match the recorded customer account; resolve the association',
        );
    } else {
      customer = await manager.getRepository(Customer).save(
        manager.getRepository(Customer).create({
          serviceCenterId: center.id,
          phone,
          phoneCanonical: phone,
          name: profile.displayName,
          locale: profile.locale,
          customerProfileId: profile.id,
          revision: 1,
        }),
      );
    }
    const [match] = await this.vehiclesForPlate(manager, center.id, plate);
    let vehicle: Vehicle;
    if (match) {
      vehicle = (await manager.getRepository(Vehicle).findOne({
        where: { id: match.id, serviceCenterId: center.id },
        lock: { mode: 'pessimistic_write' },
      }))!;
      if (
        vehicle.customerId !== customer.id ||
        (vehicle.garageVehicleId && vehicle.garageVehicleId !== garage.id)
      )
        this.ownerConflict();
      if (vehicle.vehicleType && vehicle.vehicleType !== garage.vehicleType)
        throw new UnprocessableEntityException({
          code: 'VEHICLE_TYPE_CONFLICT',
          message: 'The center and owner garage have conflicting vehicle types',
        });
      if (!vehicle.garageVehicleId || !vehicle.vehicleType) {
        vehicle.garageVehicleId = garage.id;
        vehicle.vehicleType = garage.vehicleType;
        vehicle.revision++;
        vehicle = await manager.getRepository(Vehicle).save(vehicle);
      }
    } else {
      vehicle = await manager.getRepository(Vehicle).save(
        manager.getRepository(Vehicle).create({
          serviceCenterId: center.id,
          customerId: customer.id,
          registrationNumber: plate,
          registrationCanonical: plate,
          garageVehicleId: garage.id,
          vehicleType: garage.vehicleType,
          make: garage.make,
          model: garage.model,
          variant: garage.variant,
          makeModel: [garage.make, garage.model].filter(Boolean).join(' '),
          chassisNumber: garage.chassisNumber,
          engineNumber: garage.engineNumber,
          revision: 1,
        }),
      );
    }
    await this.assertNoActiveJob(manager, auth, vehicle.id);
    return { customer, vehicle };
  }

  async receiptReference(
    manager: EntityManager,
    auth: AuthContext,
    value: unknown,
  ): Promise<IntakeJobReference> {
    const center = this.authorize(auth);
    if (!value || typeof value !== 'object') throw new NotFoundException();
    const stored = value as Record<string, unknown>;
    let id: unknown = stored.id;
    if (stored.kind !== undefined) {
      if (
        stored.kind !== 'RETURNING_WALK_IN' ||
        stored.serviceCenterId !== center ||
        !stored.job ||
        typeof stored.job !== 'object'
      )
        throw new NotFoundException();
      id = (stored.job as Record<string, unknown>).id;
    }
    if (typeof id !== 'string' || !isUUID(id)) throw new NotFoundException();
    const job = await manager.getRepository(ServiceJob).findOne({
      where: { id, serviceCenterId: center },
      select: { id: true, jobNumber: true, status: true },
    });
    if (!job) throw new NotFoundException();
    return this.reference(job);
  }

  async attemptStatus(auth: AuthContext, dto: WalkInAttemptStatusDto) {
    const center = await this.authorizeRead(auth);
    if (
      !/^[A-Za-z0-9_.:-]{8,128}$/.test(dto.idempotencyKey) ||
      !/^[a-f0-9]{64}$/.test(dto.requestHash)
    )
      this.invalid('Invalid recovery handle');
    const receipt = await this.db.getRepository(CommandIdempotency).findOne({
      where: {
        scope: `staff:${auth.staffProfileId}`,
        idempotencyKey: dto.idempotencyKey,
      },
    });
    if (!receipt || !receipt.responseBody)
      return { status: 'UNRESOLVED' as const };
    if (receipt.requestHash !== dto.requestHash)
      throw new UnprocessableEntityException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'This retry key belongs to a different request',
      });
    if (
      Array.isArray(receipt.responseBody) ||
      receipt.responseBody.kind !== 'RETURNING_WALK_IN'
    )
      return { status: 'UNRESOLVED' as const };
    if (receipt.responseBody.serviceCenterId !== center)
      throw new NotFoundException();
    return {
      status: 'CREATED' as const,
      job: await this.receiptReference(
        this.db.manager,
        auth,
        receipt.responseBody,
      ),
    };
  }
}
