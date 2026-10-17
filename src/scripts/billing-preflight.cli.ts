import 'reflect-metadata';
import dataSource from '../database/data-source';
import { inspectBilling } from './billing-preflight';

async function main(): Promise<void> {
  // Diagnostic SQL/driver logging must not expose raw references or identity data.
  dataSource.setOptions({ logging: false });
  await dataSource.initialize();
  try {
    process.stdout.write(
      `${JSON.stringify(await inspectBilling(dataSource), null, 2)}\n`,
    );
  } finally {
    await dataSource.destroy();
  }
}

void main().catch(() => {
  process.stderr.write(
    'Billing preflight failed. Check database configuration and existing billing migrations; no records were changed.\n',
  );
  process.exitCode = 1;
});
