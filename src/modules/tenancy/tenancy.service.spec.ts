import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceCenterStatus } from '../../common/enums/service-center-status.enum';
import { ServiceCenter } from './entities/service-center.entity';
import { StaffProfile } from './entities/staff-profile.entity';
import { TenancyService } from './tenancy.service';

describe('TenancyService', () => {
  let service: TenancyService;
  let serviceCenterRepo: jest.Mocked<Repository<ServiceCenter>>;
  let staffProfileRepo: jest.Mocked<Repository<StaffProfile>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenancyService,
        {
          provide: getRepositoryToken(ServiceCenter),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(StaffProfile),
          useValue: { findOne: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(TenancyService);
    serviceCenterRepo = module.get(getRepositoryToken(ServiceCenter));
    staffProfileRepo = module.get(getRepositoryToken(StaffProfile));
  });

  it('maps domainId and iamUserId to service center and staff profile', async () => {
    const center = {
      id: 'center-1',
      iamDomainId: 'domain-1',
      status: ServiceCenterStatus.ACTIVE,
    } as ServiceCenter;
    const profile = {
      id: 'profile-1',
      serviceCenterId: 'center-1',
      iamUserId: 'user-1',
      isActive: true,
    } as StaffProfile;

    serviceCenterRepo.findOne.mockResolvedValue(center);
    staffProfileRepo.findOne.mockResolvedValue(profile);

    const result = await service.resolveTenantContext('domain-1', 'user-1');

    expect(result.serviceCenter.id).toBe('center-1');
    expect(result.staffProfile.id).toBe('profile-1');
  });

  it('returns 404 when domain is unknown (cross-tenant)', async () => {
    serviceCenterRepo.findOne.mockResolvedValue(null);

    await expect(
      service.resolveTenantContext('unknown-domain', 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns 404 when staff profile is missing for the domain', async () => {
    serviceCenterRepo.findOne.mockResolvedValue({
      id: 'center-1',
      iamDomainId: 'domain-1',
      status: ServiceCenterStatus.ACTIVE,
    } as ServiceCenter);
    staffProfileRepo.findOne.mockResolvedValue(null);

    await expect(
      service.resolveTenantContext('domain-1', 'unknown-user'),
    ).rejects.toThrow(NotFoundException);
  });
});
