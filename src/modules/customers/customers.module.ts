import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';
import { CustomerProfilesService } from './customer-profiles.service';
import { Customer } from './entities/customer.entity';
import { CustomerAddress } from './entities/customer-address.entity';
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
      CustomerAddress,
    ]),
  ],
  controllers: [MeController, GarageController, AddressesController],
  providers: [
    CustomerProfilesService,
    MeService,
    GarageService,
    AddressesService,
  ],
  exports: [
    TypeOrmModule,
    CustomerProfilesService,
    MeService,
    GarageService,
    AddressesService,
  ],
})
export class CustomersModule {}
