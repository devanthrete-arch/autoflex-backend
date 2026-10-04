import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import { Promotion } from './entities/promotion.entity';
import {
  ServiceCategory,
  ServiceCenterCategory,
} from './entities/service-category.entity';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ServiceCategory,
      ServiceCenterCategory,
      Promotion,
      ServiceCenter,
    ]),
  ],
  controllers: [MarketplaceController],
  providers: [MarketplaceService],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
