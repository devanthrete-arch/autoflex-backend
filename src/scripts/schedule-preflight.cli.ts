import dataSource from '../database/data-source';
import { ServiceCenter } from '../modules/tenancy/entities/service-center.entity';
import { OperatingHour } from '../modules/tenancy/entities/operating-hour.entity';
import { StaffProfile } from '../modules/tenancy/entities/staff-profile.entity';
import { TenancyService } from '../modules/tenancy/tenancy.service';
import { SchedulingService } from '../modules/scheduling/scheduling.service';
import { validateSchedule } from '../modules/scheduling/schedule';

/** Read-only audit. Does not repair, truncate, bootstrap or send notifications. Run after migrations. */
async function main() {
  await dataSource.initialize();
  try {
    const tenancy = new TenancyService(
      dataSource.getRepository(ServiceCenter),
      dataSource.getRepository(StaffProfile),
      dataSource.getRepository(OperatingHour),
    );
    const scheduling = new SchedulingService(dataSource, tenancy);
    const rows = await dataSource.transaction(
      'REPEATABLE READ',
      async (manager) => {
        await manager.query('SET TRANSACTION READ ONLY');
        const centers = await manager
          .getRepository(ServiceCenter)
          .find({ order: { id: 'ASC' } });
        const results: object[] = [];
        for (const center of centers) {
          try {
            const schedule = validateSchedule(
              await scheduling.configuration(center, manager),
            );
            results.push({
              centerId: center.id,
              revision: center.scheduleRevision,
              valid: true,
              inherited: !center.scheduleRules,
              impact: await scheduling.impact(manager, center, schedule),
            });
          } catch (err) {
            process.exitCode = 1;
            results.push({
              centerId: center.id,
              valid: false,
              error: err instanceof Error ? err.message : 'Invalid schedule',
            });
          }
        }
        return results;
      },
    );
    console.log(
      JSON.stringify(
        {
          centers: rows,
          note: 'Existing arrivals are preserved. Review closures, excess occupancy and grid conflicts with the center before changing hours.',
        },
        null,
        2,
      ),
    );
  } finally {
    await dataSource.destroy();
  }
}
void main().catch(() => {
  console.error(
    'Scheduling preflight failed. Check the database connection and run migrations first.',
  );
  process.exitCode = 1;
});
