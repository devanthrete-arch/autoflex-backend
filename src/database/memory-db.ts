import { randomUUID } from 'crypto';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entities';
import { MIGRATIONS } from './migration-list';

function registerPgMemFunctions(db: IMemoryDb): void {
  for (const [name, fn] of Object.entries({
    radians: (n: number) => (n * Math.PI) / 180,
    sin: Math.sin,
    cos: Math.cos,
    acos: Math.acos,
  })) {
    db.public.registerFunction({
      name,
      args: [DataType.float],
      returns: DataType.float,
      implementation: fn,
    });
  }
  for (const [name, fn] of Object.entries({
    least: Math.min,
    greatest: Math.max,
  })) {
    db.public.registerFunction({
      name,
      args: [DataType.float, DataType.float],
      returns: DataType.float,
      implementation: fn,
    });
  }

  // pg-mem timestamps have millisecond precision. Production uses PostgreSQL's
  // native formatter to retain all six fractional digits in queue cursors.
  db.public.registerFunction({
    name: 'to_char',
    args: [DataType.timestamptz, DataType.text],
    returns: DataType.text,
    implementation: (value: Date) => value.toISOString(),
  });
  db.public.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (value: string) => [...value].length,
  });
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
  // pg-mem cannot parse these transaction settings and has no concurrent MVCC.
  // Only the real PostgreSQL suite proves snapshot isolation/read-only behavior.
  memoryDb.public.interceptQueries((sql) =>
    /^SET TRANSACTION (ISOLATION LEVEL REPEATABLE READ|READ ONLY)$/i.test(
      sql.trim(),
    )
      ? []
      : null,
  );
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
