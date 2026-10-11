import { ExecutionContext, HttpException } from '@nestjs/common';
import {
  BOOKING_SELECTION_LIMITS,
  BookingSelectionRateLimitGuard,
} from './booking-selection-rate-limit.guard';

describe('BookingSelectionRateLimitGuard', () => {
  let guard: BookingSelectionRateLimitGuard;
  const setHeader = jest.fn();
  const context = (ip?: string, forwardedIp = '203.0.113.1') =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          ip,
          socket: { remoteAddress: '127.0.0.1' },
          headers: { 'x-forwarded-for': forwardedIp },
        }),
        getResponse: () => ({ setHeader }),
      }),
    }) as unknown as ExecutionContext;
  const exhaust = (ip?: string) => {
    for (let n = 0; n < BOOKING_SELECTION_LIMITS.maxRequests; n++)
      expect(guard.canActivate(context(ip))).toBe(true);
  };
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-11T00:00:00Z'));
    guard = new BookingSelectionRateLimitGuard();
    setHeader.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('bounds a burst, gives a decreasing Retry-After, and permits recovery after expiry', () => {
    exhaust('192.0.2.1');
    expect(() => guard.canActivate(context('192.0.2.1'))).toThrow(
      HttpException,
    );
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '60');
    jest.advanceTimersByTime(30_001);
    expect(() => guard.canActivate(context('192.0.2.1'))).toThrow(
      HttpException,
    );
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '30');
    jest.advanceTimersByTime(29_999);
    expect(guard.canActivate(context('192.0.2.1'))).toBe(true);
  });

  it('keeps clients independent and does not reset a blocked client when another arrives', () => {
    exhaust('192.0.2.1');
    expect(guard.canActivate(context('192.0.2.2'))).toBe(true);
    expect(() => guard.canActivate(context('192.0.2.1'))).toThrow(
      HttpException,
    );
  });

  it('falls back to the socket identity rather than trusting caller forwarding headers', () => {
    exhaust();
    expect(() => guard.canActivate(context(undefined, '203.0.113.99'))).toThrow(
      HttpException,
    );
  });

  it('bounds retained client identities without evicting active limits and recovers expired space', () => {
    for (let n = 0; n < BOOKING_SELECTION_LIMITS.maxClients; n++)
      guard.canActivate(context(`2001:db8::${n.toString(16)}`));
    expect(() => guard.canActivate(context('new-client'))).toThrow(
      HttpException,
    );
    expect(guard.canActivate(context('2001:db8::0'))).toBe(true);
    jest.advanceTimersByTime(BOOKING_SELECTION_LIMITS.windowMs);
    expect(guard.canActivate(context('new-client'))).toBe(true);
  });
});
