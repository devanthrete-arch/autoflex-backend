import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, In, Repository } from 'typeorm';
import { BookingMode } from '../../common/enums/booking-mode.enum';
import { BookingParty } from '../../common/enums/booking-party.enum';
import {
  BookingStatus,
  OPEN_BOOKING_STATUSES,
} from '../../common/enums/booking-status.enum';
import { PaymentMode } from '../../common/enums/payment-mode.enum';
import { GarageVehicleStatus } from '../../common/enums/garage-vehicle-status.enum';
import { ServiceCenterStatus } from '../../common/enums/service-center-status.enum';
import {
  hmToMinutes,
  istDayRange,
  istInstant,
  istToday,
  toIstParts,
} from '../../common/time/ist';
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

const SLOT_MINUTES = 60;
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
    const center = await this.requireBookableCenter(centerId);
    const date = query.date ?? istToday();
    const hours = await this.tenancyService.getHoursForDate(center, date);
    if (hours.isClosed || !hours.openTime || !hours.closeTime) {
      return { date, closed: true, slots: [] };
    }
    const { start: dayStart, end: dayEnd } = istDayRange(date);
    const held = await this.bookingRepository.find({
      where: {
        serviceCenterId: centerId,
        status: In(SLOT_HOLDING_STATUSES),
        slotStart: Between(dayStart, dayEnd),
      },
    });
    const heldBySlot = new Map<number, number>();
    for (const booking of held) {
      const key = booking.slotStart.getTime();
      heldBySlot.set(key, (heldBySlot.get(key) ?? 0) + 1);
    }

    const now = Date.now();
    const slots: {
      start: string;
      end: string;
      available: boolean;
      remaining: number;
    }[] = [];
    const open = hmToMinutes(hours.openTime);
    const close = hmToMinutes(hours.closeTime);
    for (let m = open; m + SLOT_MINUTES <= close; m += SLOT_MINUTES) {
      const start = istInstant(date, m);
      const end = new Date(start.getTime() + SLOT_MINUTES * 60 * 1000);
      const remaining = Math.max(
        0,
        center.slotCapacity - (heldBySlot.get(start.getTime()) ?? 0),
      );
      slots.push({
        start: start.toISOString(),
        end: end.toISOString(),
        available: remaining > 0 && start.getTime() > now,
        remaining,
      });
    }

    return { date, closed: false, slots };
  }

  async create(auth: AuthContext, dto: CreateBookingDto): Promise<BookingView> {
    if (dto.mode !== BookingMode.SELF_CHECKIN) {
      throw new BadRequestException('Only SELF_CHECKIN is available in v1');
    }
    const center = await this.requireBookableCenter(dto.serviceCenterId);
    const vehicle = await this.garageService.getOwned(auth, dto.vehicleId);
    this.assertActiveVehicle(vehicle);
    if (!center.supportedVehicleTypes.includes(vehicle.vehicleType)) {
      throw new BadRequestException(
        'This center does not service this vehicle type',
      );
    }
    const profile = await this.meService.ensureProfile(auth);
    assertBookingEligibility(profile.dateOfBirth);

    const slotStart = new Date(dto.slotStart);
    const slotEnd = new Date(dto.slotEnd);
    if (!(slotStart.getTime() < slotEnd.getTime())) {
      throw new BadRequestException('Invalid slot');
    }
    if (slotStart.getTime() <= Date.now()) {
      throw new BadRequestException('This slot has already started');
    }
    await this.assertWithinHours(center, slotStart, slotEnd);

    const bookingId = await this.dataSource.transaction(async (manager) => {
      const lockedCenter = await this.offeringsService.lockCenter(
        manager,
        center.id,
      );
      // Lock order is center, then vehicle. Archive/ownership changes must not race a reservation.
      const currentVehicle = await manager
        .getRepository(GarageVehicle)
        .findOne({
          where: { id: vehicle.id, customerProfileId: profile.id },
          lock: { mode: 'pessimistic_write' },
        });
      if (!currentVehicle) throw new NotFoundException('Vehicle not found');
      this.assertActiveVehicle(currentVehicle);
      if (
        lockedCenter.status !== ServiceCenterStatus.ACTIVE ||
        !lockedCenter.bookingEnabled ||
        !lockedCenter.supportedVehicleTypes.includes(currentVehicle.vehicleType)
      )
        throw new BadRequestException(
          'This center is no longer available for this vehicle',
        );
      await this.assertWithinHours(lockedCenter, slotStart, slotEnd);
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
          serviceCenterId: center.id,
          slotStart,
          status: In(SLOT_HOLDING_STATUSES),
        },
      });
      if (held >= lockedCenter.slotCapacity)
        throw new BadRequestException('Slot is no longer available');
      const repo = manager.getRepository(Booking);
      const now = new Date();
      const booking = repo.create({
        serviceCenterId: center.id,
        customerProfileId: profile.id,
        vehicleId: vehicle.id,
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
        bookingNumber: await this.uniqueBookingNumber(repo, now),
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
      return saved.id;
    });

    return toBookingView(await this.loadDetail(bookingId));
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
    booking.status = BookingStatus.CANCELLED;
    booking.cancelledAt = new Date();
    booking.cancelledBy = BookingParty.CUSTOMER;
    booking.cancellationReason = dto.reason?.trim() || null;
    await this.bookingRepository.save(booking);
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
  ): Promise<void> {
    const start = toIstParts(slotStart);
    const end = toIstParts(slotEnd);
    const hours = await this.tenancyService.getHoursForDate(center, start.date);
    if (hours.isClosed || !hours.openTime || !hours.closeTime) {
      throw new BadRequestException('The center is closed on this day');
    }
    const endMinutes = end.date === start.date ? end.minutes : 24 * 60;
    if (
      start.minutes < hmToMinutes(hours.openTime) ||
      endMinutes > hmToMinutes(hours.closeTime)
    ) {
      throw new BadRequestException('Slot is outside the center hours');
    }
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
