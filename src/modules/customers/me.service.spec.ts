import { Repository } from 'typeorm';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { CustomerProfile } from './entities/customer-profile.entity';
import { MeService } from './me.service';

describe('profile date-of-birth presentation', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    '2008-10-08',
    new Date('2008-10-08T00:00:00+05:30'),
    new Date('2008-10-08T00:00:00Z'),
  ])('preserves the calendar birthday for %s', async (dateOfBirth) => {
    const repository = {
      findOne: jest.fn(async () => ({ id: 'profile-1', dateOfBirth })),
    };
    const service = new MeService(
      repository as unknown as Repository<CustomerProfile>,
    );
    const auth = { userId: 'customer-1' } as AuthContext;
    const clock = jest.spyOn(Date, 'now');

    clock.mockReturnValue(Date.parse('2026-10-07T18:29:59Z'));
    expect(await service.getProfile(auth)).toMatchObject({
      dateOfBirth: '2008-10-08',
      ageYears: 17,
      bookingEligibility: { eligible: false, code: 'BOOKING_MINIMUM_AGE' },
    });

    clock.mockReturnValue(Date.parse('2026-10-07T18:30:00Z'));
    expect(await service.getProfile(auth)).toMatchObject({
      dateOfBirth: '2008-10-08',
      ageYears: 18,
      bookingEligibility: { eligible: true, code: null },
    });
  });
});
