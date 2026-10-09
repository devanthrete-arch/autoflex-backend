import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { transmissionKind } from './transmission-kind';
import {
  VehicleCatalogConfiguration,
  VehicleCatalogMake,
} from './vehicle-catalog.entity';

export type CatalogIdentity = {
  id: string;
  make: string;
  model: string;
  variant: string;
  fuel: string;
  gearboxCode: string;
};

export type CatalogTreeConfiguration = {
  id: string;
  variant: string;
  fuel: string;
  gearboxCode: string;
  transmissionKind: 'manual' | 'automatic';
  engineName: string | null;
  displacementCc: number | null;
  colours: string[];
};

export type CatalogTree = {
  makes: Array<{
    id: string;
    name: string;
    models: Array<{
      id: string;
      name: string;
      bodyStyle: string;
      configurations: CatalogTreeConfiguration[];
    }>;
  }>;
};

/** Read-only view of the catalogue. It does not read the seed file. */
@Injectable()
export class VehicleCatalogQuery {
  constructor(
    @InjectRepository(VehicleCatalogMake)
    private readonly makes: Repository<VehicleCatalogMake>,
    @InjectRepository(VehicleCatalogConfiguration)
    private readonly configurations: Repository<VehicleCatalogConfiguration>,
  ) {}

  async tree(): Promise<CatalogTree> {
    const makes = await this.makes.find({
      relations: {
        models: {
          generations: {
            phases: {
              configurations: { powertrain: true, colours: true },
            },
          },
        },
      },
    });
    return {
      makes: makes
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((make) => ({
          id: make.id,
          name: make.name,
          models: [...(make.models ?? [])]
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((model) => ({
              id: model.id,
              name: model.name,
              bodyStyle: model.bodyStyle,
              configurations: (model.generations ?? [])
                .flatMap((generation) => generation.phases ?? [])
                .flatMap((phase) => phase.configurations ?? [])
                .sort(
                  (left, right) =>
                    left.variant.localeCompare(right.variant) ||
                    left.fuel.localeCompare(right.fuel) ||
                    left.gearboxCode.localeCompare(right.gearboxCode),
                )
                .map((configuration) => ({
                  id: configuration.id,
                  variant: configuration.variant,
                  fuel: configuration.fuel,
                  gearboxCode: configuration.gearboxCode,
                  transmissionKind: transmissionKind(configuration.gearboxCode),
                  engineName: configuration.powertrain?.engineName ?? null,
                  displacementCc: configuration.powertrain?.displacementCc ?? null,
                  colours: [...(configuration.colours ?? [])]
                    .map((colour) => colour.name)
                    .sort((left, right) => left.localeCompare(right)),
                })),
            })),
        })),
    };
  }

  async findIdentity(id: string): Promise<CatalogIdentity | null> {
    const configuration = await this.configurations.findOne({
      where: { id },
      relations: { phase: { generation: { model: { make: true } } } },
    });
    const model = configuration?.phase?.generation?.model;
    const make = model?.make;
    if (!configuration || !model || !make) return null;
    return {
      id: configuration.id,
      make: make.name,
      model: model.name,
      variant: configuration.variant,
      fuel: configuration.fuel,
      gearboxCode: configuration.gearboxCode,
    };
  }
}
