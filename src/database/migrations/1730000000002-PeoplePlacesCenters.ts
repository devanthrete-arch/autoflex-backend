import { MigrationInterface, QueryRunner } from 'typeorm';

export class PeoplePlacesCenters1730000000002 implements MigrationInterface {
  name = 'PeoplePlacesCenters1730000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "communication_channel_enum" AS ENUM ('WHATSAPP', 'SMS', 'EMAIL')
    `);
    await queryRunner.query(`
      CREATE TYPE "garage_vehicle_status_enum" AS ENUM ('ACTIVE', 'ARCHIVED')
    `);
    await queryRunner.query(`
      CREATE TYPE "staff_designation_enum" AS ENUM ('ADVISOR', 'TECHNICIAN', 'MANAGER', 'DRIVER')
    `);

    await queryRunner.query(`
      ALTER TABLE "customer_profiles"
        ADD COLUMN "email" character varying(255),
        ADD COLUMN "city" character varying(100),
        ADD COLUMN "state" character varying(100),
        ADD COLUMN "postal_code" character varying(10),
        ADD COLUMN "preferred_channel" "communication_channel_enum" NOT NULL DEFAULT 'WHATSAPP',
        ADD COLUMN "whatsapp_consent" boolean NOT NULL DEFAULT false,
        ADD COLUMN "email_consent" boolean NOT NULL DEFAULT false,
        ADD COLUMN "service_updates" boolean NOT NULL DEFAULT true,
        ADD COLUMN "maintenance_reminders" boolean NOT NULL DEFAULT true,
        ADD COLUMN "document_reminders" boolean NOT NULL DEFAULT true
    `);

    await queryRunner.query(`
      ALTER TABLE "garage_vehicles"
        ADD COLUMN "variant" character varying(128),
        ADD COLUMN "chassis_number" character varying(64),
        ADD COLUMN "engine_number" character varying(64),
        ADD COLUMN "current_odometer_km" integer,
        ADD COLUMN "purchase_date" date,
        ADD COLUMN "status" "garage_vehicle_status_enum" NOT NULL DEFAULT 'ACTIVE'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_garage_vehicles_profile_registration"
      ON "garage_vehicles" ("customer_profile_id", "registration_number")
      WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "customer_addresses" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "customer_profile_id" uuid NOT NULL,
        "label" character varying(50) NOT NULL,
        "line1" text NOT NULL,
        "line2" text,
        "landmark" character varying(255),
        "city" character varying(100) NOT NULL,
        "state" character varying(100),
        "postal_code" character varying(10) NOT NULL,
        "contact_phone" character varying(20),
        "latitude" double precision,
        "longitude" double precision,
        "is_default" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "PK_customer_addresses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_customer_addresses_profile"
          FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_customer_addresses_profile"
      ON "customer_addresses" ("customer_profile_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_customer_addresses_one_default"
      ON "customer_addresses" ("customer_profile_id")
      WHERE "is_default" = true AND "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "service_centers"
        ADD COLUMN "slug" character varying(100),
        ADD COLUMN "public_phone" character varying(20),
        ADD COLUMN "gstin" character varying(20),
        ADD COLUMN "address_line1" text,
        ADD COLUMN "address_line2" text,
        ADD COLUMN "city" character varying(100),
        ADD COLUMN "state" character varying(100),
        ADD COLUMN "postal_code" character varying(10),
        ADD COLUMN "supported_vehicle_types" jsonb NOT NULL DEFAULT '["TWO_WHEELER"]',
        ADD COLUMN "pickup_drop_enabled" boolean NOT NULL DEFAULT false,
        ADD COLUMN "onboarded_at" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_service_centers_slug"
      ON "service_centers" ("slug")
      WHERE "slug" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "service_center_operating_hours" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "service_center_id" uuid NOT NULL,
        "day_of_week" smallint NOT NULL,
        "open_time" character varying(5),
        "close_time" character varying(5),
        "is_closed" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_service_center_operating_hours" PRIMARY KEY ("id"),
        CONSTRAINT "FK_operating_hours_center"
          FOREIGN KEY ("service_center_id") REFERENCES "service_centers"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_operating_hours_day" CHECK ("day_of_week" >= 0 AND "day_of_week" <= 6)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_operating_hours_center_day"
      ON "service_center_operating_hours" ("service_center_id", "day_of_week")
    `);

    await queryRunner.query(`
      ALTER TABLE "staff_profiles"
        ADD COLUMN "designation" "staff_designation_enum",
        ADD COLUMN "employee_code" character varying(30),
        ADD COLUMN "specializations" jsonb,
        ADD COLUMN "joined_at" date
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_staff_profiles_center_employee_code"
      ON "staff_profiles" ("service_center_id", "employee_code")
      WHERE "employee_code" IS NOT NULL AND "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "customers"
        ADD COLUMN "customer_profile_id" uuid,
        ADD CONSTRAINT "FK_customers_profile"
          FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_customers_profile" ON "customers" ("customer_profile_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "vehicles"
        ADD COLUMN "make" character varying(128),
        ADD COLUMN "model" character varying(128),
        ADD COLUMN "variant" character varying(128),
        ADD COLUMN "nickname" character varying(64),
        ADD COLUMN "chassis_number" character varying(64),
        ADD COLUMN "engine_number" character varying(64),
        ADD COLUMN "garage_vehicle_id" uuid,
        ADD CONSTRAINT "FK_vehicles_garage_vehicle"
          FOREIGN KEY ("garage_vehicle_id") REFERENCES "garage_vehicles"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vehicles"
        DROP CONSTRAINT IF EXISTS "FK_vehicles_garage_vehicle",
        DROP COLUMN IF EXISTS "make",
        DROP COLUMN IF EXISTS "model",
        DROP COLUMN IF EXISTS "variant",
        DROP COLUMN IF EXISTS "nickname",
        DROP COLUMN IF EXISTS "chassis_number",
        DROP COLUMN IF EXISTS "engine_number",
        DROP COLUMN IF EXISTS "garage_vehicle_id"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_customers_profile"`);
    await queryRunner.query(`
      ALTER TABLE "customers"
        DROP CONSTRAINT IF EXISTS "FK_customers_profile",
        DROP COLUMN IF EXISTS "customer_profile_id"
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_staff_profiles_center_employee_code"`,
    );
    await queryRunner.query(`
      ALTER TABLE "staff_profiles"
        DROP COLUMN IF EXISTS "designation",
        DROP COLUMN IF EXISTS "employee_code",
        DROP COLUMN IF EXISTS "specializations",
        DROP COLUMN IF EXISTS "joined_at"
    `);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "service_center_operating_hours"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_service_centers_slug"`);
    await queryRunner.query(`
      ALTER TABLE "service_centers"
        DROP COLUMN IF EXISTS "slug",
        DROP COLUMN IF EXISTS "public_phone",
        DROP COLUMN IF EXISTS "gstin",
        DROP COLUMN IF EXISTS "address_line1",
        DROP COLUMN IF EXISTS "address_line2",
        DROP COLUMN IF EXISTS "city",
        DROP COLUMN IF EXISTS "state",
        DROP COLUMN IF EXISTS "postal_code",
        DROP COLUMN IF EXISTS "supported_vehicle_types",
        DROP COLUMN IF EXISTS "pickup_drop_enabled",
        DROP COLUMN IF EXISTS "onboarded_at"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_addresses"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_garage_vehicles_profile_registration"`,
    );
    await queryRunner.query(`
      ALTER TABLE "garage_vehicles"
        DROP COLUMN IF EXISTS "variant",
        DROP COLUMN IF EXISTS "chassis_number",
        DROP COLUMN IF EXISTS "engine_number",
        DROP COLUMN IF EXISTS "current_odometer_km",
        DROP COLUMN IF EXISTS "purchase_date",
        DROP COLUMN IF EXISTS "status"
    `);
    await queryRunner.query(`
      ALTER TABLE "customer_profiles"
        DROP COLUMN IF EXISTS "email",
        DROP COLUMN IF EXISTS "city",
        DROP COLUMN IF EXISTS "state",
        DROP COLUMN IF EXISTS "postal_code",
        DROP COLUMN IF EXISTS "preferred_channel",
        DROP COLUMN IF EXISTS "whatsapp_consent",
        DROP COLUMN IF EXISTS "email_consent",
        DROP COLUMN IF EXISTS "service_updates",
        DROP COLUMN IF EXISTS "maintenance_reminders",
        DROP COLUMN IF EXISTS "document_reminders"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "staff_designation_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "garage_vehicle_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "communication_channel_enum"`);
  }
}
