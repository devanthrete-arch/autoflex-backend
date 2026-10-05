import { MigrationInterface, QueryRunner } from 'typeorm';

export class OwnershipAfterService1730000000005 implements MigrationInterface {
  name = 'OwnershipAfterService1730000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const value of [
      'INSPECTION_SKIPPED',
      'QC_SKIPPED',
      'INVOICE_ISSUED',
      'PAYMENT_RECORDED',
    ]) {
      await queryRunner.query(
        `ALTER TYPE "job_event_type_enum" ADD VALUE '${value}'`,
      );
    }

    await queryRunner.query(`
      ALTER TABLE "service_centers"
        ADD COLUMN "express_skip_enabled" boolean NOT NULL DEFAULT false,
        ADD COLUMN "upi_vpa" character varying(100)
    `);

    await queryRunner.query(`
      ALTER TABLE "service_jobs"
        ADD COLUMN "skipped_steps" jsonb,
        ADD COLUMN "close_checklist" jsonb,
        ADD COLUMN "final_amount_inr" numeric(12,2),
        ADD COLUMN "amount_adjustment_reason" character varying(24),
        ADD COLUMN "amount_adjustment_note" text,
        ADD COLUMN "final_notes" text,
        ADD COLUMN "pickup_note" text
    `);
    await queryRunner.query(`
      ALTER TABLE "service_job_line_items"
        ADD COLUMN "part_returned_at" TIMESTAMPTZ
    `);

    await queryRunner.query(`
      CREATE TYPE "invoice_status_enum" AS ENUM ('DUE', 'PAID', 'VOID')
    `);
    await queryRunner.query(`
      CREATE TABLE "invoices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "service_center_id" uuid NOT NULL,
        "job_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "customer_profile_id" uuid,
        "invoice_number" character varying(20) NOT NULL,
        "status" "invoice_status_enum" NOT NULL DEFAULT 'DUE',
        "subtotal_inr" numeric(12,2) NOT NULL,
        "adjustment_inr" numeric(12,2) NOT NULL DEFAULT 0,
        "tax_inr" numeric(12,2) NOT NULL DEFAULT 0,
        "total_inr" numeric(12,2) NOT NULL,
        "paid_inr" numeric(12,2) NOT NULL DEFAULT 0,
        "seller" jsonb NOT NULL,
        "buyer" jsonb NOT NULL,
        "notes" text,
        "issued_at" TIMESTAMPTZ NOT NULL,
        "paid_at" TIMESTAMPTZ,
        "issued_by_staff_profile_id" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_invoices" PRIMARY KEY ("id"),
        CONSTRAINT "FK_invoices_center"
          FOREIGN KEY ("service_center_id") REFERENCES "service_centers"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_invoices_job"
          FOREIGN KEY ("job_id") REFERENCES "service_jobs"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_invoices_customer"
          FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_invoices_profile"
          FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_invoices_number" ON "invoices" ("invoice_number")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_invoices_live_job" ON "invoices" ("job_id") WHERE "status" <> 'VOID'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_invoices_profile" ON "invoices" ("customer_profile_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "invoice_line_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "invoice_id" uuid NOT NULL,
        "source_line_item_id" uuid,
        "kind" character varying(16) NOT NULL,
        "description" character varying(255) NOT NULL,
        "part_type" character varying(8),
        "quantity" numeric(10,2) NOT NULL DEFAULT 1,
        "unit_price_inr" numeric(12,2) NOT NULL,
        "amount_inr" numeric(12,2) NOT NULL,
        "tax_rate_pct" numeric(5,2) NOT NULL DEFAULT 0,
        "tax_inr" numeric(12,2) NOT NULL DEFAULT 0,
        "sort_order" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_invoice_line_items" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_invoice_line_items_kind"
          CHECK ("kind" IN ('LABOUR', 'PART', 'FEE', 'ADJUSTMENT')),
        CONSTRAINT "FK_invoice_line_items_invoice"
          FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_invoice_line_items_invoice" ON "invoice_line_items" ("invoice_id")`,
    );

    await queryRunner.query(`
      CREATE TYPE "payment_method_enum" AS ENUM ('CASH', 'UPI', 'CARD', 'GATEWAY')
    `);
    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "invoice_id" uuid NOT NULL,
        "service_center_id" uuid NOT NULL,
        "method" "payment_method_enum" NOT NULL,
        "amount_inr" numeric(12,2) NOT NULL,
        "reference" character varying(64),
        "note" text,
        "received_at" TIMESTAMPTZ NOT NULL,
        "received_by_staff_profile_id" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payments" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_payments_amount" CHECK ("amount_inr" > 0),
        CONSTRAINT "FK_payments_invoice"
          FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_invoice" ON "payments" ("invoice_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_payments_reference" ON "payments" ("method", "reference") WHERE "reference" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TYPE "vault_category_enum" AS ENUM (
        'RC', 'INSURANCE', 'PUC', 'DRIVING_LICENCE', 'INVOICE', 'WARRANTY', 'SERVICE_RECORD', 'OTHER'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "vault_documents" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "customer_profile_id" uuid NOT NULL,
        "garage_vehicle_id" uuid,
        "category" "vault_category_enum" NOT NULL,
        "title" character varying(150) NOT NULL,
        "document_number" character varying(64),
        "issuer" character varying(150),
        "issue_date" date,
        "expiry_date" date,
        "file_name" character varying(255),
        "mime_type" character varying(100),
        "size_bytes" integer,
        "front_storage_key" character varying(512),
        "back_storage_key" character varying(512),
        "upload_status" "upload_status_enum" NOT NULL DEFAULT 'PENDING',
        "verification_status" character varying(12) NOT NULL DEFAULT 'UNVERIFIED',
        "status" character varying(12) NOT NULL DEFAULT 'ACTIVE',
        "notes" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "PK_vault_documents" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_vault_documents_verification"
          CHECK ("verification_status" IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')),
        CONSTRAINT "CHK_vault_documents_status" CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
        CONSTRAINT "FK_vault_documents_profile"
          FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_vault_documents_vehicle"
          FOREIGN KEY ("garage_vehicle_id") REFERENCES "garage_vehicles"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_vault_documents_profile" ON "vault_documents" ("customer_profile_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vault_documents_expiry" ON "vault_documents" ("expiry_date")`,
    );

    await queryRunner.query(`
      CREATE TYPE "maintenance_status_enum" AS ENUM ('UPCOMING', 'SNOOZED', 'COMPLETED')
    `);
    await queryRunner.query(`
      CREATE TABLE "maintenance_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "customer_profile_id" uuid NOT NULL,
        "garage_vehicle_id" uuid NOT NULL,
        "title" character varying(150) NOT NULL,
        "notes" text,
        "due_date" date,
        "due_odometer_km" integer,
        "interval_months" integer,
        "interval_km" integer,
        "last_completed_on" date,
        "last_completed_odometer_km" integer,
        "status" "maintenance_status_enum" NOT NULL DEFAULT 'UPCOMING',
        "snoozed_until" date,
        "source_job_id" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "PK_maintenance_items" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_maintenance_items_due"
          CHECK ("due_date" IS NOT NULL OR "due_odometer_km" IS NOT NULL),
        CONSTRAINT "FK_maintenance_items_profile"
          FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_maintenance_items_vehicle"
          FOREIGN KEY ("garage_vehicle_id") REFERENCES "garage_vehicles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_maintenance_items_job"
          FOREIGN KEY ("source_job_id") REFERENCES "service_jobs"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_maintenance_items_vehicle" ON "maintenance_items" ("garage_vehicle_id")`,
    );

    await queryRunner.query(`
      CREATE TYPE "notification_category_enum" AS ENUM (
        'SERVICE', 'APPROVAL', 'PAYMENT', 'MAINTENANCE', 'DOCUMENTS', 'SUPPORT'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "customer_notifications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "customer_profile_id" uuid NOT NULL,
        "category" "notification_category_enum" NOT NULL,
        "title" character varying(150) NOT NULL,
        "body" character varying(500) NOT NULL,
        "href" character varying(255),
        "job_id" uuid,
        "booking_id" uuid,
        "read_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_customer_notifications_profile"
          FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_customer_notifications_inbox" ON "customer_notifications" ("customer_profile_id", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TYPE "delivery_status_enum" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SIMULATED', 'SKIPPED')
    `);
    await queryRunner.query(`
      CREATE TABLE "notification_deliveries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "notification_id" uuid,
        "customer_profile_id" uuid,
        "service_center_id" uuid,
        "job_id" uuid,
        "channel" character varying(12) NOT NULL,
        "template_key" character varying(64) NOT NULL,
        "recipient" character varying(255),
        "payload" jsonb,
        "status" "delivery_status_enum" NOT NULL DEFAULT 'PENDING',
        "attempts" integer NOT NULL DEFAULT 0,
        "last_error" text,
        "sent_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_deliveries" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_notification_deliveries_channel"
          CHECK ("channel" IN ('IN_APP', 'WHATSAPP', 'SMS', 'EMAIL')),
        CONSTRAINT "FK_notification_deliveries_notification"
          FOREIGN KEY ("notification_id") REFERENCES "customer_notifications"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_deliveries_job" ON "notification_deliveries" ("job_id")`,
    );

    await queryRunner.query(`
      CREATE TYPE "support_status_enum" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')
    `);
    await queryRunner.query(`
      CREATE TABLE "support_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "customer_profile_id" uuid NOT NULL,
        "reference_number" character varying(20) NOT NULL,
        "category" character varying(16) NOT NULL,
        "subject" character varying(150) NOT NULL,
        "message" text NOT NULL,
        "job_id" uuid,
        "booking_id" uuid,
        "preferred_channel" character varying(12),
        "status" "support_status_enum" NOT NULL DEFAULT 'OPEN',
        "resolved_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_support_requests" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_support_requests_category"
          CHECK ("category" IN ('BOOKING', 'SERVICE', 'PAYMENT', 'ACCOUNT', 'APP', 'OTHER')),
        CONSTRAINT "FK_support_requests_profile"
          FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_support_requests_job"
          FOREIGN KEY ("job_id") REFERENCES "service_jobs"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_support_requests_booking"
          FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_support_requests_reference" ON "support_requests" ("reference_number")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "support_requests"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "support_status_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_deliveries"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "delivery_status_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_notifications"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "notification_category_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "maintenance_items"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "maintenance_status_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vault_documents"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "vault_category_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payments"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payment_method_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invoice_line_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invoices"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "invoice_status_enum"`);
    await queryRunner.query(`
      ALTER TABLE "service_job_line_items" DROP COLUMN IF EXISTS "part_returned_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "service_jobs"
        DROP COLUMN IF EXISTS "pickup_note",
        DROP COLUMN IF EXISTS "final_notes",
        DROP COLUMN IF EXISTS "amount_adjustment_note",
        DROP COLUMN IF EXISTS "amount_adjustment_reason",
        DROP COLUMN IF EXISTS "final_amount_inr",
        DROP COLUMN IF EXISTS "close_checklist",
        DROP COLUMN IF EXISTS "skipped_steps"
    `);
    await queryRunner.query(`
      ALTER TABLE "service_centers"
        DROP COLUMN IF EXISTS "upi_vpa",
        DROP COLUMN IF EXISTS "express_skip_enabled"
    `);
    // Postgres cannot drop enum values; the added job event types remain.
  }
}
