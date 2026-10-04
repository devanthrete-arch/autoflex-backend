import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerProfilesService } from './customer-profiles.service';
import { Customer } from './entities/customer.entity';
import { CustomerProfile } from './entities/customer-profile.entity';
import { GarageVehicle } from './entities/garage-vehicle.entity';
import { Vehicle } from './entities/vehicle.entity';
import { GarageController } from './garage.controller';
import { GarageService } from './garage.service';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Customer,
      Vehicle,
      CustomerProfile,
      GarageVehicle,
    ]),
  ],
  controllers: [MeController, GarageController],
  providers: [CustomerProfilesService, MeService, GarageService],
  exports: [TypeOrmModule, CustomerProfilesService, MeService, GarageService],
})
export class CustomersModule {}
