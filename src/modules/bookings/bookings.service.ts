import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BookingMode } from '../../common/enums/booking-mode.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { PaymentMode } from '../../common/enums/payment-mode.enum';
import { ServiceCenterStatus } from '../../common/enums/service-center-status.enum';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { GarageService } from '../customers/garage.service';
import { MeService } from '../customers/me.service';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import { CreateBookingDto, ListSlotsQueryDto } from './dto/create-booking.dto';
import { Booking } from './entities/booking.entity';

const SLOT_MINUTES = 60;
const SELF_CHECKIN_ESTIMATE_INR = 2499;

function parseHm(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(':').map(Number);
  return { h, m };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(ServiceCenter)
    private readonly centerRepository: Repository<ServiceCenter>,
    private readonly garageService: GarageService,
    private readonly meService: MeService,
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
    };
  }

  async listSlots(centerId: string, query: ListSlotsQueryDto) {
    const center = await this.requireBookableCenter(centerId);
    const dateStr = query.date ?? new Date().toISOString().slice(0, 10);
    const startHm = parseHm(center.hoursStart);
    const endHm = parseHm(center.hoursEnd);
    const now = Date.now();
    const existing = await this.bookingRepository.find({
      where: { serviceCenterId: centerId },
    });

    const slots: {
      start: string;
      end: string;
      available: boolean;
    }[] = [];

    const dayStart = startHm.h * 60 + startHm.m;
    const dayEnd = endHm.h * 60 + endHm.m;
    for (let minutes = dayStart; minutes < dayEnd; minutes += SLOT_MINUTES) {
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      const start = new Date(`${dateStr}T${pad(h)}:${pad(m)}:00+05:30`);
      const end = new Date(start.getTime() + SLOT_MINUTES * 60 * 1000);
      const taken = existing.some(
        (b) =>
          b.status !== BookingStatus.CANCELLED &&
          b.slotStart.getTime() === start.getTime(),
      );
      slots.push({
        start: start.toISOString(),
        end: end.toISOString(),
        available: !taken && start.getTime() > now,
      });
    }

    return { date: dateStr, slots };
  }

  async create(auth: AuthContext, dto: CreateBookingDto): Promise<Booking> {
    if (dto.mode !== BookingMode.SELF_CHECKIN) {
      throw new BadRequestException('Only SELF_CHECKIN is available in v1');
    }
    const center = await this.requireBookableCenter(dto.serviceCenterId);
    await this.garageService.getOwned(auth, dto.vehicleId);
    let profileId = auth.customerProfileId;
    if (!profileId) {
      const profile = await this.meService.upsertProfile(auth, {});
      profileId = profile.id;
    }

    const slotStart = new Date(dto.slotStart);
    const slotEnd = new Date(dto.slotEnd);
    if (!(slotStart.getTime() < slotEnd.getTime())) {
      throw new BadRequestException('Invalid slot');
    }

    const clash = await this.bookingRepository.findOne({
      where: {
        serviceCenterId: center.id,
        slotStart,
      },
    });
    if (clash && clash.status !== BookingStatus.CANCELLED) {
      throw new BadRequestException('Slot is no longer available');
    }

    const status = center.autoAccept
      ? BookingStatus.AWAITING_ARRIVAL
      : BookingStatus.PENDING_CENTER;

    const booking = this.bookingRepository.create({
      serviceCenterId: center.id,
      customerProfileId: profileId,
      vehicleId: dto.vehicleId,
      mode: BookingMode.SELF_CHECKIN,
      status,
      slotStart,
      slotEnd,
      issueDescription: dto.issueDescription ?? null,
      paymentMode: dto.paymentMode ?? PaymentMode.PAY_AT_CENTER,
      estimateInr: String(dto.estimateInr ?? SELF_CHECKIN_ESTIMATE_INR),
    });
    return this.bookingRepository.save(booking);
  }

  async listForCustomer(auth: AuthContext) {
    const profileId = await this.resolveProfileId(auth);
    const rows = await this.bookingRepository.find({
      where: { customerProfileId: profileId },
      relations: { serviceCenter: true, vehicle: true },
      order: { createdAt: 'DESC' },
    });
    return { items: rows.map((booking) => this.toSummary(booking)) };
  }

  async getOne(auth: AuthContext, id: string) {
    const booking = await this.bookingRepository.findOne({
      where: { id },
      relations: { serviceCenter: true, vehicle: true },
    });
    if (!booking) {
      throw new NotFoundException();
    }
    const profileId = await this.resolveProfileId(auth);
    if (booking.customerProfileId !== profileId) {
      throw new ForbiddenException();
    }
    return this.toSummary(booking);
  }

  private async resolveProfileId(auth: AuthContext): Promise<string> {
    if (auth.customerProfileId) return auth.customerProfileId;
    const profile = await this.meService.getProfile(auth);
    return profile.id;
  }

  private toSummary(booking: Booking) {
    const vehicle = booking.vehicle;
    const center = booking.serviceCenter;
    return {
      id: booking.id,
      status: booking.status,
      mode: booking.mode,
      estimateInr: booking.estimateInr,
      slotStart: booking.slotStart,
      slotEnd: booking.slotEnd,
      paymentMode: booking.paymentMode,
      issueDescription: booking.issueDescription,
      vehicleId: booking.vehicleId,
      serviceCenterId: booking.serviceCenterId,
      vehicleLabel: vehicle ? `${vehicle.make} ${vehicle.model}` : '',
      registrationNumber: vehicle?.registrationNumber ?? '',
      centerName: center?.displayName || center?.name || '',
    };
  }

  private async requireBookableCenter(id: string): Promise<ServiceCenter> {
    const center = await this.centerRepository.findOne({ where: { id } });
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
