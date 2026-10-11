import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { toIndiaE164 } from '../customers/me.service';
import { OperatingHour } from '../tenancy/entities/operating-hour.entity';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import { DayHours, TenancyService } from '../tenancy/tenancy.service';
import { PutHoursDto, UpdateCenterDto } from './dto/center.dto';

export interface CenterView {
  id: string;
  name: string;
  displayName: string;
  slug: string | null;
  status: string;
  publicPhone: string | null;
  gstin: string | null;
  upiVpa: string | null;
  expressSkipEnabled: boolean;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    formatted: string | null;
  };
  latitude: number | null;
  longitude: number | null;
  heroImageUrl: string | null;
  photoUrls: string[];
  googleMapsUrl: string | null;
  logoUrl: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  supportedVehicleTypes: string[];
  pickupDropEnabled: boolean;
  autoAccept: boolean;
  bookingEnabled: boolean;
  slotCapacity: number;
  hoursStart: string;
  hoursEnd: string;
  weeklyHours: DayHours[];
  onboardedAt: Date | null;
}

function toMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

@Injectable()
export class CenterService {
  constructor(
    @InjectRepository(ServiceCenter)
    private readonly centerRepository: Repository<ServiceCenter>,
    private readonly tenancyService: TenancyService,
    private readonly dataSource: DataSource,
  ) {}

  async get(auth: AuthContext): Promise<CenterView> {
    const center = await this.requireCenter(auth);
    return this.toView(center);
  }

  async update(auth: AuthContext, dto: UpdateCenterDto): Promise<CenterView> {
    const center = await this.requireCenter(auth);
    const hasLat = dto.latitude !== undefined;
    const hasLng = dto.longitude !== undefined;
    if (
      hasLat !== hasLng ||
      (hasLat && (dto.latitude === null) !== (dto.longitude === null))
    )
      throw new BadRequestException(
        'Set or clear latitude and longitude together',
      );
    if (dto.slug !== undefined && dto.slug !== center.slug) {
      const taken = await this.centerRepository.findOne({
        where: { slug: dto.slug, id: Not(center.id) },
      });
      if (taken) {
        throw new ConflictException('This slug is already in use');
      }
      center.slug = dto.slug;
    }
    const hoursStart = dto.hoursStart ?? center.hoursStart;
    const hoursEnd = dto.hoursEnd ?? center.hoursEnd;
    if (toMinutes(hoursStart) >= toMinutes(hoursEnd)) {
      throw new BadRequestException('hoursStart must be before hoursEnd');
    }
    if (dto.displayName !== undefined) center.displayName = dto.displayName;
    if (dto.publicPhone !== undefined) {
      center.publicPhone = toIndiaE164(dto.publicPhone);
    }
    if (dto.gstin !== undefined) center.gstin = dto.gstin;
    if (dto.addressLine1 !== undefined) center.addressLine1 = dto.addressLine1;
    if (dto.addressLine2 !== undefined) center.addressLine2 = dto.addressLine2;
    if (dto.city !== undefined) center.city = dto.city;
    if (dto.state !== undefined) center.state = dto.state;
    if (dto.postalCode !== undefined) center.postalCode = dto.postalCode;
    if (dto.formattedAddress !== undefined) {
      center.formattedAddress = dto.formattedAddress;
    }
    if (dto.latitude !== undefined) center.latitude = dto.latitude;
    if (dto.longitude !== undefined) center.longitude = dto.longitude;
    if (dto.heroImageUrl !== undefined) center.heroImageUrl = dto.heroImageUrl;
    if (dto.photoUrls !== undefined) center.photoUrls = dto.photoUrls;
    if (dto.googleMapsUrl !== undefined)
      center.googleMapsUrl = dto.googleMapsUrl;
    if (dto.logoUrl !== undefined) center.logoUrl = dto.logoUrl;
    if (dto.supportedVehicleTypes !== undefined) {
      center.supportedVehicleTypes = dto.supportedVehicleTypes;
    }
    if (dto.pickupDropEnabled !== undefined) {
      center.pickupDropEnabled = dto.pickupDropEnabled;
    }
    if (dto.autoAccept !== undefined) center.autoAccept = dto.autoAccept;
    if (dto.slotCapacity !== undefined) center.slotCapacity = dto.slotCapacity;
    if (dto.bookingEnabled !== undefined) {
      center.bookingEnabled = dto.bookingEnabled;
    }
    if (dto.upiVpa !== undefined) center.upiVpa = dto.upiVpa;
    if (dto.expressSkipEnabled !== undefined) {
      center.expressSkipEnabled = dto.expressSkipEnabled;
    }
    center.hoursStart = hoursStart;
    center.hoursEnd = hoursEnd;
    // A partial UPDATE writes both supplied coordinates even when one is unchanged.
    // Diff-saving a full entity could mix pairs from concurrent profile edits.
    const changes = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    ) as Partial<ServiceCenter>;
    if (dto.publicPhone !== undefined) changes.publicPhone = center.publicPhone;
    if (Object.keys(changes).length)
      await this.centerRepository.update(center.id, changes);
    const saved = await this.centerRepository.findOneByOrFail({
      id: center.id,
    });
    return this.toView(saved);
  }

  async getHours(auth: AuthContext): Promise<DayHours[]> {
    const center = await this.requireCenter(auth);
    return this.tenancyService.getWeeklyHours(center);
  }

  async putHours(auth: AuthContext, dto: PutHoursDto): Promise<DayHours[]> {
    const center = await this.requireCenter(auth);
    const seen = new Set<number>();
    for (const day of dto.days) {
      if (seen.has(day.dayOfWeek)) {
        throw new BadRequestException(
          `dayOfWeek ${day.dayOfWeek} appears more than once`,
        );
      }
      seen.add(day.dayOfWeek);
      if (day.isClosed) continue;
      if (!day.openTime || !day.closeTime) {
        throw new BadRequestException(
          `dayOfWeek ${day.dayOfWeek} needs openTime and closeTime`,
        );
      }
      if (toMinutes(day.openTime) >= toMinutes(day.closeTime)) {
        throw new BadRequestException(
          `dayOfWeek ${day.dayOfWeek}: openTime must be before closeTime`,
        );
      }
    }

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(OperatingHour);
      for (const day of dto.days) {
        const existing = await repo.findOne({
          where: { serviceCenterId: center.id, dayOfWeek: day.dayOfWeek },
        });
        const row =
          existing ??
          repo.create({
            serviceCenterId: center.id,
            dayOfWeek: day.dayOfWeek,
          });
        row.isClosed = day.isClosed;
        row.openTime = day.isClosed ? null : day.openTime!;
        row.closeTime = day.isClosed ? null : day.closeTime!;
        await repo.save(row);
      }
    });

    return this.tenancyService.getWeeklyHours(center);
  }

  private async requireCenter(auth: AuthContext): Promise<ServiceCenter> {
    const center = auth.serviceCenterId
      ? await this.centerRepository.findOne({
          where: { id: auth.serviceCenterId },
        })
      : null;
    if (!center) {
      throw new NotFoundException();
    }
    return center;
  }

  private async toView(center: ServiceCenter): Promise<CenterView> {
    return {
      id: center.id,
      name: center.name,
      displayName: center.displayName ?? center.name,
      slug: center.slug,
      status: center.status,
      publicPhone: center.publicPhone,
      gstin: center.gstin,
      upiVpa: center.upiVpa,
      expressSkipEnabled: center.expressSkipEnabled,
      address: {
        line1: center.addressLine1,
        line2: center.addressLine2,
        city: center.city,
        state: center.state,
        postalCode: center.postalCode,
        formatted: center.formattedAddress,
      },
      latitude: center.latitude,
      longitude: center.longitude,
      heroImageUrl: center.heroImageUrl,
      photoUrls: center.photoUrls,
      googleMapsUrl: center.googleMapsUrl,
      logoUrl: center.logoUrl,
      ratingAvg: center.ratingAvg ? Number(center.ratingAvg) : null,
      ratingCount: center.ratingCount,
      supportedVehicleTypes: center.supportedVehicleTypes,
      pickupDropEnabled: center.pickupDropEnabled,
      autoAccept: center.autoAccept,
      bookingEnabled: center.bookingEnabled,
      slotCapacity: center.slotCapacity,
      hoursStart: center.hoursStart,
      hoursEnd: center.hoursEnd,
      weeklyHours: await this.tenancyService.getWeeklyHours(center),
      onboardedAt: center.onboardedAt,
    };
  }
}
