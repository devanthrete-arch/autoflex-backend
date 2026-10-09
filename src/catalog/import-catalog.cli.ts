import 'reflect-metadata';
import dataSource from '../database/data-source';
import { VehicleCatalogImporter } from '../modules/vehicle-catalog/vehicle-catalog.importer';

async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    const counts = await new VehicleCatalogImporter(dataSource).importFromSeed();
    console.log(
      `Catalogue ready: ${counts.makes} makes, ${counts.models} models, ${counts.configurations} configurations`,
    );
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
  if (/vehicle_catalog_makes/i.test(message)) {
    console.error('Apply migrations before importing the catalogue: npm run migration:run');
  }
  process.exit(1);
});
