import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BookingMode } from '../../common/enums/booking-mode.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { PaymentMode } from '../../common/enums/payment-mode.enum';
import { ServiceCenterStatus } from '../../common/enums/service-center-status.enum';
import { VehicleType } from '../../common/enums/vehicle-type.enum';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { GarageService } from '../customers/garage.service';
import { MeService } from '../customers/me.service';
import { OfferingsService } from '../offerings/offerings.service';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import { TenancyService } from '../tenancy/tenancy.service';
import { generateBookingNumber } from './booking-view';
import { BookingsService } from './bookings.service';
import { BookingAttachment } from './entities/booking-attachment.entity';
import { Booking } from './entities/booking.entity';

describe('BookingsService', () => {
  let service: BookingsService;
  let bookingRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    count: jest.Mock;
    save: jest.Mock;
  };
  let saved: Partial<Booking> | null;

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
    slotCapacity: 1,
    supportedVehicleTypes: [VehicleType.TWO_WHEELER],
    hoursStart: '09:00',
    hoursEnd: '17:00',
  };

  const futureSlot = {
    slotStart: '2027-06-15T03:30:00.000Z',
    slotEnd: '2027-06-15T04:30:00.000Z',
  };

  beforeEach(async () => {
    saved = null;
    bookingRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      findOneOrFail: jest.fn(async () => ({ ...saved, items: [] })),
      count: jest.fn().mockResolvedValue(0),
      save: jest.fn(async (entity: Booking) => entity),
    };
    const manager = {
      getRepository: () => ({
        create: (entity: Partial<Booking>) => entity,
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn(async (entity: Partial<Booking>) => {
          saved = { ...entity, id: 'booking-1' };
          return saved;
        }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getRepositoryToken(Booking), useValue: bookingRepo },
        {
          provide: getRepositoryToken(ServiceCenter),
          useValue: { findOne: jest.fn().mockResolvedValue(center) },
        },
        { provide: getRepositoryToken(BookingAttachment), useValue: {} },
        {
          provide: GarageService,
          useValue: {
            getOwned: jest.fn().mockResolvedValue({
              id: 'vehicle-1',
              vehicleType: VehicleType.TWO_WHEELER,
            }),
          },
        },
        {
          provide: MeService,
          useValue: {
            ensureProfile: jest.fn().mockResolvedValue({
              id: 'profile-1',
              dateOfBirth: '1994-03-12',
            }),
          },
        },
        {
          provide: TenancyService,
          useValue: {
            getHoursForDate: jest.fn().mockResolvedValue({
              dayOfWeek: 2,
              openTime: '09:00',
              closeTime: '17:00',
              isClosed: false,
            }),
          },
        },
        {
          provide: OfferingsService,
          useValue: { requireBookable: jest.fn() },
        },
        {
          provide: DataSource,
          useValue: {
            transaction: (work: (m: typeof manager) => unknown) =>
              work(manager),
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
      ...futureSlot,
    });

    expect(booking.status).toBe(BookingStatus.AWAITING_ARRIVAL);
    expect(booking.mode).toBe(BookingMode.SELF_CHECKIN);
    expect(booking.paymentMode).toBe(PaymentMode.PAY_AT_CENTER);
    expect(booking.estimateInr).toBe('2499.00');
    expect(booking.bookingNumber).toMatch(/^AF-\d{8}-[A-Z2-9]{4}$/);
    expect(booking.confirmedAt).toBeInstanceOf(Date);
  });

  it('rejects non-SELF_CHECKIN modes', async () => {
    await expect(
      service.create(auth, {
        serviceCenterId: 'center-1',
        vehicleId: 'vehicle-1',
        mode: 'PICKUP' as BookingMode,
        ...futureSlot,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a full slot', async () => {
    bookingRepo.count.mockResolvedValueOnce(1);
    await expect(
      service.create(auth, {
        serviceCenterId: 'center-1',
        vehicleId: 'vehicle-1',
        mode: BookingMode.SELF_CHECKIN,
        ...futureSlot,
      }),
    ).rejects.toThrow('Slot is no longer available');
  });

  it('lists the customer bookings newest first', async () => {
    bookingRepo.find.mockResolvedValueOnce([
      {
        id: 'booking-1',
        bookingNumber: 'AF-20270615-K7Q2',
        status: BookingStatus.AWAITING_ARRIVAL,
        mode: BookingMode.SELF_CHECKIN,
        estimateInr: '2499.00',
        slotStart: new Date(futureSlot.slotStart),
        slotEnd: new Date(futureSlot.slotEnd),
        paymentMode: PaymentMode.PAY_AT_CENTER,
        issueDescription: 'Noise',
        vehicleId: 'vehicle-1',
        serviceCenterId: 'center-1',
        customerProfileId: 'profile-1',
        items: [],
        attachments: [],
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
    bookingRepo.findOne.mockResolvedValue({
      id: 'booking-1',
      customerProfileId: 'someone-else',
    });

    await expect(service.getOne(auth, 'booking-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses to cancel a checked-in booking', async () => {
    bookingRepo.findOne.mockResolvedValue({
      id: 'booking-1',
      customerProfileId: 'profile-1',
      status: BookingStatus.CHECKED_IN,
      slotStart: new Date(futureSlot.slotStart),
    });

    await expect(service.cancel(auth, 'booking-1', {})).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('generateBookingNumber', () => {
  it('dates the number in IST', () => {
    const lateEvening = new Date('2027-06-14T20:00:00.000Z');
    expect(generateBookingNumber(lateEvening)).toMatch(/^AF-20270615-/);
  });
});
