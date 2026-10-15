import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  addDays,
  hmToMinutes,
  istDayOfWeek,
  istInstant,
  istToday,
  toIstParts,
} from '../../common/time/ist';

export interface HoursInterval {
  open: string;
  close: string;
}
export interface ScheduleRules {
  week: { dayOfWeek: number; intervals: HoursInterval[] }[];
  exceptions: { date: string; intervals: HoursInterval[] }[];
}
export interface BookingSchedule extends ScheduleRules {
  bookingEnabled: boolean;
  autoAccept: boolean;
  slotCapacity: number;
  leadMinutes: number;
  advanceDays: number;
}
export function assertCalendarDate(date: string) {
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  )
    throw new BadRequestException(
      'Use a valid calendar date in YYYY-MM-DD format',
    );
}
export function validateSchedule(value: BookingSchedule): BookingSchedule {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Send a schedule object');
  const allowed = [
    'week',
    'exceptions',
    'bookingEnabled',
    'autoAccept',
    'slotCapacity',
    'leadMinutes',
    'advanceDays',
  ];
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new BadRequestException('Unknown schedule field');
  for (const [key, min, max] of [
    ['slotCapacity', 1, 50],
    ['leadMinutes', 0, 10080],
    ['advanceDays', 1, 90],
  ] as const) {
    if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max)
      throw new BadRequestException(
        `${key} must be an integer between ${min} and ${max}`,
      );
  }
  if (
    typeof value.bookingEnabled !== 'boolean' ||
    typeof value.autoAccept !== 'boolean'
  )
    throw new BadRequestException('Booking settings must be booleans');
  if (
    !Array.isArray(value.week) ||
    value.week.length !== 7 ||
    new Set(value.week.map((day) => day?.dayOfWeek)).size !== 7
  )
    throw new BadRequestException(
      'Provide each of the seven weekdays exactly once',
    );
  function intervals(input: HoursInterval[]): HoursInterval[] {
    if (!Array.isArray(input) || input.length > 8)
      throw new BadRequestException(
        'Provide up to eight working intervals per day',
      );
    const result = input
      .map((item) => {
        if (
          !item ||
          typeof item !== 'object' ||
          Object.keys(item).some((key) => !['open', 'close'].includes(key)) ||
          typeof item.open !== 'string' ||
          typeof item.close !== 'string' ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.open) ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.close) ||
          hmToMinutes(item.close) - hmToMinutes(item.open) < 60
        )
          throw new BadRequestException(
            'Each interval must last at least 60 minutes within the same day (HH:MM)',
          );
        return { open: item.open, close: item.close };
      })
      .sort((a, b) => a.open.localeCompare(b.open));
    if (
      result.some(
        (item, index) => index > 0 && item.open < result[index - 1].close,
      )
    )
      throw new BadRequestException('Working intervals must not overlap');
    return result;
  }
  const week = value.week
    .map((day) => {
      if (
        !day ||
        Object.keys(day).some(
          (key) => !['dayOfWeek', 'intervals'].includes(key),
        ) ||
        !Number.isInteger(day.dayOfWeek) ||
        day.dayOfWeek < 0 ||
        day.dayOfWeek > 6
      )
        throw new BadRequestException('Invalid weekday');
      return { dayOfWeek: day.dayOfWeek, intervals: intervals(day.intervals) };
    })
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  if (!Array.isArray(value.exceptions) || value.exceptions.length > 366)
    throw new BadRequestException('Provide up to 366 date exceptions');
  const exceptions = value.exceptions
    .map((day) => {
      if (
        !day ||
        Object.keys(day).some((key) => !['date', 'intervals'].includes(key)) ||
        typeof day.date !== 'string'
      )
        throw new BadRequestException('Invalid date exception');
      assertCalendarDate(day.date);
      return { date: day.date, intervals: intervals(day.intervals) };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  if (new Set(exceptions.map((day) => day.date)).size !== exceptions.length)
    throw new BadRequestException('Date exceptions must be unique');
  return { ...value, week, exceptions };
}
export function intervalsForDate(
  rules: ScheduleRules,
  date: string,
): HoursInterval[] {
  assertCalendarDate(date);
  return (
    rules.exceptions.find((day) => day.date === date)?.intervals ??
    rules.week.find((day) => day.dayOfWeek === istDayOfWeek(date))?.intervals ??
    []
  );
}
export function canonicalSlots(date: string, intervals: HoursInterval[]) {
  assertCalendarDate(date);
  return intervals.flatMap(({ open, close }) => {
    const slots: { start: Date; end: Date }[] = [];
    for (
      let minute = hmToMinutes(open);
      minute + 60 <= hmToMinutes(close);
      minute += 60
    ) {
      const start = istInstant(date, minute);
      slots.push({ start, end: new Date(start.getTime() + 3600000) });
    }
    return slots;
  });
}
export function bookingWindow(advanceDays: number, now = Date.now()) {
  const firstDate = istToday(now);
  return { firstDate, lastDate: addDays(firstDate, advanceDays - 1) };
}
export function slotRefusal(
  schedule: Pick<BookingSchedule, 'leadMinutes' | 'advanceDays'>,
  start: Date,
  now = Date.now(),
) {
  const { firstDate, lastDate } = bookingWindow(schedule.advanceDays, now);
  const date = toIstParts(start).date;
  if (date < firstDate || date > lastDate) return 'OUTSIDE_BOOKING_WINDOW';
  if (
    start.getTime() <= now ||
    start.getTime() < now + schedule.leadMinutes * 60000
  )
    return 'INSUFFICIENT_NOTICE';
  return null;
}
export function assertCanonicalSlot(
  schedule: Pick<BookingSchedule, 'leadMinutes' | 'advanceDays'>,
  intervals: HoursInterval[],
  start: Date,
  end: Date,
  now = Date.now(),
) {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()))
    throw new BadRequestException('Invalid slot');
  const reason = slotRefusal(schedule, start, now);
  if (
    reason ||
    !canonicalSlots(toIstParts(start).date, intervals).some(
      (slot) =>
        slot.start.getTime() === start.getTime() &&
        slot.end.getTime() === end.getTime(),
    )
  )
    throw new ConflictException({
      code: 'BOOKING_SLOT_UNAVAILABLE',
      reason: reason ?? 'SCHEDULE_CHANGED',
      message:
        'This arrival slot is no longer available. Choose a current slot.',
    });
}
