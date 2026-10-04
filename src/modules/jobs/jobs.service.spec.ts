import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobStatus } from '../../common/enums/job-status.enum';
import { VehicleType } from '../../common/enums/vehicle-type.enum';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { Customer } from '../customers/entities/customer.entity';
import { Vehicle } from '../customers/entities/vehicle.entity';
import { EventsService } from '../events/events.service';
import { StaffProfile } from '../tenancy/entities/staff-profile.entity';
import { ServiceJob } from './entities/service-job.entity';
import { JobsService } from './jobs.service';

describe('JobsService', () => {
  let service: JobsService;
  let jobRepository: jest.Mocked<Repository<ServiceJob>>;

  const auth: AuthContext = {
    actorType: 'staff',
    userId: 'user-1',
    domainId: 'domain-1',
    domainApplicationId: 'app-1',
    roles: ['advisor'],
    permissions: ['jobs:create', 'jobs:read', 'jobs:update'],
    serviceCenterId: 'center-1',
    staffProfileId: 'profile-1',
    customerProfileId: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsService,
        {
          provide: getRepositoryToken(ServiceJob),
          useValue: {
            create: jest.fn((entity) => entity),
            save: jest.fn(async (entity) => ({
              ...entity,
              id: 'job-1',
              createdAt: new Date(),
              updatedAt: new Date(),
            })),
            findOne: jest.fn(),
            createQueryBuilder: jest.fn(),
            softRemove: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Customer),
          useValue: {
            findOne: jest.fn().mockResolvedValue(null),
            create: jest.fn((entity) => entity),
            save: jest.fn(async (entity) => ({ ...entity, id: 'customer-1' })),
          },
        },
        {
          provide: getRepositoryToken(Vehicle),
          useValue: {
            findOne: jest.fn().mockResolvedValue(null),
            create: jest.fn((entity) => entity),
            save: jest.fn(async (entity) => ({ ...entity, id: 'vehicle-1' })),
          },
        },
        {
          provide: getRepositoryToken(StaffProfile),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: EventsService,
          useValue: {
            appendJobCreated: jest.fn(),
            appendStatusChange: jest.fn(),
            writeAuditLog: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(JobsService);
    jobRepository = module.get(getRepositoryToken(ServiceJob));
  });

  it('creates a job with publicToken and CHECKED_IN status', async () => {
    const job = await service.create(auth, {
      customerPhone: '+919876543210',
      vehicleRegistration: 'MH12AB1234',
      serviceType: 'Periodic service',
      vehicleType: VehicleType.TWO_WHEELER,
    });

    expect(job.id).toBe('job-1');
    expect(job.status).toBe(JobStatus.CHECKED_IN);
    expect(job.publicToken).toBeDefined();
    expect(job.publicToken.length).toBeGreaterThan(20);
  });

  it('returns 404 for cross-tenant job access', async () => {
    jobRepository.findOne.mockResolvedValue(null);

    await expect(service.findOne(auth, 'missing-job')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('forbids customer actors from creating jobs', async () => {
    const customerAuth: AuthContext = {
      ...auth,
      actorType: 'customer',
      serviceCenterId: null,
      staffProfileId: null,
      customerProfileId: 'cust-profile-1',
    };

    await expect(
      service.create(customerAuth, {
        customerPhone: '+919876543210',
        vehicleRegistration: 'MH12AB1234',
        serviceType: 'Periodic service',
        vehicleType: VehicleType.TWO_WHEELER,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects invalid status transitions', async () => {
    jobRepository.findOne.mockResolvedValue({
      id: 'job-1',
      serviceCenterId: 'center-1',
      status: JobStatus.CHECKED_IN,
    } as ServiceJob);

    await expect(
      service.updateStatus(auth, 'job-1', { status: JobStatus.COMPLETED }),
    ).rejects.toThrow(UnprocessableEntityException);
  });
});
