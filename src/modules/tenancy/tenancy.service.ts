import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceCenterStatus } from '../../common/enums/service-center-status.enum';
import { ServiceCenter } from './entities/service-center.entity';
import { StaffProfile } from './entities/staff-profile.entity';

export interface TenantContext {
  serviceCenter: ServiceCenter;
  staffProfile: StaffProfile;
}

@Injectable()
export class TenancyService {
  constructor(
    @InjectRepository(ServiceCenter)
    private readonly serviceCenterRepository: Repository<ServiceCenter>,
    @InjectRepository(StaffProfile)
    private readonly staffProfileRepository: Repository<StaffProfile>,
  ) {}

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
