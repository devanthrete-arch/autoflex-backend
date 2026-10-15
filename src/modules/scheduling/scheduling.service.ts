import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, MoreThan } from 'typeorm';
import { ServiceCenterStatus } from '../../common/enums/service-center-status.enum';
import {
  BookingStatus,
  OPEN_BOOKING_STATUSES,
} from '../../common/enums/booking-status.enum';
import { istToday } from '../../common/time/ist';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { Booking } from '../bookings/entities/booking.entity';
import { AuditLog } from '../events/entities/audit-log.entity';
import {
  CommandMeta,
  withCommandReceipt,
} from '../idempotency/transactional-receipt';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import { TenancyService } from '../tenancy/tenancy.service';
import {
  BookingSchedule,
  assertCalendarDate,
  canonicalSlots,
  intervalsForDate,
  validateSchedule,
} from './schedule';

export const HOLDING_STATUSES = [
  ...OPEN_BOOKING_STATUSES,
  BookingStatus.CHECKED_IN,
];
@Injectable()
export class SchedulingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenancy: TenancyService,
  ) {}

  async configuration(
    center: ServiceCenter,
    manager: EntityManager,
  ): Promise<BookingSchedule> {
    const week = await this.tenancy.getWeeklyHours(center, manager);
    return {
      week: week.map((day) => ({
        dayOfWeek: day.dayOfWeek,
        intervals:
          day.intervals ??
          (day.isClosed || !day.openTime || !day.closeTime
            ? []
            : [{ open: day.openTime, close: day.closeTime }]),
      })),
      exceptions: center.scheduleRules?.exceptions ?? [],
      leadMinutes: center.bookingLeadMinutes,
      advanceDays: center.bookingAdvanceDays,
      slotCapacity: center.slotCapacity,
      bookingEnabled: center.bookingEnabled,
      autoAccept: center.autoAccept,
    };
  }
  async center(manager: EntityManager, auth: AuthContext, lock = false) {
    if (!auth.serviceCenterId) throw new NotFoundException();
    const center = await manager.getRepository(ServiceCenter).findOne({
      where: { id: auth.serviceCenterId, status: ServiceCenterStatus.ACTIVE },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!center) throw new NotFoundException();
    return center;
  }
  async impact(
    manager: EntityManager,
    center: ServiceCenter,
    schedule: BookingSchedule,
  ) {
    // Existing visits remain valid, even if the center closes their date or lowers capacity.
    const reservations = await manager.getRepository(Booking).find({
      where: {
        serviceCenterId: center.id,
        status: In(HOLDING_STATUSES),
        slotEnd: MoreThan(new Date()),
      },
    });
    let outsideHours = 0;
    const overlaps = new Set<string>();
    const counts = new Map<string, number>();
    const grid = new Map<string, ReturnType<typeof canonicalSlots>>();
    for (const row of reservations) {
      const date = istToday(row.slotStart.getTime());
      if (!grid.has(date))
        grid.set(date, canonicalSlots(date, intervalsForDate(schedule, date)));
      const slots = grid.get(date)!;
      const exact = slots.some(
        (slot) => +slot.start === +row.slotStart && +slot.end === +row.slotEnd,
      );
      if (!schedule.bookingEnabled || !exact) outsideHours++;
      // An old slot overlapping a new grid could evade the exact-start capacity counter.
      if (
        schedule.bookingEnabled &&
        slots.some(
          (slot) =>
            +slot.start < +row.slotEnd &&
            +slot.end > +row.slotStart &&
            (+slot.start !== +row.slotStart || +slot.end !== +row.slotEnd),
        )
      )
        overlaps.add(row.id);
      const key = row.slotStart.toISOString();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return {
      existingReservations: reservations.length,
      outsideHours,
      overCapacitySlots: [...counts.values()].filter(
        (count) => count > schedule.slotCapacity,
      ).length,
      conflictingGridBookings: overlaps.size,
    };
  }
  async get(auth: AuthContext) {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const center = await this.center(manager, auth);
      const schedule = await this.configuration(center, manager);
      return {
        ...schedule,
        revision: center.scheduleRevision,
        timeZone: 'Asia/Kolkata',
        slotMinutes: 60,
        impact: await this.impact(manager, center, schedule),
      };
    });
  }
  async preview(auth: AuthContext, input: BookingSchedule, date = istToday()) {
    const schedule = validateSchedule(input);
    assertCalendarDate(date);
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const center = await this.center(manager, auth);
      return {
        revision: center.scheduleRevision,
        date,
        slots: canonicalSlots(date, intervalsForDate(schedule, date)).map(
          (slot) => ({
            start: slot.start.toISOString(),
            end: slot.end.toISOString(),
          }),
        ),
        impact: await this.impact(manager, center, schedule),
      };
    });
  }
  async save(auth: AuthContext, input: BookingSchedule, meta: CommandMeta) {
    const schedule = validateSchedule(input);
    return this.dataSource.transaction(async (manager) => {
      const center = await this.center(manager, auth, true);
      return withCommandReceipt(
        manager,
        `staff:${auth.staffProfileId}`,
        meta,
        () => this.apply(manager, auth, center, schedule, meta),
      );
    });
  }
  /** Used by both the dedicated schedule API and legacy hours/settings routes. Caller holds center lock and receipt. */
  async apply(
    manager: EntityManager,
    auth: AuthContext,
    center: ServiceCenter,
    input: BookingSchedule,
    meta: CommandMeta,
  ) {
    const schedule = validateSchedule(input);
    if (center.scheduleRevision !== meta.version)
      throw new ConflictException({
        code: 'SCHEDULE_VERSION_CONFLICT',
        message: 'The schedule changed. Reload it before saving.',
      });
    const impact = await this.impact(manager, center, schedule);
    if (impact.conflictingGridBookings)
      throw new ConflictException({
        code: 'SCHEDULE_GRID_CONFLICT',
        message:
          'These hours overlap existing arrivals on a different slot grid. Keep their start times or change hours after those visits.',
        impact,
      });
    const before = await this.configuration(center, manager);
    const revision = center.scheduleRevision + 1;
    await manager.getRepository(ServiceCenter).update(center.id, {
      scheduleRevision: revision,
      scheduleRules: { week: schedule.week, exceptions: schedule.exceptions },
      bookingLeadMinutes: schedule.leadMinutes,
      bookingAdvanceDays: schedule.advanceDays,
      slotCapacity: schedule.slotCapacity,
      bookingEnabled: schedule.bookingEnabled,
      autoAccept: schedule.autoAccept,
    });
    await manager.getRepository(AuditLog).save({
      serviceCenterId: center.id,
      entityType: 'CENTER_SCHEDULE',
      entityId: center.id,
      action: 'SCHEDULE_UPDATED',
      actorStaffProfileId: auth.staffProfileId,
      before: { ...before, revision: center.scheduleRevision },
      after: { ...schedule, revision },
      metadata: { impact },
    });
    return {
      ...schedule,
      revision,
      timeZone: 'Asia/Kolkata',
      slotMinutes: 60,
      impact,
    };
  }
}
