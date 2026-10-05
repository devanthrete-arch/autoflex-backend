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
    TypeOrmModule.forFeature([ServiceOffering, ServiceCategory, ServiceCenter]),
  ],
  controllers: [PublicOfferingsController, CenterOfferingsController],
  providers: [OfferingsService],
  exports: [OfferingsService],
})
export class OfferingsModule {}
