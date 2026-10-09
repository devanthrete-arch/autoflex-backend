import {
  BadRequestException,
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
  CatalogIdentity,
  VehicleCatalogQuery,
} from '../vehicle-catalog/vehicle-catalog.query';
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

function assertCatalogAgreement(
  dto: {
    make?: string;
    model?: string;
    variant?: string;
    fuel?: string;
    transmission?: string;
  },
  identity: CatalogIdentity,
): void {
  const pairs: Array<[string | undefined, string, string]> = [
    [dto.make, identity.make, 'make'],
    [dto.model, identity.model, 'model'],
    [dto.variant, identity.variant, 'variant'],
    [dto.fuel, identity.fuel, 'fuel'],
    [dto.transmission, identity.gearboxCode, 'transmission'],
  ];
  for (const [sent, canonical, field] of pairs) {
    if (sent !== undefined && sent !== canonical) {
      throw new BadRequestException(
        `The ${field} does not match the selected car.`,
      );
    }
  }
}

@Injectable()
export class GarageService {
  constructor(
    @InjectRepository(GarageVehicle)
    private readonly vehicleRepository: Repository<GarageVehicle>,
    private readonly meService: MeService,
    private readonly catalog: VehicleCatalogQuery,
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
    const vehicleType = dto.vehicleType ?? VehicleType.TWO_WHEELER;
    const vehicle = this.vehicleRepository.create({
      customerProfileId: profile.id,
      vehicleType,
      make: dto.make ?? '',
      model: dto.model ?? '',
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
      catalogConfigurationId: null,
    });
    if (vehicleType === VehicleType.FOUR_WHEELER) {
      await this.applyCatalogIdentity(vehicle, dto);
    } else if (dto.catalogConfigurationId) {
      throw new BadRequestException(
        'Two-wheelers are not chosen from the car catalogue.',
      );
    }
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
    if (vehicle.vehicleType === VehicleType.FOUR_WHEELER) {
      if (dto.catalogConfigurationId) {
        await this.applyCatalogIdentity(vehicle, dto);
      } else if (!vehicle.catalogConfigurationId) {
        this.applyTypedIdentity(vehicle, dto);
      }
    } else if (dto.catalogConfigurationId) {
      throw new BadRequestException(
        'Two-wheelers are not chosen from the car catalogue.',
      );
    } else {
      this.applyTypedIdentity(vehicle, dto);
    }
    if (dto.year !== undefined) vehicle.year = dto.year;
    if (dto.color !== undefined) vehicle.color = dto.color;
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

  private applyTypedIdentity(
    vehicle: GarageVehicle,
    dto: UpdateGarageVehicleDto,
  ): void {
    if (dto.make !== undefined) vehicle.make = dto.make;
    if (dto.model !== undefined) vehicle.model = dto.model;
    if (dto.fuel !== undefined) vehicle.fuel = dto.fuel;
    if (dto.transmission !== undefined) vehicle.transmission = dto.transmission;
    if (dto.variant !== undefined) vehicle.variant = dto.variant;
  }

  private async applyCatalogIdentity(
    vehicle: GarageVehicle,
    dto: CreateGarageVehicleDto | UpdateGarageVehicleDto,
  ): Promise<void> {
    if (!dto.catalogConfigurationId) {
      throw new BadRequestException('Choose a car from the catalogue.');
    }
    const identity = await this.catalog.findIdentity(dto.catalogConfigurationId);
    if (!identity) {
      throw new BadRequestException('That car is not in the catalogue.');
    }
    assertCatalogAgreement(dto, identity);
    vehicle.catalogConfigurationId = identity.id;
    vehicle.make = identity.make;
    vehicle.model = identity.model;
    vehicle.variant = identity.variant;
    vehicle.fuel = identity.fuel;
    vehicle.transmission = identity.gearboxCode;
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
