import {
  assertCalendarDate,
  assertCanonicalSlot,
  bookingWindow,
  canonicalSlots,
  intervalsForDate,
  slotRefusal,
  validateSchedule,
  type BookingSchedule,
} from './schedule';
const rules = (): BookingSchedule => ({
  week: Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    intervals: [
      { open: '09:00', close: '12:00' },
      { open: '14:30', close: '17:00' },
    ],
  })),
  exceptions: [],
  bookingEnabled: true,
  autoAccept: true,
  slotCapacity: 1,
  leadMinutes: 0,
  advanceDays: 7,
});
describe('booking schedule', () => {
  it('generates full hourly arrivals anchored to each interval, without crossing a break or partial closing hour', () => {
    expect(
      canonicalSlots('2027-06-15', rules().week[0].intervals).map((s) =>
        s.start.toISOString(),
      ),
    ).toEqual([
      '2027-06-15T03:30:00.000Z',
      '2027-06-15T04:30:00.000Z',
      '2027-06-15T05:30:00.000Z',
      '2027-06-15T09:00:00.000Z',
      '2027-06-15T10:00:00.000Z',
    ]);
  });
  it.each(['2027-02-29', '2027-06-31', '2027-1-01', 'garbage'])(
    'rejects calendar rollover %s',
    (value) => expect(() => assertCalendarDate(value)).toThrow(),
  );
  it('replaces weekly hours with a date exception including an empty closure', () => {
    const r = rules();
    r.exceptions = [{ date: '2027-06-15', intervals: [] }];
    expect(intervalsForDate(r, '2027-06-15')).toEqual([]);
    expect(intervalsForDate(r, '2027-06-16')).toHaveLength(2);
  });
  it.each([
    { week: [] },
    { advanceDays: null },
    { leadMinutes: -1 },
    { slotCapacity: 1.5 },
    { extra: true },
    {
      exceptions: [
        { date: '2027-06-15', intervals: [] },
        { date: '2027-06-15', intervals: [] },
      ],
    },
    {
      week: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        intervals: [
          { open: '09:00', close: '12:00' },
          { open: '11:30', close: '13:00' },
        ],
      })),
    },
  ])('rejects malformed schedule %j', (patch) =>
    expect(() =>
      validateSchedule({ ...rules(), ...patch } as BookingSchedule),
    ).toThrow(),
  );
  it('uses seven calendar dates, switching the window at India midnight', () => {
    expect(bookingWindow(7, Date.parse('2027-06-14T18:29:59Z'))).toEqual({
      firstDate: '2027-06-14',
      lastDate: '2027-06-20',
    });
    expect(bookingWindow(7, Date.parse('2027-06-14T18:30:00Z'))).toEqual({
      firstDate: '2027-06-15',
      lastDate: '2027-06-21',
    });
  });
  it('accepts exact notice boundary but never a slot that already started', () => {
    const now = Date.parse('2027-06-15T03:00:00Z');
    expect(
      slotRefusal(
        { ...rules(), leadMinutes: 30 },
        new Date(now + 1800000),
        now,
      ),
    ).toBeNull();
    expect(
      slotRefusal(
        { ...rules(), leadMinutes: 30 },
        new Date(now + 1799999),
        now,
      ),
    ).toBe('INSUFFICIENT_NOTICE');
    expect(slotRefusal(rules(), new Date(now), now)).toBe(
      'INSUFFICIENT_NOTICE',
    );
  });
  it.each([
    ['2027-06-15T03:30:00.001Z', '2027-06-15T04:30:00.001Z'],
    ['2027-06-15T03:45:00Z', '2027-06-15T04:45:00Z'],
    ['2027-06-15T03:30:00Z', '2027-06-15T04:00:00Z'],
    ['2027-06-15T03:30:00Z', '2027-06-16T04:30:00Z'],
    ['2027-06-15T06:30:00Z', '2027-06-15T07:30:00Z'],
  ])('rejects forged slot %s to %s', (start, end) =>
    expect(() =>
      assertCanonicalSlot(
        rules(),
        rules().week[0].intervals,
        new Date(start),
        new Date(end),
        Date.parse('2027-06-14T00:00:00Z'),
      ),
    ).toThrow(),
  );
});
