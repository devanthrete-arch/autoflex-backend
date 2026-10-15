import {
  assertCalendarDate,
  assertCanonicalSlot,
  bookingWindow,
  canonicalSlots,
  slotRefusal,
} from '../scheduling/schedule';
import {
  CommandMeta,
  withCommandReceipt,
} from '../idempotency/transactional-receipt';
import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  LessThan,
  MoreThan,
  Repository,
} from 'typeorm';
import { BookingMode } from '../../common/enums/booking-mode.enum';
import { BookingParty } from '../../common/enums/booking-party.enum';
import {
  BookingStatus,
  OPEN_BOOKING_STATUSES,
} from '../../common/enums/booking-status.enum';
import { PaymentMode } from '../../common/enums/payment-mode.enum';
import { GarageVehicleStatus } from '../../common/enums/garage-vehicle-status.enum';
import { ServiceCenterStatus } from '../../common/enums/service-center-status.enum';
import { istDayRange, istToday, toIstParts } from '../../common/time/ist';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { GarageService } from '../customers/garage.service';
import { GarageVehicle } from '../customers/entities/garage-vehicle.entity';
import { MeService } from '../customers/me.service';
import { assertBookingEligibility } from '../customers/booking-eligibility';
import { OfferingsService } from '../offerings/offerings.service';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import { TenancyService } from '../tenancy/tenancy.service';
import {
  BookingAttachmentView,
  BookingView,
  generateBookingNumber,
  toBookingView,
} from './booking-view';
import {
  CancelBookingDto,
  CreateAttachmentDto,
  CreateBookingDto,
  ListSlotsQueryDto,
  ValidateBookingSelectionDto,
} from './dto/create-booking.dto';
import { BookingAttachment } from './entities/booking-attachment.entity';
import { BookingItem } from './entities/booking-item.entity';
import { Booking } from './entities/booking.entity';

const SELF_CHECKIN_ESTIMATE_INR = 2499;
const MAX_ATTACHMENTS = 5;

/** Statuses that occupy capacity in a slot. */
const SLOT_HOLDING_STATUSES = [
  ...OPEN_BOOKING_STATUSES,
  BookingStatus.CHECKED_IN,
];

export const BOOKING_DETAIL_RELATIONS = {
  serviceCenter: true,
  vehicle: true,
  items: true,
  attachments: true,
} as const;

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(ServiceCenter)
    private readonly centerRepository: Repository<ServiceCenter>,
    @InjectRepository(BookingAttachment)
    private readonly attachmentRepository: Repository<BookingAttachment>,
    private readonly garageService: GarageService,
    private readonly meService: MeService,
    private readonly tenancyService: TenancyService,
    private readonly offeringsService: OfferingsService,
    private readonly dataSource: DataSource,
  ) {}

  async bookingOptions(centerId: string) {
    const center = await this.requireBookableCenter(centerId);
    return {
      modes: [
        {
          id: BookingMode.SELF_CHECKIN,
          label: "I'll visit the center",
          estimateInr: SELF_CHECKIN_ESTIMATE_INR,
        },
      ],
      autoAccept: center.autoAccept,
      slotCapacity: center.slotCapacity,
    };
  }

  async validateSelection(centerId: string, dto: ValidateBookingSelectionDto) {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      // One committed snapshot of the center, services and packages, without
      // queuing public reads on the row lock used by reservations/menu edits.
      await manager.query('SET TRANSACTION READ ONLY');
      const center = await this.requireBookableCenter(
        centerId,
        manager.getRepository(ServiceCenter),
      );
      return this.offeringsService.validateSelections(
        manager,
        center,
        dto.selections,
        dto.vehicleType,
      );
    });
  }

  private assertActiveVehicle(vehicle: GarageVehicle) {
    if (vehicle.status !== GarageVehicleStatus.ACTIVE)
      throw new ConflictException({
        code: 'BOOKING_VEHICLE_UNAVAILABLE',
        message:
          'This vehicle is archived. Restore it or choose another vehicle before booking.',
      });
  }

  async listSlots(centerId: string, query: ListSlotsQueryDto) {
    const date = query.date ?? istToday();
    assertCalendarDate(date);
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const center = await this.requireBookableCenter(
        centerId,
        manager.getRepository(ServiceCenter),
      );
      const hours = await this.tenancyService.getHoursForDate(
        center,
        date,
        manager,
      );
      const intervals =
        hours.intervals ??
        (hours.isClosed || !hours.openTime || !hours.closeTime
          ? []
          : [{ open: hours.openTime, close: hours.closeTime }]);
      const { start, end } = istDayRange(date);
      const held = await manager.getRepository(Booking).find({
        where: {
          serviceCenterId: centerId,
          status: In(SLOT_HOLDING_STATUSES),
          slotStart: LessThan(end),
          slotEnd: MoreThan(start),
        },
      });
      const now = Date.now();
      const policy = {
        leadMinutes: center.bookingLeadMinutes,
        advanceDays: center.bookingAdvanceDays,
      };
      const slots = canonicalSlots(date, intervals).map((slot) => {
        const remaining = Math.max(
          0,
          center.slotCapacity -
            held.filter(
              (row) => +row.slotStart < +slot.end && +row.slotEnd > +slot.start,
            ).length,
        );
        const reason =
          slotRefusal(policy, slot.start, now) ?? (remaining ? null : 'FULL');
        return {
          start: slot.start.toISOString(),
          end: slot.end.toISOString(),
          remaining,
          available: !reason,
          reason,
        };
      });
      return {
        date,
        closed: !intervals.length,
        slots,
        scheduleRevision: center.scheduleRevision,
        timeZone: 'Asia/Kolkata',
        slotMinutes: 60,
        leadMinutes: policy.leadMinutes,
        ...bookingWindow(policy.advanceDays, now),
        serverNow: new Date(now).toISOString(),
      };
    });
  }

  async create(
    auth: AuthContext,
    dto: CreateBookingDto,
    meta?: CommandMeta,
  ): Promise<BookingView> {
    if (dto.mode !== BookingMode.SELF_CHECKIN) {
      throw new BadRequestException('Only SELF_CHECKIN is available in v1');
    }
    const profile = await this.meService.ensureProfile(auth);
    const slotStart = new Date(dto.slotStart);
    const slotEnd = new Date(dto.slotEnd);
    const receipt = await this.dataSource.transaction(async (manager) => {
      const lockedCenter = await this.offeringsService.lockCenter(
        manager,
        dto.serviceCenterId,
      );
      const reserve = async () => {
        assertBookingEligibility(profile.dateOfBirth);
        await this.garageService.getOwned(auth, dto.vehicleId);
        // Lock order is center, then vehicle. Archive/ownership changes must not race a reservation.
        const currentVehicle = await manager
          .getRepository(GarageVehicle)
          .findOne({
            where: { id: dto.vehicleId, customerProfileId: profile.id },
            lock: { mode: 'pessimistic_write' },
          });
        if (!currentVehicle) throw new NotFoundException('Vehicle not found');
        this.assertActiveVehicle(currentVehicle);
        if (
          lockedCenter.status !== ServiceCenterStatus.ACTIVE ||
          !lockedCenter.bookingEnabled
        )
          throw new NotFoundException();
        if (
          !lockedCenter.supportedVehicleTypes.includes(
            currentVehicle.vehicleType,
          )
        )
          throw new BadRequestException(
            'This center is no longer available for this vehicle',
          );
        await this.assertWithinHours(lockedCenter, slotStart, slotEnd, manager);
        const offerings = await this.offeringsService.snapshotSelections(
          manager,
          lockedCenter,
          currentVehicle.vehicleType,
          dto.selections ?? [],
          dto.offeringIds ?? [],
        );
        const estimate = offerings.length
          ? offerings.reduce(
              (paise, item) => paise + Math.round(Number(item.priceInr) * 100),
              0,
            ) / 100
          : (dto.estimateInr ?? SELF_CHECKIN_ESTIMATE_INR);
        const held = await manager.getRepository(Booking).count({
          where: {
            serviceCenterId: lockedCenter.id,
            slotStart: LessThan(slotEnd),
            slotEnd: MoreThan(slotStart),
            status: In(SLOT_HOLDING_STATUSES),
          },
        });
        if (held >= lockedCenter.slotCapacity)
          throw new ConflictException({
            code: 'BOOKING_SLOT_UNAVAILABLE',
            reason: 'FULL',
            message: 'Slot is no longer available',
          });
        const repo = manager.getRepository(Booking);
        const now = new Date();
        const bookingNumber = await this.uniqueBookingNumber(repo, now);
        // Recheck the real clock after all lock waits and menu/capacity reads.
        await this.assertWithinHours(lockedCenter, slotStart, slotEnd, manager);
        const booking = repo.create({
          serviceCenterId: lockedCenter.id,
          scheduleRevision: lockedCenter.scheduleRevision,
          customerProfileId: profile.id,
          vehicleId: dto.vehicleId,
          mode: BookingMode.SELF_CHECKIN,
          status: lockedCenter.autoAccept
            ? BookingStatus.AWAITING_ARRIVAL
            : BookingStatus.PENDING_CENTER,
          confirmedAt: lockedCenter.autoAccept ? now : null,
          slotStart,
          slotEnd,
          issueDescription: dto.issueDescription?.trim() || null,
          paymentMode: dto.paymentMode ?? PaymentMode.PAY_AT_CENTER,
          estimateInr: estimate.toFixed(2),
          bookingNumber,
        });
        const saved = await repo.save(booking);
        if (offerings.length) {
          const itemRepo = manager.getRepository(BookingItem);
          await itemRepo.save(
            offerings.map((offering) =>
              itemRepo.create({
                bookingId: saved.id,
                ...offering,
              }),
            ),
          );
        }
        return { id: saved.id };
      };
      return meta
        ? withCommandReceipt(
            manager,
            `customer:${auth.userId}`,
            meta,
            reserve,
            async (value) => {
              const booking = await manager.getRepository(Booking).findOne({
                where: { id: value.id, customerProfileId: profile.id },
              });
              if (!booking) throw new NotFoundException();
            },
          )
        : reserve();
    });

    return toBookingView(await this.loadDetail(receipt.id));
  }

  async listForCustomer(auth: AuthContext) {
    const profile = await this.meService.ensureProfile(auth);
    const rows = await this.bookingRepository.find({
      where: { customerProfileId: profile.id },
      relations: BOOKING_DETAIL_RELATIONS,
      order: { createdAt: 'DESC' },
    });
    return { items: rows.map(toBookingView) };
  }

  async getOne(auth: AuthContext, id: string): Promise<BookingView> {
    return toBookingView(await this.getOwned(auth, id));
  }

  async cancel(
    auth: AuthContext,
    id: string,
    dto: CancelBookingDto,
  ): Promise<BookingView> {
    const booking = await this.getOwned(auth, id);
    if (!OPEN_BOOKING_STATUSES.includes(booking.status)) {
      throw new ConflictException(
        `A ${booking.status} booking cannot be cancelled`,
      );
    }
    if (booking.slotStart.getTime() <= Date.now()) {
      throw new ConflictException(
        'The slot has started; ask the center to cancel',
      );
    }
    const result = await this.bookingRepository.update(
      { id: booking.id, status: booking.status },
      {
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: BookingParty.CUSTOMER,
        cancellationReason: dto.reason?.trim() || null,
      },
    );
    if (!result.affected)
      throw new ConflictException(
        'This booking changed; reload before cancelling',
      );
    return toBookingView(await this.loadDetail(id));
  }

  async addAttachment(
    auth: AuthContext,
    id: string,
    dto: CreateAttachmentDto,
  ): Promise<BookingAttachmentView & { storageKey: string; upload: null }> {
    const booking = await this.getOwned(auth, id);
    if (!OPEN_BOOKING_STATUSES.includes(booking.status)) {
      throw new ConflictException(
        'Attachments can only be added before check-in',
      );
    }
    const live = (booking.attachments ?? []).filter((a) => !a.deletedAt);
    if (live.length >= MAX_ATTACHMENTS) {
      throw new BadRequestException(
        `A booking can have up to ${MAX_ATTACHMENTS} attachments`,
      );
    }
    const safeName = dto.fileName.replace(/[^\w.-]+/g, '_').slice(-120);
    const attachment = await this.attachmentRepository.save(
      this.attachmentRepository.create({
        bookingId: booking.id,
        storageKey: `bookings/${booking.id}/${randomUUID()}-${safeName}`,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
      }),
    );
    return {
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      createdAt: attachment.createdAt,
      storageKey: attachment.storageKey,
      upload: null,
    };
  }

  async removeAttachment(
    auth: AuthContext,
    id: string,
    attachmentId: string,
  ): Promise<void> {
    const booking = await this.getOwned(auth, id);
    const attachment = (booking.attachments ?? []).find(
      (a) => a.id === attachmentId && !a.deletedAt,
    );
    if (!attachment) {
      throw new NotFoundException();
    }
    await this.attachmentRepository.softRemove(attachment);
  }

  loadDetail(id: string): Promise<Booking> {
    return this.bookingRepository.findOneOrFail({
      where: { id },
      relations: BOOKING_DETAIL_RELATIONS,
    });
  }

  private async getOwned(auth: AuthContext, id: string): Promise<Booking> {
    const booking = await this.bookingRepository.findOne({
      where: { id },
      relations: BOOKING_DETAIL_RELATIONS,
    });
    if (!booking) {
      throw new NotFoundException();
    }
    const profile = await this.meService.ensureProfile(auth);
    if (booking.customerProfileId !== profile.id) {
      throw new ForbiddenException();
    }
    return booking;
  }

  private async uniqueBookingNumber(
    repo: Repository<Booking>,
    now: Date,
  ): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateBookingNumber(now);
      const taken = await repo.findOne({ where: { bookingNumber: candidate } });
      if (!taken) return candidate;
    }
    throw new ConflictException('Could not allocate a booking number; retry');
  }

  private async assertWithinHours(
    center: ServiceCenter,
    slotStart: Date,
    slotEnd: Date,
    manager: EntityManager,
  ): Promise<void> {
    if (!Number.isFinite(+slotStart) || !Number.isFinite(+slotEnd))
      throw new BadRequestException('Invalid slot');
    const hours = await this.tenancyService.getHoursForDate(
      center,
      toIstParts(slotStart).date,
      manager,
    );
    const intervals =
      hours.intervals ??
      (hours.isClosed || !hours.openTime || !hours.closeTime
        ? []
        : [{ open: hours.openTime, close: hours.closeTime }]);
    assertCanonicalSlot(
      {
        leadMinutes: center.bookingLeadMinutes,
        advanceDays: center.bookingAdvanceDays,
      },
      intervals,
      slotStart,
      slotEnd,
    );
  }

  private async requireBookableCenter(
    id: string,
    repository = this.centerRepository,
  ): Promise<ServiceCenter> {
    const center = await repository.findOne({ where: { id } });
    if (
      !center ||
      center.status !== ServiceCenterStatus.ACTIVE ||
      !center.bookingEnabled
    ) {
      throw new NotFoundException();
    }
    return center;
  }
}
