import { UnprocessableEntityException } from '@nestjs/common';
import { ageYears } from '../../common/time/date-of-birth';
import {
  assertBookingEligibility,
  bookingEligibility,
} from './booking-eligibility';

describe('booking eligibility', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['2008-10-08', '2026-10-07', 17, false],
    ['2008-10-08', '2026-10-08', 18, true],
    ['2008-10-08', '2026-10-09', 18, true],
    ['2008-02-29', '2026-02-28', 17, false],
    ['2008-02-29', '2026-03-01', 18, true],
    ['2004-02-29', '2024-02-29', 20, true],
  ])('DOB %s on %s is age %i (eligible: %s)', (dob, today, age, eligible) => {
    expect(ageYears(dob, today)).toBe(age);
    expect(bookingEligibility(dob, today)).toMatchObject({
      eligible,
      minimumAge: 18,
    });
  });

  it('becomes eligible at midnight in India, before the UTC birthday', () => {
    const clock = jest.spyOn(Date, 'now');
    clock.mockReturnValue(Date.parse('2026-10-07T18:29:59.999Z'));
    expect(bookingEligibility('2008-10-08').eligible).toBe(false);
    clock.mockReturnValue(Date.parse('2026-10-07T18:30:00.000Z'));
    expect(bookingEligibility('2008-10-08').eligible).toBe(true);
  });

  it.each([
    new Date('2008-10-08T00:00:00+05:30'),
    new Date('2008-10-08T00:00:00Z'),
  ])(
    'uses the India birth date for Date input %s at the booking boundary',
    (dob) => {
      jest
        .spyOn(Date, 'now')
        .mockReturnValue(Date.parse('2026-10-07T18:29:59Z'));
      expect(() => assertBookingEligibility(dob)).toThrow(
        UnprocessableEntityException,
      );
      expect(bookingEligibility(dob, '2026-10-08').eligible).toBe(true);
    },
  );

  it('rejects an invalid Date object as an invalid stored date', () => {
    expect(bookingEligibility(new Date('invalid'))).toMatchObject({
      eligible: false,
      code: 'BOOKING_DATE_OF_BIRTH_INVALID',
    });
  });

  it.each([
    'not-a-date',
    '2008-02-30',
    '2009-02-29',
    '2026-10-09',
    '1899-12-31',
  ])('rejects invalid stored date %s', (dob) => {
    expect(bookingEligibility(dob, '2026-10-08')).toMatchObject({
      eligible: false,
      code: 'BOOKING_DATE_OF_BIRTH_INVALID',
    });
  });

  it('distinguishes missing dates from being under 18', () => {
    expect(bookingEligibility(null)).toMatchObject({
      eligible: false,
      code: 'BOOKING_DATE_OF_BIRTH_REQUIRED',
    });
    expect(bookingEligibility('2010-01-01', '2026-10-08')).toMatchObject({
      eligible: false,
      code: 'BOOKING_MINIMUM_AGE',
    });
    expect(() => assertBookingEligibility(null)).toThrow(
      UnprocessableEntityException,
    );
  });
});
