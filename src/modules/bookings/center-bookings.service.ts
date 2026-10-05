import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { BookingParty } from '../../common/enums/booking-party.enum';
import {
  BookingStatus,
  OPEN_BOOKING_STATUSES,
} from '../../common/enums/booking-status.enum';
import { addDays, daysBetween, istDayRange, istToday } from '../../common/time/ist';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { GarageVehicle } from '../customers/entities/garage-vehicle.entity';
import { ServiceJob } from '../jobs/entities/service-job.entity';
import { JobsService } from '../jobs/jobs.service';
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
    publicToken: string;
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
    booking.status = BookingStatus.AWAITING_ARRIVAL;
    booking.confirmedAt = new Date();
    await this.saveAndNotify(booking, {
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
    booking.status = BookingStatus.CANCELLED;
    booking.cancelledAt = new Date();
    booking.cancelledBy = BookingParty.CENTER;
    booking.cancellationReason = dto.reason.trim();
    await this.saveAndNotify(booking, {
      templateKey: 'booking.declined',
      title: 'Booking declined',
      body: `${centerName(booking)} can't take your visit on ${slotLabel(booking.slotStart)}: ${booking.cancellationReason}`,
    });
    return this.getOne(auth, id);
  }

  private async saveAndNotify(
    booking: Booking,
    message: { templateKey: string; title: string; body: string },
  ): Promise<void> {
    await this.bookingRepository.manager.transaction(async (manager) => {
      await manager.getRepository(Booking).save(booking);
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
    booking.status = BookingStatus.NO_SHOW;
    await this.bookingRepository.save(booking);
    return this.getOne(auth, id);
  }

  async checkIn(
    auth: AuthContext,
    id: string,
    dto: CheckInBookingDto,
  ): Promise<CheckInResult> {
    const booking = await this.getInCenter(auth, id);
    this.assertStatus(booking, [
      BookingStatus.AWAITING_ARRIVAL,
      BookingStatus.CONFIRMED,
    ]);

    const claimed = await this.bookingRepository.update(
      { id: booking.id, status: booking.status },
      { status: BookingStatus.CHECKED_IN, checkedInAt: new Date() },
    );
    if (!claimed.affected) {
      throw new ConflictException('This booking was just updated; reload it');
    }

    const serviceType =
      dto.serviceType ??
      (booking.items?.length
        ? booking.items
            .map((item) => item.name)
            .join(', ')
            .slice(0, 128)
        : 'General service');

    let job: ServiceJob;
    try {
      job = await this.jobsService.openFromBooking(auth, {
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
      });
    } catch (error) {
      await this.bookingRepository.update(
        { id: booking.id },
        { status: booking.status, checkedInAt: null },
      );
      throw error;
    }

    await this.bookingRepository.update(
      { id: booking.id },
      { serviceJobId: job.id },
    );

    const garageVehicle = booking.vehicle;
    if (
      dto.odometerKm !== undefined &&
      dto.odometerKm > (garageVehicle.currentOdometerKm ?? -1)
    ) {
      await this.garageVehicleRepository.update(
        { id: garageVehicle.id },
        { currentOdometerKm: dto.odometerKm },
      );
    }

    return {
      booking: await this.getOne(auth, id),
      job: {
        id: job.id,
        jobNumber: job.jobNumber,
        status: job.status,
        publicToken: job.publicToken,
      },
    };
  }

  private assertStatus(booking: Booking, allowed: BookingStatus[]): void {
    if (!allowed.includes(booking.status)) {
      throw new ConflictException(
        `This action is not available for a ${booking.status} booking`,
      );
    }
  }

  private async getInCenter(auth: AuthContext, id: string): Promise<Booking> {
    const booking = await this.bookingRepository.findOne({
      where: { id, serviceCenterId: auth.serviceCenterId! },
      relations: CENTER_RELATIONS,
    });
    if (!booking) {
      throw new NotFoundException();
    }
    return booking;
  }
}
