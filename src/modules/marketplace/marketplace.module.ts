import { OfferingsModule } from '../offerings/offerings.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import { TenancyModule } from '../tenancy/tenancy.module';
import { Promotion } from './entities/promotion.entity';
import {
  ServiceCategory,
  ServiceCenterCategory,
} from './entities/service-category.entity';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { PostalLocationService } from './postal-location.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ServiceCategory,
      ServiceCenterCategory,
      Promotion,
      ServiceCenter,
    ]),
    TenancyModule,
    OfferingsModule,
  ],
  controllers: [MarketplaceController],
  providers: [MarketplaceService, PostalLocationService],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
