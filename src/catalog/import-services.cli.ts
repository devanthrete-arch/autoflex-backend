import 'reflect-metadata';
import db from '../database/data-source';
import { ServiceCatalogImporter } from '../modules/offerings/service-catalog.importer';

async function main() {
  await db.initialize();
  try {
    console.log(await new ServiceCatalogImporter(db).importFromSeed());
  } finally {
    await db.destroy();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
