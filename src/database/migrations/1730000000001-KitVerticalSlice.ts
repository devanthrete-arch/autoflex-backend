import { MigrationInterface, QueryRunner } from 'typeorm';

export class KitVerticalSlice1730000000001 implements MigrationInterface {
  name = 'KitVerticalSlice1730000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "booking_mode_enum" AS ENUM ('SELF_CHECKIN')
    `);
    await queryRunner.query(`
      CREATE TYPE "booking_status_enum" AS ENUM (
        'PENDING_CENTER', 'CONFIRMED', 'AWAITING_ARRIVAL', 'CANCELLED'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "payment_mode_enum" AS ENUM ('PAY_AT_CENTER')
    `);
    await queryRunner.query(`
      CREATE TYPE "promotion_scope_enum" AS ENUM ('PLATFORM', 'CENTER')
    `);

    await queryRunner.query(`
      ALTER TABLE "service_centers"
        ADD COLUMN "display_name" character varying(255),
        ADD COLUMN "latitude" double precision,
        ADD COLUMN "longitude" double precision,
        ADD COLUMN "formatted_address" character varying(512),
        ADD COLUMN "hero_image_url" character varying(1024),
        ADD COLUMN "logo_url" character varying(1024),
        ADD COLUMN "rating_avg" numeric(3,2),
        ADD COLUMN "rating_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN "auto_accept" boolean NOT NULL DEFAULT true,
        ADD COLUMN "booking_enabled" boolean NOT NULL DEFAULT true,
        ADD COLUMN "hours_start" character varying(8) NOT NULL DEFAULT '09:00',
        ADD COLUMN "hours_end" character varying(8) NOT NULL DEFAULT '17:00'
    `);

    await queryRunner.query(`
      CREATE TABLE "customer_profiles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "iam_user_id" character varying(36) NOT NULL,
        "display_name" character varying(255),
        "phone" character varying(20),
        "avatar_url" character varying(1024),
        "locale" character varying(10),
        "selected_place_label" character varying(255),
        "last_lat" double precision,
        "last_lng" double precision,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "PK_customer_profiles" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_customer_profiles_iam_user_id"
      ON "customer_profiles" ("iam_user_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "garage_vehicles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "customer_profile_id" uuid NOT NULL,
        "vehicle_type" "vehicle_type_enum" NOT NULL DEFAULT 'TWO_WHEELER',
        "make" character varying(128) NOT NULL,
        "model" character varying(128) NOT NULL,
        "year" integer,
        "registration_number" character varying(32) NOT NULL,
        "color" character varying(64),
        "fuel" character varying(32),
        "transmission" character varying(32),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "PK_garage_vehicles" PRIMARY KEY ("id"),
        CONSTRAINT "FK_garage_vehicles_profile"
          FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "service_categories" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "slug" character varying(64) NOT NULL,
        "name" character varying(128) NOT NULL,
        "icon_key" character varying(64) NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "vehicle_type" "vehicle_type_enum",
        CONSTRAINT "PK_service_categories" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_service_categories_slug" UNIQUE ("slug")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "service_center_categories" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "service_center_id" uuid NOT NULL,
        "category_id" uuid NOT NULL,
        CONSTRAINT "PK_service_center_categories" PRIMARY KEY ("id"),
        CONSTRAINT "FK_scc_center"
          FOREIGN KEY ("service_center_id") REFERENCES "service_centers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_scc_category"
          FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "promotions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "scope" "promotion_scope_enum" NOT NULL,
        "kicker" character varying(255),
        "title" character varying(255) NOT NULL,
        "percent_off" integer,
        "cta_label" character varying(64),
        "image_url" character varying(1024),
        "service_center_id" uuid,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_promotions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "bookings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "service_center_id" uuid NOT NULL,
        "customer_profile_id" uuid NOT NULL,
        "vehicle_id" uuid NOT NULL,
        "mode" "booking_mode_enum" NOT NULL,
        "status" "booking_status_enum" NOT NULL,
        "slot_start" TIMESTAMPTZ NOT NULL,
        "slot_end" TIMESTAMPTZ NOT NULL,
        "issue_description" text,
        "payment_mode" "payment_mode_enum" NOT NULL DEFAULT 'PAY_AT_CENTER',
        "estimate_inr" numeric(12,2) NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bookings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_bookings_center"
          FOREIGN KEY ("service_center_id") REFERENCES "service_centers"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_bookings_profile"
          FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_bookings_vehicle"
          FOREIGN KEY ("vehicle_id") REFERENCES "garage_vehicles"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_bookings_center_slot"
      ON "bookings" ("service_center_id", "slot_start")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "bookings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "promotions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_center_categories"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_categories"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "garage_vehicles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_profiles"`);
    await queryRunner.query(`
      ALTER TABLE "service_centers"
        DROP COLUMN IF EXISTS "display_name",
        DROP COLUMN IF EXISTS "latitude",
        DROP COLUMN IF EXISTS "longitude",
        DROP COLUMN IF EXISTS "formatted_address",
        DROP COLUMN IF EXISTS "hero_image_url",
        DROP COLUMN IF EXISTS "logo_url",
        DROP COLUMN IF EXISTS "rating_avg",
        DROP COLUMN IF EXISTS "rating_count",
        DROP COLUMN IF EXISTS "auto_accept",
        DROP COLUMN IF EXISTS "booking_enabled",
        DROP COLUMN IF EXISTS "hours_start",
        DROP COLUMN IF EXISTS "hours_end"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "promotion_scope_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payment_mode_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "booking_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "booking_mode_enum"`);
  }
}
