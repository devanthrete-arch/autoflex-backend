import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  VehicleCatalogColour,
  VehicleCatalogConfiguration,
  VehicleCatalogGeneration,
  VehicleCatalogMake,
  VehicleCatalogModel,
  VehicleCatalogPhase,
  VehicleCatalogPowertrain,
} from './vehicle-catalog.entity';
import { VehicleCatalogSeed } from './vehicle-catalog.seed';

export type CatalogImportCounts = {
  makes: number;
  models: number;
  configurations: number;
};

export function vehicleCatalogSeedPath(): string {
  return join(__dirname, '../../catalog/india-cars-on-sale.json');
}

export function readVehicleCatalogSeed(
  path = vehicleCatalogSeedPath(),
): VehicleCatalogSeed {
  return JSON.parse(readFileSync(path, 'utf8')) as VehicleCatalogSeed;
}

export function vehicleCatalogColoursPath(): string {
  return join(__dirname, '../../catalog/india-car-colours.json');
}

export function readVehicleCatalogColours(
  path = vehicleCatalogColoursPath(),
): Map<string, string[]> {
  if (!existsSync(path)) return new Map();
  const file = JSON.parse(readFileSync(path, 'utf8')) as {
    configurations?: Record<string, string[]>;
  };
  return new Map(Object.entries(file.configurations ?? {}));
}

/**
 * The only writer of catalogue rows. Upserts by source key and never deletes,
 * so a car that already points at a configuration keeps that row.
 */
export class VehicleCatalogImporter {
  constructor(private readonly dataSource: DataSource) {}

  async importFromSeed(
    seed = readVehicleCatalogSeed(),
    colours = readVehicleCatalogColours(),
  ): Promise<CatalogImportCounts> {
    return this.dataSource.transaction((manager) =>
      this.importInTransaction(manager, seed, colours),
    );
  }

  private async importInTransaction(
    manager: EntityManager,
    seed: VehicleCatalogSeed,
    colours: Map<string, string[]>,
  ): Promise<CatalogImportCounts> {
    const makes = await loadBySourceKey(
      manager.getRepository(VehicleCatalogMake),
    );
    const models = await loadBySourceKey(
      manager.getRepository(VehicleCatalogModel),
    );
    const generations = await loadBySourceKey(
      manager.getRepository(VehicleCatalogGeneration),
    );
    const phases = await loadBySourceKey(
      manager.getRepository(VehicleCatalogPhase),
    );
    const configurations = await loadBySourceKey(
      manager.getRepository(VehicleCatalogConfiguration),
    );
    const powertrains = new Map(
      (await manager.getRepository(VehicleCatalogPowertrain).find()).map(
        (row) => [row.configurationId, row],
      ),
    );
    const colourRows = await manager.getRepository(VehicleCatalogColour).find();
    const coloursByConfiguration = new Map<string, VehicleCatalogColour[]>();
    for (const row of colourRows) {
      const list = coloursByConfiguration.get(row.configurationId) ?? [];
      list.push(row);
      coloursByConfiguration.set(row.configurationId, list);
    }

    let makeCount = 0;
    let modelCount = 0;
    let configurationCount = 0;

    for (const makeSeed of seed.makes) {
      makeCount += 1;
      const make = await saveBySourceKey(
        manager.getRepository(VehicleCatalogMake),
        makes,
        makeSeed.sourceKey,
        { name: makeSeed.name },
      );
      for (const modelSeed of makeSeed.models) {
        modelCount += 1;
        const model = await saveBySourceKey(
          manager.getRepository(VehicleCatalogModel),
          models,
          modelSeed.sourceKey,
          {
            makeId: make.id,
            name: modelSeed.name,
            bodyStyle: modelSeed.bodyStyle,
          },
        );
        const generationKey = `${modelSeed.sourceKey}:in:${seed.meta.asOf}`;
        const generation = await saveBySourceKey(
          manager.getRepository(VehicleCatalogGeneration),
          generations,
          generationKey,
          {
            modelId: model.id,
            name: `On sale ${seed.meta.asOf}`,
            market: seed.meta.market,
          },
        );
        const phase = await saveBySourceKey(
          manager.getRepository(VehicleCatalogPhase),
          phases,
          `${generationKey}:current`,
          { generationId: generation.id, name: 'Current' },
        );
        for (const configurationSeed of modelSeed.configurations) {
          configurationCount += 1;
          const configuration = await saveBySourceKey(
            manager.getRepository(VehicleCatalogConfiguration),
            configurations,
            configurationSeed.sourceKey,
            {
              phaseId: phase.id,
              variant: configurationSeed.variant,
              fuel: configurationSeed.fuel,
              gearboxCode: configurationSeed.gearboxCode,
            },
          );
          await savePowertrain(
            manager.getRepository(VehicleCatalogPowertrain),
            powertrains,
            configuration.id,
            configurationSeed.engineName,
            configurationSeed.displacementCc,
          );
          const publishedColours = colours.get(configurationSeed.sourceKey);
          if (publishedColours) {
            await saveColours(
              manager.getRepository(VehicleCatalogColour),
              coloursByConfiguration,
              configuration.id,
              publishedColours,
            );
          }
        }
      }
    }

    return {
      makes: makeCount,
      models: modelCount,
      configurations: configurationCount,
    };
  }
}

async function loadBySourceKey<T extends { sourceKey: string }>(
  repository: Repository<T>,
): Promise<Map<string, T>> {
  const rows = await repository.find();
  return new Map(rows.map((row) => [row.sourceKey, row]));
}

async function saveBySourceKey<T extends { id: string; sourceKey: string }>(
  repository: Repository<T>,
  existing: Map<string, T>,
  sourceKey: string,
  values: Partial<T>,
): Promise<T> {
  const current = existing.get(sourceKey);
  const saved = await repository.save(
    current
      ? Object.assign(current, values)
      : repository.create({ ...values, sourceKey } as T),
  );
  existing.set(sourceKey, saved);
  return saved;
}

async function savePowertrain(
  repository: Repository<VehicleCatalogPowertrain>,
  existing: Map<string, VehicleCatalogPowertrain>,
  configurationId: string,
  engineName: string | null,
  displacementCc: number | null,
): Promise<void> {
  const current = existing.get(configurationId);
  if (current) {
    current.engineName = engineName;
    current.displacementCc = displacementCc;
    await repository.save(current);
    return;
  }
  const created = await repository.save(
    repository.create({
      configurationId,
      engineName,
      displacementCc,
    }),
  );
  existing.set(configurationId, created);
}

async function saveColours(
  repository: Repository<VehicleCatalogColour>,
  existing: Map<string, VehicleCatalogColour[]>,
  configurationId: string,
  names: string[],
): Promise<void> {
  const wanted = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  const current = existing.get(configurationId) ?? [];
  const wantedSet = new Set(wanted);
  const kept: VehicleCatalogColour[] = [];
  for (const row of current) {
    if (wantedSet.has(row.name)) kept.push(row);
    else await repository.remove(row);
  }
  const have = new Set(kept.map((row) => row.name));
  for (const name of wanted) {
    if (have.has(name)) continue;
    kept.push(
      await repository.save(repository.create({ configurationId, name })),
    );
  }
  existing.set(configurationId, kept);
}
