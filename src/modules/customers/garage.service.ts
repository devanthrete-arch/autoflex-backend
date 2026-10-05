import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GarageVehicleStatus } from '../../common/enums/garage-vehicle-status.enum';
import { VehicleType } from '../../common/enums/vehicle-type.enum';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import {
  CreateGarageVehicleDto,
  ListGarageVehiclesQueryDto,
  UpdateGarageVehicleDto,
} from './dto/customer-me.dto';
import { GarageVehicle } from './entities/garage-vehicle.entity';
import { MeService } from './me.service';

export function normalizeRegistration(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

@Injectable()
export class GarageService {
  constructor(
    @InjectRepository(GarageVehicle)
    private readonly vehicleRepository: Repository<GarageVehicle>,
    private readonly meService: MeService,
  ) {}

  async list(
    auth: AuthContext,
    query: ListGarageVehiclesQueryDto = {},
  ): Promise<GarageVehicle[]> {
    const profile = await this.meService.ensureProfile(auth);
    const status = query.status ?? 'active';
    return this.vehicleRepository.find({
      where: {
        customerProfileId: profile.id,
        ...(status === 'all'
          ? {}
          : {
              status:
                status === 'archived'
                  ? GarageVehicleStatus.ARCHIVED
                  : GarageVehicleStatus.ACTIVE,
            }),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async create(
    auth: AuthContext,
    dto: CreateGarageVehicleDto,
  ): Promise<GarageVehicle> {
    const profile = await this.meService.ensureProfile(auth);
    const registrationNumber = normalizeRegistration(dto.registrationNumber);
    await this.assertRegistrationFree(profile.id, registrationNumber);
    const vehicle = this.vehicleRepository.create({
      customerProfileId: profile.id,
      vehicleType: dto.vehicleType ?? VehicleType.TWO_WHEELER,
      make: dto.make,
      model: dto.model,
      year: dto.year ?? null,
      registrationNumber,
      color: dto.color ?? null,
      fuel: dto.fuel ?? null,
      transmission: dto.transmission ?? null,
      variant: dto.variant ?? null,
      chassisNumber: dto.chassisNumber?.toUpperCase() ?? null,
      engineNumber: dto.engineNumber?.toUpperCase() ?? null,
      currentOdometerKm: dto.currentOdometerKm ?? null,
      purchaseDate: dto.purchaseDate ?? null,
      status: GarageVehicleStatus.ACTIVE,
    });
    return this.vehicleRepository.save(vehicle);
  }

  async update(
    auth: AuthContext,
    vehicleId: string,
    dto: UpdateGarageVehicleDto,
  ): Promise<GarageVehicle> {
    const vehicle = await this.getOwned(auth, vehicleId);
    if (dto.registrationNumber !== undefined) {
      const registrationNumber = normalizeRegistration(dto.registrationNumber);
      if (registrationNumber !== vehicle.registrationNumber) {
        await this.assertRegistrationFree(
          vehicle.customerProfileId,
          registrationNumber,
        );
        vehicle.registrationNumber = registrationNumber;
      }
    }
    if (dto.make !== undefined) vehicle.make = dto.make;
    if (dto.model !== undefined) vehicle.model = dto.model;
    if (dto.year !== undefined) vehicle.year = dto.year;
    if (dto.color !== undefined) vehicle.color = dto.color;
    if (dto.fuel !== undefined) vehicle.fuel = dto.fuel;
    if (dto.transmission !== undefined) vehicle.transmission = dto.transmission;
    if (dto.variant !== undefined) vehicle.variant = dto.variant;
    if (dto.chassisNumber !== undefined) {
      vehicle.chassisNumber = dto.chassisNumber.toUpperCase();
    }
    if (dto.engineNumber !== undefined) {
      vehicle.engineNumber = dto.engineNumber.toUpperCase();
    }
    if (dto.currentOdometerKm !== undefined) {
      vehicle.currentOdometerKm = dto.currentOdometerKm;
    }
    if (dto.purchaseDate !== undefined) vehicle.purchaseDate = dto.purchaseDate;
    return this.vehicleRepository.save(vehicle);
  }

  async setStatus(
    auth: AuthContext,
    vehicleId: string,
    status: GarageVehicleStatus,
  ): Promise<GarageVehicle> {
    const vehicle = await this.getOwned(auth, vehicleId);
    vehicle.status = status;
    return this.vehicleRepository.save(vehicle);
  }

  async getOwned(auth: AuthContext, vehicleId: string): Promise<GarageVehicle> {
    const profile = await this.meService.ensureProfile(auth);
    const vehicle = await this.vehicleRepository.findOne({
      where: { id: vehicleId, customerProfileId: profile.id },
    });
    if (!vehicle) {
      throw new NotFoundException();
    }
    return vehicle;
  }

  private async assertRegistrationFree(
    customerProfileId: string,
    registrationNumber: string,
  ): Promise<void> {
    const existing = await this.vehicleRepository.findOne({
      where: { customerProfileId, registrationNumber },
    });
    if (existing) {
      throw new ConflictException(
        'This registration number is already in your garage',
      );
    }
  }
}
