export enum BookingStatus {
  PENDING_CENTER = 'PENDING_CENTER',
  CONFIRMED = 'CONFIRMED',
  AWAITING_ARRIVAL = 'AWAITING_ARRIVAL',
  CHECKED_IN = 'CHECKED_IN',
  NO_SHOW = 'NO_SHOW',
  CANCELLED = 'CANCELLED',
}

/** Statuses that still hold a slot and can move forward. */
export const OPEN_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING_CENTER,
  BookingStatus.CONFIRMED,
  BookingStatus.AWAITING_ARRIVAL,
];
