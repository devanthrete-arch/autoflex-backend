import { MigrationInterface, QueryRunner } from 'typeorm';

export class InCenterService1730000000004 implements MigrationInterface {
  name = 'InCenterService1730000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const value of [
      'ASSIGNED',
      'INSPECTION_RECORDED',
      'QC_RECORDED',
      'LINE_ITEMS_CHANGED',
    ]) {
      await queryRunner.query(
        `ALTER TYPE "job_event_type_enum" ADD VALUE '${value}'`,
      );
    }
    await queryRunner.query(`
      CREATE TYPE "job_line_kind_enum" AS ENUM ('LABOUR', 'PART', 'FEE')
    `);
    await queryRunner.query(`
      CREATE TYPE "job_line_status_enum" AS ENUM ('INCLUDED', 'PENDING', 'APPROVED', 'DECLINED')
    `);
    await queryRunner.query(`
      CREATE TYPE "job_approval_status_enum" AS ENUM (
        'PENDING', 'APPROVED', 'PARTIALLY_APPROVED', 'DECLINED', 'WITHDRAWN'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "job_media_kind_enum" AS ENUM (
        'PRE_CONDITION', 'INSPECTION', 'BEFORE', 'AFTER', 'PARTS', 'ODOMETER', 'COMEBACK_COMPARE'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "upload_status_enum" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED')
    `);

    await queryRunner.query(`
      ALTER TABLE "service_jobs"
        ADD COLUMN "job_number" character varying(20),
        ADD COLUMN "version" integer NOT NULL DEFAULT 1,
        ADD COLUMN "customer_request" text,
        ADD COLUMN "waiting_on_site" boolean NOT NULL DEFAULT false,
        ADD COLUMN "previous_status" "job_status_enum",
        ADD COLUMN "hold_reason" text,
        ADD COLUMN "expected_resume_at" TIMESTAMPTZ,
        ADD COLUMN "cancellation_reason" text,
        ADD COLUMN "comeback_of_job_id" uuid,
        ADD COLUMN "comeback_reason" text,
        ADD COLUMN "warranty_intent" boolean NOT NULL DEFAULT false,
        ADD COLUMN "inspection" jsonb,
        ADD COLUMN "inspection_completed_at" TIMESTAMPTZ,
        ADD COLUMN "qc_passed_at" TIMESTAMPTZ,
        ADD COLUMN "qc_by_staff_profile_id" uuid,
        ADD COLUMN "qc_notes" text
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_service_jobs_job_number" ON "service_jobs" ("job_number")
    `);
    await queryRunner.query(`
      ALTER TABLE "service_jobs"
        ADD CONSTRAINT "FK_service_jobs_comeback_of"
        FOREIGN KEY ("comeback_of_job_id") REFERENCES "service_jobs"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "service_jobs"
        ADD CONSTRAINT "FK_service_jobs_qc_by"
        FOREIGN KEY ("qc_by_staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "service_job_approvals" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "job_id" uuid NOT NULL,
        "service_center_id" uuid NOT NULL,
        "version" integer NOT NULL,
        "status" "job_approval_status_enum" NOT NULL DEFAULT 'PENDING',
        "note" text,
        "total_inr" numeric(12,2) NOT NULL,
        "return_status" "job_status_enum" NOT NULL,
        "requested_by_staff_profile_id" uuid,
        "requested_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "decided_at" TIMESTAMPTZ,
        "decided_by_customer_profile_id" uuid,
        "decided_by_staff_profile_id" uuid,
        "decision_channel" character varying(16),
        "decision_note" text,
        "decision_contact_phone" character varying(16),
        "non_oem_acknowledged_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_service_job_approvals" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_service_job_approvals_channel"
          CHECK ("decision_channel" IS NULL OR "decision_channel" IN ('APP', 'PHONE', 'IN_PERSON')),
        CONSTRAINT "FK_service_job_approvals_job"
          FOREIGN KEY ("job_id") REFERENCES "service_jobs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_service_job_approvals_requested_by"
          FOREIGN KEY ("requested_by_staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_service_job_approvals_decided_by_staff"
          FOREIGN KEY ("decided_by_staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_service_job_approvals_decided_by_customer"
          FOREIGN KEY ("decided_by_customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_service_job_approvals_job_version"
      ON "service_job_approvals" ("job_id", "version")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_service_job_approvals_one_pending"
      ON "service_job_approvals" ("job_id")
      WHERE "status" = 'PENDING'
    `);

    await queryRunner.query(`
      CREATE TABLE "service_job_line_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "job_id" uuid NOT NULL,
        "service_center_id" uuid NOT NULL,
        "kind" "job_line_kind_enum" NOT NULL,
        "description" character varying(255) NOT NULL,
        "part_type" character varying(8),
        "quantity" numeric(10,2) NOT NULL DEFAULT 1,
        "unit_price_inr" numeric(12,2) NOT NULL,
        "amount_inr" numeric(12,2) NOT NULL,
        "status" "job_line_status_enum" NOT NULL,
        "approval_id" uuid,
        "source_booking_item_id" uuid,
        "created_by_staff_profile_id" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "PK_service_job_line_items" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_service_job_line_items_part_type"
          CHECK ("part_type" IS NULL OR "part_type" IN ('OEM', 'OES', 'LOCAL')),
        CONSTRAINT "CHK_service_job_line_items_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "CHK_service_job_line_items_price" CHECK ("unit_price_inr" >= 0),
        CONSTRAINT "FK_service_job_line_items_job"
          FOREIGN KEY ("job_id") REFERENCES "service_jobs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_service_job_line_items_approval"
          FOREIGN KEY ("approval_id") REFERENCES "service_job_approvals"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_service_job_line_items_booking_item"
          FOREIGN KEY ("source_booking_item_id") REFERENCES "booking_items"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_service_job_line_items_created_by"
          FOREIGN KEY ("created_by_staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_service_job_line_items_job" ON "service_job_line_items" ("job_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "service_job_media" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "job_id" uuid NOT NULL,
        "service_center_id" uuid NOT NULL,
        "kind" "job_media_kind_enum" NOT NULL,
        "storage_key" character varying(512) NOT NULL,
        "mime_type" character varying(100) NOT NULL,
        "size_bytes" integer NOT NULL,
        "caption" character varying(255),
        "visible_to_customer" boolean NOT NULL DEFAULT false,
        "upload_status" "upload_status_enum" NOT NULL DEFAULT 'PENDING',
        "line_item_id" uuid,
        "uploaded_by_staff_profile_id" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "PK_service_job_media" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_service_job_media_size" CHECK ("size_bytes" > 0),
        CONSTRAINT "FK_service_job_media_job"
          FOREIGN KEY ("job_id") REFERENCES "service_jobs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_service_job_media_line_item"
          FOREIGN KEY ("line_item_id") REFERENCES "service_job_line_items"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_service_job_media_uploaded_by"
          FOREIGN KEY ("uploaded_by_staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_service_job_media_job" ON "service_job_media" ("job_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "audit_logs"
        ADD COLUMN "before" jsonb,
        ADD COLUMN "after" jsonb,
        ADD COLUMN "correlation_id" character varying(64)
    `);

    await queryRunner.query(`
      CREATE TABLE "command_idempotency" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "scope" character varying(80) NOT NULL,
        "idempotency_key" character varying(128) NOT NULL,
        "request_hash" character varying(64) NOT NULL,
        "response_status" integer NOT NULL,
        "response_body" jsonb,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_command_idempotency" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_command_idempotency_scope_key"
      ON "command_idempotency" ("scope", "idempotency_key")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "command_idempotency"`);
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
        DROP COLUMN IF EXISTS "correlation_id",
        DROP COLUMN IF EXISTS "after",
        DROP COLUMN IF EXISTS "before"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_job_media"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_job_line_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_job_approvals"`);
    await queryRunner.query(
      `ALTER TABLE "service_jobs" DROP CONSTRAINT IF EXISTS "FK_service_jobs_qc_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_jobs" DROP CONSTRAINT IF EXISTS "FK_service_jobs_comeback_of"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_service_jobs_job_number"`,
    );
    await queryRunner.query(`
      ALTER TABLE "service_jobs"
        DROP COLUMN IF EXISTS "qc_notes",
        DROP COLUMN IF EXISTS "qc_by_staff_profile_id",
        DROP COLUMN IF EXISTS "qc_passed_at",
        DROP COLUMN IF EXISTS "inspection_completed_at",
        DROP COLUMN IF EXISTS "inspection",
        DROP COLUMN IF EXISTS "warranty_intent",
        DROP COLUMN IF EXISTS "comeback_reason",
        DROP COLUMN IF EXISTS "comeback_of_job_id",
        DROP COLUMN IF EXISTS "cancellation_reason",
        DROP COLUMN IF EXISTS "expected_resume_at",
        DROP COLUMN IF EXISTS "hold_reason",
        DROP COLUMN IF EXISTS "previous_status",
        DROP COLUMN IF EXISTS "waiting_on_site",
        DROP COLUMN IF EXISTS "customer_request",
        DROP COLUMN IF EXISTS "version",
        DROP COLUMN IF EXISTS "job_number"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "upload_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "job_media_kind_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "job_approval_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "job_line_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "job_line_kind_enum"`);
    // Postgres cannot drop enum values; the added job_event_type_enum values stay.
  }
}
