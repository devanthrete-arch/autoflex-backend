import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceCenterStatus } from '../../common/enums/service-center-status.enum';
import { istDayOfWeek } from '../../common/time/ist';
import { OperatingHour } from './entities/operating-hour.entity';
import { ServiceCenter } from './entities/service-center.entity';
import { StaffProfile } from './entities/staff-profile.entity';

export interface TenantContext {
  serviceCenter: ServiceCenter;
  staffProfile: StaffProfile;
}

export interface DayHours {
  dayOfWeek: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
}

export { istDayOfWeek };

@Injectable()
export class TenancyService {
  constructor(
    @InjectRepository(ServiceCenter)
    private readonly serviceCenterRepository: Repository<ServiceCenter>,
    @InjectRepository(StaffProfile)
    private readonly staffProfileRepository: Repository<StaffProfile>,
    @InjectRepository(OperatingHour)
    private readonly operatingHourRepository: Repository<OperatingHour>,
  ) {}

  /**
   * Seven entries, Sunday first. Days without a stored row use the center's
   * default `hoursStart`/`hoursEnd`.
   */
  async getWeeklyHours(center: ServiceCenter): Promise<DayHours[]> {
    const rows = await this.operatingHourRepository.find({
      where: { serviceCenterId: center.id },
    });
    const byDay = new Map(rows.map((row) => [row.dayOfWeek, row]));
    return Array.from({ length: 7 }, (_, dayOfWeek) => {
      const row = byDay.get(dayOfWeek);
      if (!row) {
        return {
          dayOfWeek,
          openTime: center.hoursStart,
          closeTime: center.hoursEnd,
          isClosed: false,
        };
      }
      return {
        dayOfWeek,
        openTime: row.isClosed ? null : row.openTime,
        closeTime: row.isClosed ? null : row.closeTime,
        isClosed: row.isClosed,
      };
    });
  }

  async getHoursForDate(
    center: ServiceCenter,
    date: string,
  ): Promise<DayHours> {
    const week = await this.getWeeklyHours(center);
    return week[istDayOfWeek(date)];
  }

  async resolveTenantContext(
    domainId: string,
    iamUserId: string,
  ): Promise<TenantContext> {
    const serviceCenter = await this.serviceCenterRepository.findOne({
      where: { iamDomainId: domainId },
    });

    if (!serviceCenter || serviceCenter.status !== ServiceCenterStatus.ACTIVE) {
      throw new NotFoundException();
    }

    const staffProfile = await this.staffProfileRepository.findOne({
      where: {
        serviceCenterId: serviceCenter.id,
        iamUserId,
        isActive: true,
      },
    });

    if (!staffProfile) {
      throw new NotFoundException();
    }

    return { serviceCenter, staffProfile };
  }

  async findServiceCenterByDomainId(
    domainId: string,
  ): Promise<ServiceCenter | null> {
    return this.serviceCenterRepository.findOne({
      where: { iamDomainId: domainId },
    });
  }
}
