import 'reflect-metadata';
import dataSource from '../database/data-source';
async function main() {
  await dataSource.initialize();
  try {
    // Aggregate-only preflight, including the explicit visit-access migration.
    const statuses = await dataSource.query<
      { status: string; count: number }[]
    >(
      'SELECT status, count(*)::int AS count FROM support_requests GROUP BY status ORDER BY status',
    );
    const [{ present: hasVisitAccess }] = await dataSource.query<
      { present: boolean }[]
    >(
      "SELECT to_regclass('public.job_customer_access') IS NOT NULL AS present",
    );
    const visitJoin = hasVisitAccess
      ? `LEFT JOIN job_customer_access a ON a.job_id = j.id AND a.customer_profile_id = r.customer_profile_id AND a.can_view = true AND a.revoked_at IS NULL
         LEFT JOIN customer_profiles p ON p.id = a.customer_profile_id AND p.deleted_at IS NULL`
      : `LEFT JOIN customers c ON c.id = j.customer_id`;
    const invalidVisit = hasVisitAccess
      ? 'a.id IS NULL OR p.id IS NULL'
      : 'c.customer_profile_id IS DISTINCT FROM r.customer_profile_id';
    const links = await dataSource.query<
      { needs_review: number }[]
    >(`SELECT count(*)::int AS needs_review FROM support_requests r
      LEFT JOIN bookings b ON b.id = r.booking_id
      LEFT JOIN service_jobs j ON j.id = r.job_id
      ${visitJoin}
      WHERE (r.booking_id IS NOT NULL AND (b.id IS NULL OR b.customer_profile_id IS DISTINCT FROM r.customer_profile_id))
         OR (r.job_id IS NOT NULL AND (j.id IS NULL OR j.deleted_at IS NOT NULL OR ${invalidVisit}))
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
