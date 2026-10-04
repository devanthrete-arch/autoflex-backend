import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VehicleType } from '../../common/enums/vehicle-type.enum';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { CreateGarageVehicleDto } from './dto/customer-me.dto';
import { CustomerProfile } from './entities/customer-profile.entity';
import { GarageVehicle } from './entities/garage-vehicle.entity';
import { MeService } from './me.service';

@Injectable()
export class GarageService {
  constructor(
    @InjectRepository(GarageVehicle)
    private readonly vehicleRepository: Repository<GarageVehicle>,
    @InjectRepository(CustomerProfile)
    private readonly profileRepository: Repository<CustomerProfile>,
    private readonly meService: MeService,
  ) {}

  private async requireProfile(auth: AuthContext): Promise<CustomerProfile> {
    if (auth.customerProfileId) {
      const profile = await this.profileRepository.findOne({
        where: { id: auth.customerProfileId },
      });
      if (profile) return profile;
    }
    return this.meService.upsertProfile(auth, {});
  }

  async list(auth: AuthContext): Promise<GarageVehicle[]> {
    const profile = await this.requireProfile(auth);
    return this.vehicleRepository.find({
      where: { customerProfileId: profile.id },
      order: { createdAt: 'DESC' },
    });
  }

  async create(
    auth: AuthContext,
    dto: CreateGarageVehicleDto,
  ): Promise<GarageVehicle> {
    const profile = await this.requireProfile(auth);
    const vehicleType =
      dto.vehicleType === VehicleType.FOUR_WHEELER
        ? VehicleType.FOUR_WHEELER
        : VehicleType.TWO_WHEELER;
    const vehicle = this.vehicleRepository.create({
      customerProfileId: profile.id,
      vehicleType,
      make: dto.make,
      model: dto.model,
      year: dto.year ?? null,
      registrationNumber: dto.registrationNumber.toUpperCase(),
      color: dto.color ?? null,
      fuel: dto.fuel ?? null,
      transmission: dto.transmission ?? null,
    });
    return this.vehicleRepository.save(vehicle);
  }

  async getOwned(auth: AuthContext, vehicleId: string): Promise<GarageVehicle> {
    const profile = await this.requireProfile(auth);
    const vehicle = await this.vehicleRepository.findOne({
      where: { id: vehicleId, customerProfileId: profile.id },
    });
    if (!vehicle) {
      throw new NotFoundException();
    }
    return vehicle;
  }
}
