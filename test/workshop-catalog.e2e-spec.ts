import { createMemoryDataSource } from '../src/database/memory-db';
import { bootstrapWorkshop } from '../src/dev/workshop-bootstrap';
import { ServiceCatalogImporter } from '../src/modules/offerings/service-catalog.importer';
import { ServiceOffering } from '../src/modules/offerings/entities/service-offering.entity';

it('links only reviewed workshop activities and preserves manager edits on restart', async () => {
  const { dataSource } = await createMemoryDataSource();
  try {
    const center = await bootstrapWorkshop(dataSource);
    const repo = dataSource.getRepository(ServiceOffering);
    const original = await repo.findBy({ serviceCenterId: center.id });
    expect(original.every((row) => row.serviceDefinitionId === null)).toBe(
      true,
    );

    await new ServiceCatalogImporter(dataSource).importFromSeed();
    await bootstrapWorkshop(dataSource);
    const linked = await repo.findBy({ serviceCenterId: center.id });
    expect(
      linked
        .filter((row) => row.serviceDefinitionId)
        .map((row) => row.name)
        .sort(),
    ).toEqual(['Brake inspection and adjustment', 'Engine oil change']);
    const oil = linked.find((row) => row.name === 'Engine oil change')!;
    expect(oil.version).toBe(2);

    oil.priceInr = '799.00';
    await repo.save(oil);
    await bootstrapWorkshop(dataSource);
    const after = await repo.findOneByOrFail({ id: oil.id });
    expect(Number(after.priceInr)).toBe(799);
    expect(after.version).toBe(2);
  } finally {
    await dataSource.destroy();
  }
}, 30000);
