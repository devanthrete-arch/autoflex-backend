import { MigrationInterface, QueryRunner } from 'typeorm';

export class VehicleCatalog1730000000007 implements MigrationInterface {
  name = 'VehicleCatalog1730000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "vehicle_catalog_makes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "source_key" character varying(128) NOT NULL,
        "name" character varying(128) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vehicle_catalog_makes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_vehicle_catalog_makes_source_key" UNIQUE ("source_key")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "vehicle_catalog_models" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "make_id" uuid NOT NULL,
        "source_key" character varying(128) NOT NULL,
        "name" character varying(128) NOT NULL,
        "body_style" character varying(32) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vehicle_catalog_models" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_vehicle_catalog_models_source_key" UNIQUE ("source_key"),
        CONSTRAINT "FK_vehicle_catalog_models_make"
          FOREIGN KEY ("make_id") REFERENCES "vehicle_catalog_makes"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_vehicle_catalog_models_make"
      ON "vehicle_catalog_models" ("make_id")
    `);
    await queryRunner.query(`
      CREATE TABLE "vehicle_catalog_generations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "model_id" uuid NOT NULL,
        "source_key" character varying(160) NOT NULL,
        "name" character varying(128) NOT NULL,
        "market" character varying(8) NOT NULL DEFAULT 'IN',
        "introduced_on" date,
        "discontinued_on" date,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vehicle_catalog_generations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_vehicle_catalog_generations_source_key" UNIQUE ("source_key"),
        CONSTRAINT "FK_vehicle_catalog_generations_model"
          FOREIGN KEY ("model_id") REFERENCES "vehicle_catalog_models"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_vehicle_catalog_generations_model"
      ON "vehicle_catalog_generations" ("model_id")
    `);
    await queryRunner.query(`
      CREATE TABLE "vehicle_catalog_phases" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "generation_id" uuid NOT NULL,
        "source_key" character varying(180) NOT NULL,
        "name" character varying(128) NOT NULL,
        "introduced_on" date,
        "discontinued_on" date,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vehicle_catalog_phases" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_vehicle_catalog_phases_source_key" UNIQUE ("source_key"),
        CONSTRAINT "FK_vehicle_catalog_phases_generation"
          FOREIGN KEY ("generation_id") REFERENCES "vehicle_catalog_generations"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_vehicle_catalog_phases_generation"
      ON "vehicle_catalog_phases" ("generation_id")
    `);
    await queryRunner.query(`
      CREATE TABLE "vehicle_catalog_configurations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "phase_id" uuid NOT NULL,
        "source_key" character varying(180) NOT NULL,
        "variant" character varying(128) NOT NULL,
        "fuel" character varying(32) NOT NULL,
        "gearbox_code" character varying(16) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vehicle_catalog_configurations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_vehicle_catalog_configurations_source_key" UNIQUE ("source_key"),
        CONSTRAINT "FK_vehicle_catalog_configurations_phase"
          FOREIGN KEY ("phase_id") REFERENCES "vehicle_catalog_phases"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_vehicle_catalog_configurations_phase"
      ON "vehicle_catalog_configurations" ("phase_id")
    `);
    await queryRunner.query(`
      CREATE TABLE "vehicle_catalog_powertrains" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "configuration_id" uuid NOT NULL,
        "engine_name" character varying(128),
        "displacement_cc" integer,
        "power_ps" integer,
        "drive_type" character varying(32),
        "seating_capacity" integer,
        "kerb_weight_kg" integer,
        "gross_vehicle_weight_kg" integer,
        "emission_norm" character varying(32),
        "tyre_size" character varying(64),
        "battery_kwh" double precision,
        "motor_power_kw" integer,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vehicle_catalog_powertrains" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_vehicle_catalog_powertrains_configuration" UNIQUE ("configuration_id"),
        CONSTRAINT "FK_vehicle_catalog_powertrains_configuration"
          FOREIGN KEY ("configuration_id") REFERENCES "vehicle_catalog_configurations"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "vehicle_catalog_colours" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "configuration_id" uuid NOT NULL,
        "name" character varying(64) NOT NULL,
        "available_from" date,
        "available_to" date,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vehicle_catalog_colours" PRIMARY KEY ("id"),
        CONSTRAINT "FK_vehicle_catalog_colours_configuration"
          FOREIGN KEY ("configuration_id") REFERENCES "vehicle_catalog_configurations"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_vehicle_catalog_colours_configuration"
      ON "vehicle_catalog_colours" ("configuration_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "garage_vehicles"
        ADD COLUMN "catalog_configuration_id" uuid,
        ADD CONSTRAINT "FK_garage_vehicles_catalog_configuration"
          FOREIGN KEY ("catalog_configuration_id")
          REFERENCES "vehicle_catalog_configurations"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_garage_vehicles_catalog_configuration"
      ON "garage_vehicles" ("catalog_configuration_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "IDX_garage_vehicles_catalog_configuration"
    `);
    await queryRunner.query(`
      ALTER TABLE "garage_vehicles"
        DROP CONSTRAINT "FK_garage_vehicles_catalog_configuration",
        DROP COLUMN "catalog_configuration_id"
    `);
    await queryRunner.query(`DROP TABLE "vehicle_catalog_colours"`);
    await queryRunner.query(`DROP TABLE "vehicle_catalog_powertrains"`);
    await queryRunner.query(`DROP TABLE "vehicle_catalog_configurations"`);
    await queryRunner.query(`DROP TABLE "vehicle_catalog_phases"`);
    await queryRunner.query(`DROP TABLE "vehicle_catalog_generations"`);
    await queryRunner.query(`DROP TABLE "vehicle_catalog_models"`);
    await queryRunner.query(`DROP TABLE "vehicle_catalog_makes"`);
  }
}
