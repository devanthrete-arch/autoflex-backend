import { DataSource } from 'typeorm';

/** Counts only. Never print identity, plate, contact or public tracking data. */
export async function inspectVisitAccess(dataSource: DataSource) {
  return dataSource.transaction('REPEATABLE READ', async (manager) => {
    await manager.query('SET TRANSACTION READ ONLY');
    const [{ present }] = await manager.query<{ present: boolean }[]>(
      "SELECT to_regclass('public.job_customer_access') IS NOT NULL AS present",
    );
    const [legacy] = await manager.query<Record<string, number>[]>(`
      SELECT count(*)::int AS "liveJobs",
        count(*) FILTER (WHERE c.customer_profile_id IS NOT NULL AND c.deleted_at IS NULL
          AND p.id IS NOT NULL AND p.deleted_at IS NULL
          AND c.service_center_id = j.service_center_id)::int AS "currentlyLinkedJobs",
        count(*) FILTER (WHERE c.customer_profile_id IS NOT NULL AND c.deleted_at IS NULL
          AND p.id IS NOT NULL AND p.deleted_at IS NULL
          AND v.id IS NOT NULL AND v.deleted_at IS NULL
          AND c.service_center_id = j.service_center_id
          AND v.service_center_id = j.service_center_id
          AND v.customer_id = c.id)::int AS "safeBackfillJobs",
        count(*) FILTER (WHERE c.customer_profile_id IS NULL)::int AS "unlinkedJobs",
        count(*) FILTER (WHERE c.deleted_at IS NOT NULL OR p.deleted_at IS NOT NULL
          OR (c.customer_profile_id IS NOT NULL AND p.id IS NULL))::int AS "inactivePrincipalJobs",
        count(*) FILTER (WHERE c.id IS NULL OR v.id IS NULL OR v.deleted_at IS NOT NULL
          OR c.service_center_id IS DISTINCT FROM j.service_center_id
          OR v.service_center_id IS DISTINCT FROM j.service_center_id
          OR v.customer_id IS DISTINCT FROM j.customer_id)::int AS "associationMismatches"
      FROM service_jobs j LEFT JOIN customers c ON c.id = j.customer_id
      LEFT JOIN customer_profiles p ON p.id = c.customer_profile_id
      LEFT JOIN vehicles v ON v.id = j.vehicle_id WHERE j.deleted_at IS NULL`);
    const migrated = present
      ? (
          await manager.query<Record<string, number>[]>(`
          SELECT count(*) FILTER (WHERE NOT EXISTS (
            SELECT 1 FROM job_customer_access a JOIN customer_profiles p ON p.id = a.customer_profile_id
            WHERE a.job_id = j.id AND a.can_view AND a.revoked_at IS NULL AND p.deleted_at IS NULL
          ))::int AS "jobsWithoutActiveAccess",
          count(*) FILTER (WHERE j.intake_snapshot IS NULL)::int AS "jobsWithoutSnapshot",
          count(*) FILTER (WHERE j.billing_customer_profile_id IS NULL)::int AS "jobsWithoutBillingRecipient",
          count(*) FILTER (WHERE j.billing_customer_profile_id IS NOT NULL
            AND j.billing_customer_profile_id IS DISTINCT FROM c.customer_profile_id)::int AS "contactLinkChangesSinceSnapshot",
          count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM invoices i WHERE i.job_id = j.id
              AND i.customer_profile_id IS DISTINCT FROM j.billing_customer_profile_id
          ))::int AS "invoiceRecipientDifferences"
          FROM service_jobs j LEFT JOIN customers c ON c.id = j.customer_id WHERE j.deleted_at IS NULL`)
        )[0]
      : null;
    return {
      mode: 'READ_ONLY_COUNTS',
      visitAccessMigrationApplied: present,
      legacy,
      migrated,
      guidance:
        'Only active same-center contact/profile/vehicle associations receive a legacy grant. Review all other jobs before cutover. Missing or revoked access is not permission to relink history. Invoice differences require review, never a bulk rewrite.',
    };
  });
}
