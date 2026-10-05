import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { ServiceCenterStatus } from '../../common/enums/service-center-status.enum';
import { inr } from '../../common/money';
import { VehicleType } from '../../common/enums/vehicle-type.enum';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { ServiceCategory } from '../marketplace/entities/service-category.entity';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import {
  CreateOfferingDto,
  ListOfferingsQueryDto,
  UpdateOfferingDto,
} from './dto/offering.dto';
import { ServiceOffering } from './entities/service-offering.entity';

export interface OfferingView {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  vehicleType: VehicleType | null;
  priceInr: string;
  priceIsStarting: boolean;
  durationMinutes: number;
  isActive: boolean;
  sortOrder: number;
}

export function toOfferingView(offering: ServiceOffering): OfferingView {
  return {
    id: offering.id,
    name: offering.name,
    description: offering.description,
    categoryId: offering.categoryId,
    categoryName: offering.category?.name ?? null,
    vehicleType: offering.vehicleType,
    priceInr: inr(offering.priceInr),
    priceIsStarting: offering.priceIsStarting,
    durationMinutes: offering.durationMinutes,
    isActive: offering.isActive,
    sortOrder: offering.sortOrder,
  };
}

@Injectable()
export class OfferingsService {
  constructor(
    @InjectRepository(ServiceOffering)
    private readonly offeringRepository: Repository<ServiceOffering>,
    @InjectRepository(ServiceCategory)
    private readonly categoryRepository: Repository<ServiceCategory>,
    @InjectRepository(ServiceCenter)
    private readonly centerRepository: Repository<ServiceCenter>,
  ) {}

  async listPublic(
    centerId: string,
    query: ListOfferingsQueryDto,
  ): Promise<OfferingView[]> {
    const center = await this.centerRepository.findOne({
      where: { id: centerId },
    });
    if (!center || center.status !== ServiceCenterStatus.ACTIVE) {
      throw new NotFoundException();
    }
    const rows = await this.offeringRepository.find({
      where: query.vehicleType
        ? [
            {
              serviceCenterId: centerId,
              isActive: true,
              vehicleType: query.vehicleType,
            },
            {
              serviceCenterId: centerId,
              isActive: true,
              vehicleType: IsNull(),
            },
          ]
        : { serviceCenterId: centerId, isActive: true },
      relations: { category: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return rows.map(toOfferingView);
  }

  async listForCenter(auth: AuthContext): Promise<OfferingView[]> {
    const rows = await this.offeringRepository.find({
      where: { serviceCenterId: auth.serviceCenterId! },
      relations: { category: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return rows.map(toOfferingView);
  }

  async create(
    auth: AuthContext,
    dto: CreateOfferingDto,
  ): Promise<OfferingView> {
    if (dto.categoryId) await this.assertCategory(dto.categoryId);
    const offering = this.offeringRepository.create({
      serviceCenterId: auth.serviceCenterId!,
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      categoryId: dto.categoryId ?? null,
      vehicleType: dto.vehicleType ?? null,
      priceInr: dto.priceInr.toFixed(2),
      priceIsStarting: dto.priceIsStarting ?? false,
      durationMinutes: dto.durationMinutes,
      sortOrder: dto.sortOrder ?? 0,
      isActive: true,
    });
    const saved = await this.offeringRepository.save(offering);
    return toOfferingView(await this.getInCenter(auth, saved.id));
  }

  async update(
    auth: AuthContext,
    id: string,
    dto: UpdateOfferingDto,
  ): Promise<OfferingView> {
    const offering = await this.getInCenter(auth, id);
    if (dto.categoryId !== undefined) {
      await this.assertCategory(dto.categoryId);
      offering.categoryId = dto.categoryId;
      offering.category = null;
    }
    if (dto.name !== undefined) offering.name = dto.name.trim();
    if (dto.description !== undefined) {
      offering.description = dto.description.trim() || null;
    }
    if (dto.vehicleType !== undefined) offering.vehicleType = dto.vehicleType;
    if (dto.priceInr !== undefined) {
      offering.priceInr = dto.priceInr.toFixed(2);
    }
    if (dto.priceIsStarting !== undefined) {
      offering.priceIsStarting = dto.priceIsStarting;
    }
    if (dto.durationMinutes !== undefined) {
      offering.durationMinutes = dto.durationMinutes;
    }
    if (dto.sortOrder !== undefined) offering.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) offering.isActive = dto.isActive;
    await this.offeringRepository.save(offering);
    return toOfferingView(await this.getInCenter(auth, id));
  }

  async remove(auth: AuthContext, id: string): Promise<void> {
    const offering = await this.getInCenter(auth, id);
    await this.offeringRepository.softRemove(offering);
  }

  /** Active offerings of one center, in the order requested. Throws on any miss. */
  async requireBookable(
    centerId: string,
    ids: string[],
  ): Promise<ServiceOffering[]> {
    const unique = [...new Set(ids)];
    const rows = await this.offeringRepository.find({
      where: { id: In(unique), serviceCenterId: centerId, isActive: true },
    });
    if (rows.length !== unique.length) {
      throw new BadRequestException(
        'One or more services are not offered by this center',
      );
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    return unique.map((id) => byId.get(id)!);
  }

  private async getInCenter(
    auth: AuthContext,
    id: string,
  ): Promise<ServiceOffering> {
    const offering = await this.offeringRepository.findOne({
      where: { id, serviceCenterId: auth.serviceCenterId! },
      relations: { category: true },
    });
    if (!offering) {
      throw new NotFoundException();
    }
    return offering;
  }

  private async assertCategory(id: string): Promise<void> {
    const exists = await this.categoryRepository.findOne({ where: { id } });
    if (!exists) {
      throw new BadRequestException('Unknown service category');
    }
  }
}
