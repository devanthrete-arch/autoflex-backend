import { BadRequestException } from '@nestjs/common';

/** Presentation separators are allowed; digits are never truncated. */
export function canonicalIntakePhone(value: string): string {
  if (typeof value !== 'string' || !/^\+?[\d\s-]+$/.test(value.trim()))
    throw new BadRequestException({
      code: 'INVALID_INTAKE_INPUT',
      message: 'Enter a valid Indian mobile number',
    });
  const compact = value.trim().replace(/[\s-]/g, '');
  const match = /^(?:\+91|91)?([6-9]\d{9})$/.exec(compact);
  if (!match)
    throw new BadRequestException({
      code: 'INVALID_INTAKE_INPUT',
      message: 'Enter ten mobile digits or the equivalent +91 number',
    });
  return `+91${match[1]}`;
}

export function canonicalIntakePlate(value: string): string {
  if (typeof value !== 'string' || !/^[a-z\d\s-]+$/i.test(value.trim()))
    throw new BadRequestException({
      code: 'INVALID_INTAKE_INPUT',
      message: 'Enter a valid vehicle registration',
    });
  const compact = value.trim().replace(/[\s-]/g, '').toUpperCase();
  if (
    compact.length < 4 ||
    compact.length > 32 ||
    !/[A-Z]/.test(compact) ||
    !/\d/.test(compact)
  )
    throw new BadRequestException({
      code: 'INVALID_INTAKE_INPUT',
      message: 'Enter a valid vehicle registration',
    });
  return compact;
}

export function tryCanonicalPhone(value: string): string | null {
  try {
    return canonicalIntakePhone(value);
  } catch {
    return null;
  }
}
export function tryCanonicalPlate(value: string): string | null {
  try {
    return canonicalIntakePlate(value);
  } catch {
    return null;
  }
}
