import { MigrationInterface, QueryRunner } from 'typeorm';

export class CustomerDateOfBirth1730000000006 implements MigrationInterface {
  name = 'CustomerDateOfBirth1730000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customer_profiles"
        ADD COLUMN "date_of_birth" date
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customer_profiles" DROP COLUMN "date_of_birth"
    `);
  }
}
