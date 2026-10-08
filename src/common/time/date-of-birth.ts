import { BadRequestException } from '@nestjs/common';
import { istToday } from './ist';

/** Date columns normally arrive as strings. Date fallbacks use the India day. */
export function dateOfBirthString(
  value: string | Date | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    // Preserve invalid values for validation instead of throwing during rendering.
    return Number.isNaN(value.getTime())
      ? String(value)
      : istToday(value.getTime());
  }
  return value;
}

/** Whole years on an India calendar date; Feb 29 rolls to March 1 in non-leap years. */
export function ageYears(
  dateOfBirth: string | null,
  today = istToday(),
): number | null {
  if (!dateOfBirth) return null;
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  const [nowYear, nowMonth, nowDay] = today.split('-').map(Number);
  let age = nowYear - year;
  if (nowMonth < month || (nowMonth === month && nowDay < day)) age -= 1;
  return age;
}

/** Rejects dates that are not real, are in the future, or are before 1900. */
export function assertDateOfBirth(value: string, today = istToday()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('Enter a date of birth');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('Enter a real date of birth');
  }
  if (value < '1900-01-01' || value > today) {
    throw new BadRequestException(
      'Date of birth must be from 1900 through today',
    );
  }
  return value;
}
