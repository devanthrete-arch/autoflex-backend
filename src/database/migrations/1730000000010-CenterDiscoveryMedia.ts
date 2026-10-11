import { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive: existing covers, addresses and booking snapshots are preserved. */
export class CenterDiscoveryMedia1730000000010 implements MigrationInterface {
  name = 'CenterDiscoveryMedia1730000000010';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE service_centers
      ADD COLUMN photo_urls jsonb NOT NULL DEFAULT '[]',
      ADD COLUMN google_maps_url varchar(1024)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE service_centers
      DROP COLUMN google_maps_url, DROP COLUMN photo_urls`);
  }
}
