import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { VehicleCatalogController } from './vehicle-catalog.controller';
import {
  VehicleCatalogColour,
  VehicleCatalogConfiguration,
  VehicleCatalogGeneration,
  VehicleCatalogMake,
  VehicleCatalogModel,
  VehicleCatalogPhase,
  VehicleCatalogPowertrain,
} from './vehicle-catalog.entity';
import { VehicleCatalogImporter } from './vehicle-catalog.importer';
import { VehicleCatalogQuery } from './vehicle-catalog.query';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      VehicleCatalogMake,
      VehicleCatalogModel,
      VehicleCatalogGeneration,
      VehicleCatalogPhase,
      VehicleCatalogConfiguration,
      VehicleCatalogPowertrain,
      VehicleCatalogColour,
    ]),
  ],
  controllers: [VehicleCatalogController],
  providers: [
    VehicleCatalogQuery,
    {
      provide: VehicleCatalogImporter,
      useFactory: (dataSource: DataSource) =>
        new VehicleCatalogImporter(dataSource),
      inject: [DataSource],
    },
  ],
  exports: [VehicleCatalogQuery, VehicleCatalogImporter],
})
export class VehicleCatalogModule {}
