import { ServiceDefinition } from './entities/service-definition.entity';
import { ServicePackage } from './entities/service-package.entity';
import { EventsModule } from '../events/events.module';
import {
  CatalogController,
  CenterPackagesController,
  PublicPackagesController,
} from './packages.controller';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceCategory } from '../marketplace/entities/service-category.entity';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import { ServiceOffering } from './entities/service-offering.entity';
import {
  CenterOfferingsController,
  PublicOfferingsController,
} from './offerings.controller';
import { OfferingsService } from './offerings.service';

@Module({
  imports: [
    EventsModule,
    TypeOrmModule.forFeature([
      ServiceOffering,
      ServiceCategory,
      ServiceCenter,
      ServiceDefinition,
      ServicePackage,
    ]),
  ],
  controllers: [
    PublicOfferingsController,
    CenterOfferingsController,
    CatalogController,
    CenterPackagesController,
    PublicPackagesController,
  ],
  providers: [OfferingsService],
  exports: [OfferingsService],
})
export class OfferingsModule {}
