import { UnprocessableEntityException } from '@nestjs/common';
import {
  ageYears,
  assertDateOfBirth,
  dateOfBirthString,
} from '../../common/time/date-of-birth';
import { istToday } from '../../common/time/ist';

export type BookingEligibilityCode =
  | 'BOOKING_DATE_OF_BIRTH_REQUIRED'
  | 'BOOKING_DATE_OF_BIRTH_INVALID'
  | 'BOOKING_MINIMUM_AGE';

export type BookingEligibility = {
  minimumAge: 18;
} & (
  | { eligible: true; code: null; message: null }
  | { eligible: false; code: BookingEligibilityCode; message: string }
);

/** AF-012: the account holder must be 18 on the submission date in India. */
export function bookingEligibility(
  storedDateOfBirth: string | Date | null,
  today = istToday(),
): BookingEligibility {
  const dateOfBirth = dateOfBirthString(storedDateOfBirth);
  if (!dateOfBirth) {
    return {
      eligible: false,
      minimumAge: 18,
      code: 'BOOKING_DATE_OF_BIRTH_REQUIRED',
      message: 'Add your date of birth to your profile before booking.',
    };
  }
  try {
    assertDateOfBirth(dateOfBirth, today);
  } catch {
    return {
      eligible: false,
      minimumAge: 18,
      code: 'BOOKING_DATE_OF_BIRTH_INVALID',
      message: 'Correct the date of birth on your profile before booking.',
    };
  }
  if (ageYears(dateOfBirth, today)! < 18) {
    return {
      eligible: false,
      minimumAge: 18,
      code: 'BOOKING_MINIMUM_AGE',
      message:
        'You need to be 18 to book a service. An adult can book from their own Autoflex account.',
    };
  }
  return { eligible: true, minimumAge: 18, code: null, message: null };
}

export function assertBookingEligibility(
  dateOfBirth: string | Date | null,
): void {
  const eligibility = bookingEligibility(dateOfBirth);
  if (!eligibility.eligible) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'Unprocessable Entity',
      code: eligibility.code,
      message: eligibility.message,
    });
  }
}
