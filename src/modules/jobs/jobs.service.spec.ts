import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobStatus } from '../../common/enums/job-status.enum';
import { VehicleType } from '../../common/enums/vehicle-type.enum';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { Customer } from '../customers/entities/customer.entity';
import { Vehicle } from '../customers/entities/vehicle.entity';
import { EventsService } from '../events/events.service';
import { StaffProfile } from '../tenancy/entities/staff-profile.entity';
import { ServiceJob } from './entities/service-job.entity';
import { JobStoreService } from './job-store.service';
import { JobsService } from './jobs.service';

describe('JobsService', () => {
  let service: JobsService;
  let jobRepository: jest.Mocked<Repository<ServiceJob>>;
  let saved: Partial<ServiceJob> | undefined;

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
    saved = undefined;
    const managerRepo = {
      create: jest.fn((entity: Partial<ServiceJob>) => entity),
      save: jest.fn(async (entity: Partial<ServiceJob>) => {
        saved = { ...entity, id: 'job-1', version: 1 };
        return saved;
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsService,
        JobStoreService,
        {
          provide: getRepositoryToken(ServiceJob),
          useValue: {
            findOne: jest.fn(async () =>
              saved ? { ...saved, serviceCenterId: 'center-1' } : null,
            ),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
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
          provide: getDataSourceToken(),
          useValue: {
            transaction: jest.fn(
              async (work: (manager: unknown) => Promise<unknown>) =>
                work({ getRepository: () => managerRepo }),
            ),
          },
        },
        {
          provide: EventsService,
          useValue: {
            append: jest.fn(),
            appendStatusChange: jest.fn(),
            writeAuditLog: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(JobsService);
    jobRepository = module.get(getRepositoryToken(ServiceJob));
  });

  it('opens a walk-in job with a job number and CHECKED_IN status', async () => {
    const job = await service.create(auth, {
      customerPhone: '+919876543210',
      vehicleRegistration: 'MH12 AB-1234',
      serviceType: 'Periodic service',
      vehicleType: VehicleType.TWO_WHEELER,
    });

    expect(job.id).toBe('job-1');
    expect(job.status).toBe(JobStatus.CHECKED_IN);
    expect(job.jobNumber).toMatch(/^JC-\d{8}-[A-Z2-9]{4}$/);
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
      version: 1,
    } as ServiceJob);

    await expect(
      service.updateStatus(auth, 'job-1', { status: JobStatus.COMPLETED }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('routes cancellation through its own command', async () => {
    jobRepository.findOne.mockResolvedValue({
      id: 'job-1',
      serviceCenterId: 'center-1',
      status: JobStatus.IN_PROGRESS,
      version: 1,
    } as ServiceJob);

    await expect(
      service.updateStatus(auth, 'job-1', { status: JobStatus.CANCELLED }),
    ).rejects.toThrow(/\/cancel/);
  });
});
