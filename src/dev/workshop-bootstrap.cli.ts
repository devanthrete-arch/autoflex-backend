import 'reflect-metadata';
import dataSource from '../database/data-source';
import { STAFF_PERSONAS, WORKSHOP_CUSTOMERS } from './dev-personas';
import { assertWorkshopSchema, bootstrapWorkshop } from './workshop-bootstrap';

async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    await assertWorkshopSchema(dataSource);
    const center = await bootstrapWorkshop(dataSource);
    const staff = STAFF_PERSONAS.map(
      (persona) => `${persona.displayName} (${persona.key})`,
    ).join(', ');
    const customers = WORKSHOP_CUSTOMERS.map(
      (customer) => `${customer.name} ${customer.phone}`,
    ).join(', ');
    console.log(`Workshop ready: ${center.name} (${center.id})`);
    console.log(`Staff: ${staff}`);
    console.log(`Customers: ${customers}`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED|password authentication|does not exist/i.test(message)) {
    console.error('Start local Postgres with: docker compose up -d');
    console.error('Then apply migrations with: npm run migration:run');
  }
  process.exit(1);
});
