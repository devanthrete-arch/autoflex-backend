import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, EntityManager, Repository } from 'typeorm';
import { BookingParty } from '../../common/enums/booking-party.enum';
import {
  BookingStatus,
  OPEN_BOOKING_STATUSES,
} from '../../common/enums/booking-status.enum';
import {
  addDays,
  daysBetween,
  istDayRange,
  istToday,
} from '../../common/time/ist';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { GarageVehicle } from '../customers/entities/garage-vehicle.entity';
import { ServiceJob } from '../jobs/entities/service-job.entity';
import { JobsService } from '../jobs/jobs.service';
import { IntakeService } from '../jobs/intake.service';
import { NotificationCategory } from '../../common/enums/ownership.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { CenterBookingView, toCenterBookingView } from './booking-view';
import { BOOKING_DETAIL_RELATIONS } from './bookings.service';
import {
  CheckInBookingDto,
  DeclineBookingDto,
  ListCenterBookingsQueryDto,
} from './dto/create-booking.dto';
import { Booking } from './entities/booking.entity';

const CENTER_RELATIONS = {
  ...BOOKING_DETAIL_RELATIONS,
  customerProfile: true,
} as const;

const centerName = (booking: Booking): string =>
  booking.serviceCenter?.displayName ??
  booking.serviceCenter?.name ??
  'The service center';

const slotLabel = (instant: Date): string =>
  instant.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

export interface CheckInResult {
  booking: CenterBookingView;
  job: {
    id: string;
    jobNumber: string | null;
    status: string;
  };
}

@Injectable()
export class CenterBookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(GarageVehicle)
    private readonly garageVehicleRepository: Repository<GarageVehicle>,
    private readonly jobsService: JobsService,
    private readonly notifications: NotificationsService,
    private readonly intake: IntakeService,
  ) {}

  async list(
    auth: AuthContext,
    query: ListCenterBookingsQueryDto,
  ): Promise<{
    date: string;
    from: string;
    to: string;
    items: CenterBookingView[];
  }> {
    const from = query.from ?? query.date ?? istToday();
    const to = query.to ?? (query.from ? addDays(from, 13) : from);
    const span = daysBetween(from, to);
    if (span < 0) {
      throw new BadRequestException('`to` must be on or after `from`');
    }
    if (span > 13) {
      throw new BadRequestException('Booking range cannot exceed 14 days');
    }
    const start = istDayRange(from).start;
    const end = istDayRange(to).end;
    const rows = await this.bookingRepository.find({
      where: {
        serviceCenterId: auth.serviceCenterId!,
        slotStart: Between(start, end),
        ...(query.status ? { status: query.status } : {}),
      },
      relations: CENTER_RELATIONS,
      order: { slotStart: 'ASC', createdAt: 'ASC' },
    });
    return { date: from, from, to, items: rows.map(toCenterBookingView) };
  }

  async listPending(auth: AuthContext): Promise<CenterBookingView[]> {
    const rows = await this.bookingRepository.find({
      where: {
        serviceCenterId: auth.serviceCenterId!,
        status: BookingStatus.PENDING_CENTER,
      },
      relations: CENTER_RELATIONS,
      order: { slotStart: 'ASC' },
    });
    return rows.map(toCenterBookingView);
  }

  async getOne(auth: AuthContext, id: string): Promise<CenterBookingView> {
    return toCenterBookingView(await this.getInCenter(auth, id));
  }

  async confirm(auth: AuthContext, id: string): Promise<CenterBookingView> {
    const booking = await this.getInCenter(auth, id);
    this.assertStatus(booking, [BookingStatus.PENDING_CENTER]);
    const previous = booking.status;
    booking.status = BookingStatus.AWAITING_ARRIVAL;
    booking.confirmedAt = new Date();
    await this.saveAndNotify(booking, previous, {
      templateKey: 'booking.confirmed',
      title: 'Booking confirmed',
      body: `${centerName(booking)} confirmed your visit for ${slotLabel(booking.slotStart)}.`,
    });
    return this.getOne(auth, id);
  }

  async decline(
    auth: AuthContext,
    id: string,
    dto: DeclineBookingDto,
  ): Promise<CenterBookingView> {
    const booking = await this.getInCenter(auth, id);
    this.assertStatus(booking, OPEN_BOOKING_STATUSES);
    const previous = booking.status;
    booking.status = BookingStatus.CANCELLED;
    booking.cancelledAt = new Date();
    booking.cancelledBy = BookingParty.CENTER;
    booking.cancellationReason = dto.reason.trim();
    await this.saveAndNotify(booking, previous, {
      templateKey: 'booking.declined',
      title: 'Booking declined',
      body: `${centerName(booking)} can't take your visit on ${slotLabel(booking.slotStart)}: ${booking.cancellationReason}`,
    });
    return this.getOne(auth, id);
  }

  private async saveAndNotify(
    booking: Booking,
    previous: BookingStatus,
    message: { templateKey: string; title: string; body: string },
  ): Promise<void> {
    await this.bookingRepository.manager.transaction(async (manager) => {
      const updated = await manager.getRepository(Booking).update(
        { id: booking.id, status: previous },
        {
          status: booking.status,
          confirmedAt: booking.confirmedAt,
          cancelledAt: booking.cancelledAt,
          cancelledBy: booking.cancelledBy,
          cancellationReason: booking.cancellationReason,
        },
      );
      if (!updated.affected)
        throw new ConflictException(
          'This booking changed; reload before continuing',
        );
      if (!booking.customerProfile) return;
      await this.notifications.notifyProfile(manager, booking.customerProfile, {
        ...message,
        category: NotificationCategory.SERVICE,
        href: `/bookings/${booking.id}`,
        major: true,
        bookingId: booking.id,
        serviceCenterId: booking.serviceCenterId,
        payload: { bookingNumber: booking.bookingNumber },
      });
    });
  }

  async markNoShow(auth: AuthContext, id: string): Promise<CenterBookingView> {
    const booking = await this.getInCenter(auth, id);
    this.assertStatus(booking, [
      BookingStatus.AWAITING_ARRIVAL,
      BookingStatus.CONFIRMED,
    ]);
    if (booking.slotStart.getTime() > Date.now()) {
      throw new ConflictException(
        'A booking can be marked no-show once its slot starts',
      );
    }
    const updated = await this.bookingRepository.update(
      { id: booking.id, status: booking.status },
      { status: BookingStatus.NO_SHOW },
    );
    if (!updated.affected)
      throw new ConflictException(
        'This booking changed; reload before marking no-show',
      );
    return this.getOne(auth, id);
  }

  async checkIn(
    auth: AuthContext,
    id: string,
    dto: CheckInBookingDto,
  ): Promise<CheckInResult> {
    this.intake.authorize(auth);
    if (!auth.permissions.includes('bookings:manage'))
      throw new ForbiddenException();
    return this.bookingRepository.manager.transaction(async (manager) => {
      await this.intake.lockCenter(manager, auth);
      const repo = manager.getRepository(Booking);
      const locked = await repo.findOne({
        where: { id, serviceCenterId: auth.serviceCenterId! },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException();
      const booking = await this.getInCenter(auth, id, manager);
      // The attached job is the recovery record, including after later closure.
      // Never create another job when an earlier check-in response was lost.
      if (booking.status === BookingStatus.CHECKED_IN) {
        if (!booking.serviceJobId)
          throw new ConflictException(
            'Check-in needs reconciliation; the booking has no attached job',
          );
        const existing = await manager.getRepository(ServiceJob).findOne({
          where: {
            id: booking.serviceJobId,
            sourceBookingId: booking.id,
            serviceCenterId: auth.serviceCenterId!,
          },
        });
        if (!existing) throw new NotFoundException();
        return {
          booking: toCenterBookingView(booking),
          job: this.intake.reference(existing),
        };
      }
      this.assertStatus(booking, [
        BookingStatus.AWAITING_ARRIVAL,
        BookingStatus.CONFIRMED,
      ]);
      const serviceType =
        dto.serviceType ??
        (booking.items?.length
          ? booking.items
              .map((item) => item.name)
              .join(', ')
              .slice(0, 128)
          : 'General service');
      const job = await this.jobsService.openFromBooking(
        auth,
        {
          bookingId: booking.id,
          profile: booking.customerProfile,
          garageVehicle: booking.vehicle,
          serviceType,
          paymentMode: booking.paymentMode,
          items: booking.items,
          customerRequest: booking.issueDescription,
          odometerKm: dto.odometerKm,
          fuelLevel: dto.fuelLevel,
          accessoriesChecklist: dto.accessoriesChecklist,
          assignedTechnicianId: dto.assignedTechnicianId,
          estimatedReadyAt: dto.estimatedReadyAt,
          priority: dto.priority,
          budgetCeiling:
            dto.budgetCeiling ??
            (Number(booking.estimateInr) > 0
              ? Number(booking.estimateInr)
              : undefined),
        },
        manager,
      );
      const attached = await repo.update(
        { id: booking.id, status: booking.status },
        {
          status: BookingStatus.CHECKED_IN,
          checkedInAt: new Date(),
          serviceJobId: job.id,
        },
      );
      if (!attached.affected)
        throw new ConflictException(
          'The booking changed; retry check-in after reloading',
        );
      if (dto.odometerKm !== undefined) {
        await manager
          .getRepository(GarageVehicle)
          .createQueryBuilder()
          .update()
          .set({ currentOdometerKm: dto.odometerKm })
          .where(
            'id = :id AND (current_odometer_km IS NULL OR current_odometer_km < :odometer)',
            { id: booking.vehicleId, odometer: dto.odometerKm },
          )
          .execute();
      }
      return {
        booking: toCenterBookingView(await this.getInCenter(auth, id, manager)),
        job: this.intake.reference(job),
      };
    });
  }

  private assertStatus(booking: Booking, allowed: BookingStatus[]): void {
    if (!allowed.includes(booking.status)) {
      throw new ConflictException(
        `This action is not available for a ${booking.status} booking`,
      );
    }
  }

  private async getInCenter(
    auth: AuthContext,
    id: string,
    manager?: EntityManager,
  ): Promise<Booking> {
    const booking = await (
      manager?.getRepository(Booking) ?? this.bookingRepository
    ).findOne({
      where: { id, serviceCenterId: auth.serviceCenterId! },
      relations: CENTER_RELATIONS,
    });
    if (!booking) {
      throw new NotFoundException();
    }
    return booking;
  }
}
