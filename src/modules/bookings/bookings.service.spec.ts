import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BookingMode } from '../../common/enums/booking-mode.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { PaymentMode } from '../../common/enums/payment-mode.enum';
import { ServiceCenterStatus } from '../../common/enums/service-center-status.enum';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { GarageService } from '../customers/garage.service';
import { MeService } from '../customers/me.service';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import { BookingsService } from './bookings.service';
import { Booking } from './entities/booking.entity';

describe('BookingsService', () => {
  let service: BookingsService;

  const auth: AuthContext = {
    actorType: 'customer',
    userId: 'user-1',
    domainId: 'domain-1',
    domainApplicationId: 'cust-app-123',
    roles: ['customer'],
    permissions: [],
    serviceCenterId: null,
    staffProfileId: null,
    customerProfileId: 'profile-1',
    phone: '9876543210',
  };

  const center = {
    id: 'center-1',
    status: ServiceCenterStatus.ACTIVE,
    bookingEnabled: true,
    autoAccept: true,
    hoursStart: '09:00',
    hoursEnd: '17:00',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        {
          provide: getRepositoryToken(Booking),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn().mockResolvedValue(null),
            create: jest.fn((entity: Booking) => entity),
            save: jest.fn(async (entity: Booking) => ({
              ...entity,
              id: 'booking-1',
            })),
          },
        },
        {
          provide: getRepositoryToken(ServiceCenter),
          useValue: {
            findOne: jest.fn().mockResolvedValue(center),
          },
        },
        {
          provide: GarageService,
          useValue: {
            getOwned: jest.fn().mockResolvedValue({ id: 'vehicle-1' }),
          },
        },
        {
          provide: MeService,
          useValue: {
            upsertProfile: jest.fn(),
            getProfile: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(BookingsService);
  });

  it('creates SELF_CHECKIN as AWAITING_ARRIVAL when autoAccept is true', async () => {
    const booking = await service.create(auth, {
      serviceCenterId: 'center-1',
      vehicleId: 'vehicle-1',
      mode: BookingMode.SELF_CHECKIN,
      slotStart: '2027-06-15T03:30:00.000Z',
      slotEnd: '2027-06-15T04:30:00.000Z',
    });

    expect(booking.status).toBe(BookingStatus.AWAITING_ARRIVAL);
    expect(booking.mode).toBe(BookingMode.SELF_CHECKIN);
    expect(booking.paymentMode).toBe(PaymentMode.PAY_AT_CENTER);
    expect(booking.estimateInr).toBe('2499');
  });

  it('rejects non-SELF_CHECKIN modes', async () => {
    await expect(
      service.create(auth, {
        serviceCenterId: 'center-1',
        vehicleId: 'vehicle-1',
        mode: 'PICKUP' as BookingMode,
        slotStart: '2027-06-15T03:30:00.000Z',
        slotEnd: '2027-06-15T04:30:00.000Z',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('lists the customer bookings newest first', async () => {
    const bookingRepo = (
      service as unknown as {
        bookingRepository: { find: jest.Mock };
      }
    ).bookingRepository;
    bookingRepo.find.mockResolvedValueOnce([
      {
        id: 'booking-1',
        status: BookingStatus.AWAITING_ARRIVAL,
        mode: BookingMode.SELF_CHECKIN,
        estimateInr: '2499',
        slotStart: new Date('2027-06-15T03:30:00.000Z'),
        slotEnd: new Date('2027-06-15T04:30:00.000Z'),
        paymentMode: PaymentMode.PAY_AT_CENTER,
        issueDescription: 'Noise',
        vehicleId: 'vehicle-1',
        serviceCenterId: 'center-1',
        customerProfileId: 'profile-1',
        vehicle: {
          make: 'Honda',
          model: 'Activa',
          registrationNumber: 'KA01AB1234',
        },
        serviceCenter: { displayName: 'Apex Auto Garage', name: 'Apex' },
      },
    ]);

    const result = await service.listForCustomer(auth);

    expect(bookingRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerProfileId: 'profile-1' },
        order: { createdAt: 'DESC' },
      }),
    );
    expect(result.items[0].vehicleLabel).toBe('Honda Activa');
    expect(result.items[0].centerName).toBe('Apex Auto Garage');
  });

  it('forbids reading another customer booking', async () => {
    const bookingRepo = (
      service as unknown as {
        bookingRepository: { findOne: jest.Mock };
      }
    ).bookingRepository;
    bookingRepo.findOne.mockResolvedValue({
      id: 'booking-1',
      customerProfileId: 'someone-else',
    });

    await expect(service.getOne(auth, 'booking-1')).rejects.toThrow(
      ForbiddenException,
    );
  });
});
