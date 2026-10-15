import 'reflect-metadata';
import dataSource from '../database/data-source';
import { inspectVisitAccess } from './visit-access-preflight';

async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    process.stdout.write(
      `${JSON.stringify(await inspectVisitAccess(dataSource), null, 2)}\n`,
    );
  } finally {
    await dataSource.destroy();
  }
}

void main().catch(() => {
  process.stderr.write(
    'Visit-access preflight failed. Check database configuration and migrations; no records were changed.\n',
  );
  process.exitCode = 1;
});
