import { MigrationInterface, QueryRunner } from 'typeorm';

export class DiscoveryReservation1730000000003 implements MigrationInterface {
  name = 'DiscoveryReservation1730000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "booking_status_enum" ADD VALUE 'CHECKED_IN'`,
    );
    await queryRunner.query(
      `ALTER TYPE "booking_status_enum" ADD VALUE 'NO_SHOW'`,
    );
    await queryRunner.query(`
      CREATE TYPE "booking_party_enum" AS ENUM ('CUSTOMER', 'CENTER')
    `);

    await queryRunner.query(`
      ALTER TABLE "service_centers"
        ADD COLUMN "slot_capacity" integer NOT NULL DEFAULT 1
    `);

    await queryRunner.query(`
      CREATE TABLE "service_offerings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "service_center_id" uuid NOT NULL,
        "category_id" uuid,
        "name" character varying(150) NOT NULL,
        "description" text,
        "vehicle_type" "vehicle_type_enum",
        "price_inr" numeric(12,2) NOT NULL,
        "price_is_starting" boolean NOT NULL DEFAULT false,
        "duration_minutes" integer NOT NULL DEFAULT 60,
        "is_active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "PK_service_offerings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_service_offerings_price" CHECK ("price_inr" >= 0),
        CONSTRAINT "CHK_service_offerings_duration" CHECK ("duration_minutes" > 0),
        CONSTRAINT "FK_service_offerings_center"
          FOREIGN KEY ("service_center_id") REFERENCES "service_centers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_service_offerings_category"
          FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_service_offerings_center"
      ON "service_offerings" ("service_center_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "bookings"
        ADD COLUMN "booking_number" character varying(20),
        ADD COLUMN "service_job_id" uuid,
        ADD COLUMN "confirmed_at" TIMESTAMPTZ,
        ADD COLUMN "checked_in_at" TIMESTAMPTZ,
        ADD COLUMN "cancelled_at" TIMESTAMPTZ,
        ADD COLUMN "cancelled_by" "booking_party_enum",
        ADD COLUMN "cancellation_reason" text,
        ADD COLUMN "address_snapshot" jsonb
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_bookings_booking_number"
      ON "bookings" ("booking_number")
    `);
    await queryRunner.query(`
      ALTER TABLE "bookings"
        ADD CONSTRAINT "FK_bookings_service_job"
        FOREIGN KEY ("service_job_id") REFERENCES "service_jobs"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_service_jobs_source_booking"
      ON "service_jobs" ("source_booking_id")
      WHERE "source_booking_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "booking_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "booking_id" uuid NOT NULL,
        "service_offering_id" uuid,
        "name" character varying(150) NOT NULL,
        "price_inr" numeric(12,2) NOT NULL,
        "price_is_starting" boolean NOT NULL DEFAULT false,
        "duration_minutes" integer NOT NULL,
        "quantity" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_booking_items" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_booking_items_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "FK_booking_items_booking"
          FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_booking_items_offering"
          FOREIGN KEY ("service_offering_id") REFERENCES "service_offerings"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_booking_items_booking" ON "booking_items" ("booking_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "booking_attachments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "booking_id" uuid NOT NULL,
        "storage_key" character varying(512) NOT NULL,
        "file_name" character varying(255) NOT NULL,
        "mime_type" character varying(100) NOT NULL,
        "size_bytes" integer NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "PK_booking_attachments" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_booking_attachments_size" CHECK ("size_bytes" > 0),
        CONSTRAINT "FK_booking_attachments_booking"
          FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_booking_attachments_booking"
      ON "booking_attachments" ("booking_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "booking_attachments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "booking_items"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_service_jobs_source_booking"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "FK_bookings_service_job"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_bookings_booking_number"`,
    );
    await queryRunner.query(`
      ALTER TABLE "bookings"
        DROP COLUMN IF EXISTS "address_snapshot",
        DROP COLUMN IF EXISTS "cancellation_reason",
        DROP COLUMN IF EXISTS "cancelled_by",
        DROP COLUMN IF EXISTS "cancelled_at",
        DROP COLUMN IF EXISTS "checked_in_at",
        DROP COLUMN IF EXISTS "confirmed_at",
        DROP COLUMN IF EXISTS "service_job_id",
        DROP COLUMN IF EXISTS "booking_number"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_offerings"`);
    await queryRunner.query(
      `ALTER TABLE "service_centers" DROP COLUMN IF EXISTS "slot_capacity"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "booking_party_enum"`);
    // Postgres cannot drop enum values; CHECKED_IN and NO_SHOW stay on booking_status_enum.
  }
}
