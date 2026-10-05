import { randomUUID } from 'crypto';
import { IMemoryDb, newDb } from 'pg-mem';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entities';
import { MIGRATIONS } from './migration-list';

function registerPgMemFunctions(db: IMemoryDb): void {
  db.public.registerFunction({
    name: 'version',
    implementation: () => 'PostgreSQL 16.0',
  });
  db.public.registerFunction({
    name: 'gen_random_uuid',
    impure: true,
    implementation: () => randomUUID(),
  });
  db.public.registerFunction({
    name: 'current_database',
    implementation: () => 'autoflex_test',
  });
  db.public.registerFunction({
    name: 'quote_ident',
    implementation: (value: string) => `"${value}"`,
  });
  db.public.registerFunction({
    name: 'obj_description',
    implementation: () => null,
  });
}

/**
 * In-memory Postgres (pg-mem) with every migration applied. Used by e2e tests
 * and the local dev runtime; production always uses a real Postgres.
 */
export async function createMemoryDataSource(): Promise<{
  dataSource: DataSource;
  memoryDb: IMemoryDb;
}> {
  const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
  registerPgMemFunctions(memoryDb);
  memoryDb.registerExtension('pgcrypto', (schema) => {
    schema.registerFunction({
      name: 'gen_random_uuid',
      impure: true,
      implementation: () => randomUUID(),
    });
  });

  const dataSource = (await memoryDb.adapters.createTypeormDataSource({
    type: 'postgres',
    entities: ENTITIES,
    synchronize: false,
  })) as DataSource;
  await dataSource.initialize();

  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  for (const Migration of MIGRATIONS) {
    await new Migration().up(queryRunner);
  }
  await queryRunner.release();

  return { dataSource, memoryDb };
}
