import { DataSource } from 'typeorm';
import { VehicleType } from '../../common/enums/vehicle-type.enum';
import { ServiceDefinition } from './entities/service-definition.entity';

const both = [VehicleType.TWO_WHEELER, VehicleType.FOUR_WHEELER];
const car = [VehicleType.FOUR_WHEELER];
const bike = [VehicleType.TWO_WHEELER];
// Initial vocabulary, not an exhaustive repair/parts catalogue or a price list.
const seed: [string, string, string, string, string[], VehicleType[]][] = [
  [
    'wheel-alignment',
    'Wheel alignment',
    'Tyres & wheels',
    'Check and adjust wheel alignment. Center scope specifies the axle and adjustments included.',
    ['alignment'],
    car,
  ],
  [
    'wheel-balancing',
    'Wheel balancing',
    'Tyres & wheels',
    'Balance the specified wheel. Center scope states the number of wheels and included weights.',
    ['balancing', 'tire balancing', 'tyre balancing'],
    both,
  ],
  [
    'tyre-fitting',
    'Tyre fitting',
    'Tyres & wheels',
    'Remove and fit a tyre. Replacement tyres are included only when explicitly stated by the center.',
    ['tire change', 'tyre change', 'tyre replacement', 'tire replacement'],
    both,
  ],
  [
    'brake-inspection',
    'Brake inspection',
    'Brakes & safety',
    'Inspect brake condition. Repairs and replacement parts require a separate stated scope.',
    ['brake check'],
    both,
  ],
  [
    'engine-oil-change',
    'Engine oil change',
    'Engine & fluids',
    'Drain and replace engine oil. Center scope identifies whether oil and filters are included.',
    ['oil change'],
    both,
  ],
  [
    'battery-test',
    'Battery test',
    'Electrical',
    'Test battery condition and charging performance. Replacement battery is not implied.',
    ['battery check'],
    both,
  ],
  [
    'chain-adjustment',
    'Chain adjustment',
    'Drive & suspension',
    'Inspect and adjust a chain drive. Replacement chain and sprockets are not implied.',
    ['chain tension', 'chain service'],
    bike,
  ],
  [
    'vehicle-wash',
    'Vehicle wash',
    'Cleaning',
    'Clean the vehicle. Center scope specifies exterior, interior and materials included.',
    ['car wash', 'bike wash'],
    both,
  ],
  [
    'ac-inspection',
    'AC inspection',
    'Comfort',
    'Inspect air-conditioning performance. Refrigerant and repairs are not implied.',
    ['air conditioning', 'ac check'],
    car,
  ],
  [
    'diagnostic-scan',
    'Diagnostic scan',
    'Diagnostics',
    'Read supported electronic fault information. Center confirms model and diagnostic coverage.',
    ['scanner', 'obd scan'],
    both,
  ],
  [
    'puncture-repair',
    'Puncture repair',
    'Tyres & wheels',
    'Inspect and repair a repairable puncture. Center scope specifies tyre type and repair method.',
    ['flat tyre', 'flat tire'],
    both,
  ],
  [
    'suspension-inspection',
    'Suspension inspection',
    'Drive & suspension',
    'Inspect suspension components. Replacement parts and repairs are not implied.',
    ['suspension check'],
    both,
  ],
];

export class ServiceCatalogImporter {
  constructor(private readonly db: DataSource) {}
  async importFromSeed() {
    return this.db.transaction(async (manager) => {
      const repo = manager.getRepository(ServiceDefinition);
      for (const [
        index,
        [slug, name, category, description, aliases, vehicleTypes],
      ] of seed.entries()) {
        const id = `d0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
        // Explicit IDs preserve identity; never infer a mapping for an existing menu.
        await repo.upsert(
          {
            id,
            slug,
            name,
            category,
            description,
            aliases,
            vehicleTypes,
            isActive: true,
          },
          ['id'],
        );
      }
      return {
        services: seed.length,
        unmappedOfferings: await manager.query(
          'SELECT COUNT(*) AS count FROM service_offerings WHERE service_definition_id IS NULL AND deleted_at IS NULL',
        ),
      };
    });
  }
}
