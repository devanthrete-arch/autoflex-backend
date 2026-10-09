import 'reflect-metadata';
import dataSource from '../database/data-source';
async function main() {
  await dataSource.initialize();
  try {
    // Aggregate-only preflight. It works before and after migration 0008.
    const statuses = await dataSource.query(
      'SELECT status, count(*)::int AS count FROM support_requests GROUP BY status ORDER BY status',
    );
    const links =
      await dataSource.query(`SELECT count(*)::int AS needs_review FROM support_requests r
      LEFT JOIN bookings b ON b.id = r.booking_id
      LEFT JOIN service_jobs j ON j.id = r.job_id
      LEFT JOIN customers c ON c.id = j.customer_id
      WHERE (r.booking_id IS NOT NULL AND (b.id IS NULL OR b.customer_profile_id IS DISTINCT FROM r.customer_profile_id))
         OR (r.job_id IS NOT NULL AND (j.id IS NULL OR c.customer_profile_id IS DISTINCT FROM r.customer_profile_id))
         OR (r.booking_id IS NOT NULL AND r.job_id IS NOT NULL AND b.service_job_id IS DISTINCT FROM r.job_id)`);
    console.log(
      JSON.stringify(
        { statuses, linkedRequestsNeedingReview: links[0].needs_review },
        null,
        2,
      ),
    );
    console.log(
      'Back up the target database before migrating. Legacy IN_PROGRESS returns to OPEN; terminal explanations remain unknown.',
    );
  } finally {
    await dataSource.destroy();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Support preflight failed',
  );
  process.exitCode = 1;
});
