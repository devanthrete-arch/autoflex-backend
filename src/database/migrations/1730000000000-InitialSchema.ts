import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1730000000000 implements MigrationInterface {
  name = 'InitialSchema1730000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TYPE "service_center_status_enum" AS ENUM ('ACTIVE', 'INACTIVE')
    `);
    await queryRunner.query(`
      CREATE TYPE "vehicle_type_enum" AS ENUM ('TWO_WHEELER', 'FOUR_WHEELER')
    `);
    await queryRunner.query(`
      CREATE TYPE "job_status_enum" AS ENUM (
        'CHECKED_IN', 'INSPECTION', 'AWAITING_APPROVAL', 'IN_PROGRESS',
        'QUALITY_CHECK', 'READY_FOR_PICKUP', 'COMPLETED', 'ON_HOLD', 'CANCELLED'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "job_priority_enum" AS ENUM ('NORMAL', 'URGENT')
    `);
    await queryRunner.query(`
      CREATE TYPE "job_event_type_enum" AS ENUM (
        'STATUS_CHANGE', 'NOTE', 'MEDIA_ADDED', 'APPROVAL_REQUESTED',
        'APPROVAL_RESOLVED', 'ESTIMATE_UPDATED'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "service_centers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "iam_domain_id" character varying(36) NOT NULL,
        "name" character varying(255) NOT NULL,
        "status" "service_center_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "PK_service_centers" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_service_centers_iam_domain_id"
      ON "service_centers" ("iam_domain_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "staff_profiles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "service_center_id" uuid NOT NULL,
        "iam_user_id" character varying(36) NOT NULL,
        "display_name" character varying(255) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "PK_staff_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "FK_staff_profiles_service_center"
          FOREIGN KEY ("service_center_id") REFERENCES "service_centers"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_staff_profiles_iam_user_id" ON "staff_profiles" ("iam_user_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_staff_profiles_center_user"
      ON "staff_profiles" ("service_center_id", "iam_user_id")
      WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "customers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "service_center_id" uuid NOT NULL,
        "phone" character varying(20) NOT NULL,
        "name" character varying(255),
        "secondary_contact_phone" character varying(20),
        "locale" character varying(10),
        "consent_recorded_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "PK_customers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_customers_service_center"
          FOREIGN KEY ("service_center_id") REFERENCES "service_centers"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_customers_center_phone"
      ON "customers" ("service_center_id", "phone")
      WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "vehicles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "service_center_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "registration_number" character varying(32) NOT NULL,
        "make_model" character varying(255),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "PK_vehicles" PRIMARY KEY ("id"),
        CONSTRAINT "FK_vehicles_service_center"
          FOREIGN KEY ("service_center_id") REFERENCES "service_centers"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_vehicles_customer"
          FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_vehicles_center_registration"
      ON "vehicles" ("service_center_id", "registration_number")
      WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "service_jobs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "service_center_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "vehicle_id" uuid NOT NULL,
        "vehicle_type" "vehicle_type_enum" NOT NULL DEFAULT 'TWO_WHEELER',
        "status" "job_status_enum" NOT NULL DEFAULT 'CHECKED_IN',
        "service_type" character varying(128) NOT NULL,
        "odometer_km" integer,
        "fuel_level" character varying(32),
        "estimated_ready_at" TIMESTAMPTZ,
        "assigned_technician_id" uuid,
        "priority" "job_priority_enum" NOT NULL DEFAULT 'NORMAL',
        "budget_ceiling" numeric(12,2),
        "accessories_checklist" jsonb,
        "payment_mode" character varying(32),
        "public_token" character varying(128) NOT NULL,
        "source_booking_id" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "closed_at" TIMESTAMPTZ,
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "PK_service_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_service_jobs_service_center"
          FOREIGN KEY ("service_center_id") REFERENCES "service_centers"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_service_jobs_customer"
          FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_service_jobs_vehicle"
          FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_service_jobs_technician"
          FOREIGN KEY ("assigned_technician_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_service_jobs_service_center_id" ON "service_jobs" ("service_center_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_service_jobs_status" ON "service_jobs" ("status")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_service_jobs_public_token" ON "service_jobs" ("public_token")
    `);

    await queryRunner.query(`
      CREATE TABLE "service_job_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "job_id" uuid NOT NULL,
        "service_center_id" uuid NOT NULL,
        "type" "job_event_type_enum" NOT NULL,
        "from_status" "job_status_enum",
        "to_status" "job_status_enum",
        "payload" jsonb,
        "visible_to_customer" boolean NOT NULL DEFAULT true,
        "created_by_staff_profile_id" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_service_job_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_service_job_events_job"
          FOREIGN KEY ("job_id") REFERENCES "service_jobs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_service_job_events_staff"
          FOREIGN KEY ("created_by_staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_service_job_events_job_id" ON "service_job_events" ("job_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_service_job_events_service_center_id"
      ON "service_job_events" ("service_center_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "job_assignments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "job_id" uuid NOT NULL,
        "service_center_id" uuid NOT NULL,
        "staff_profile_id" uuid NOT NULL,
        "role" character varying(32) NOT NULL,
        "assigned_at" TIMESTAMPTZ NOT NULL,
        "unassigned_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "PK_job_assignments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_job_assignments_job"
          FOREIGN KEY ("job_id") REFERENCES "service_jobs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_job_assignments_staff"
          FOREIGN KEY ("staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_job_assignments_job_id" ON "job_assignments" ("job_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "service_center_id" uuid NOT NULL,
        "entity_type" character varying(64) NOT NULL,
        "entity_id" uuid NOT NULL,
        "action" character varying(64) NOT NULL,
        "actor_staff_profile_id" uuid,
        "metadata" jsonb,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_audit_logs_staff"
          FOREIGN KEY ("actor_staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_audit_logs_service_center_id" ON "audit_logs" ("service_center_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_audit_logs_entity_id" ON "audit_logs" ("entity_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "job_assignments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_job_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_jobs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vehicles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "staff_profiles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_centers"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "job_event_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "job_priority_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "job_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "vehicle_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "service_center_status_enum"`);
  }
}
