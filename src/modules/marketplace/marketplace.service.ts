import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PromotionScope } from '../../common/enums/promotion-scope.enum';
import { ServiceCenterStatus } from '../../common/enums/service-center-status.enum';
import { VehicleType } from '../../common/enums/vehicle-type.enum';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import { TenancyService } from '../tenancy/tenancy.service';
import { ListCentersQueryDto } from './dto/list-centers-query.dto';
import { Promotion } from './entities/promotion.entity';
import {
  ServiceCategory,
  ServiceCenterCategory,
} from './entities/service-category.entity';

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

@Injectable()
export class MarketplaceService {
  constructor(
    @InjectRepository(ServiceCategory)
    private readonly categoryRepository: Repository<ServiceCategory>,
    @InjectRepository(Promotion)
    private readonly promotionRepository: Repository<Promotion>,
    @InjectRepository(ServiceCenter)
    private readonly centerRepository: Repository<ServiceCenter>,
    @InjectRepository(ServiceCenterCategory)
    private readonly centerCategoryRepository: Repository<ServiceCenterCategory>,
    private readonly tenancyService: TenancyService,
  ) {}

  async listCategories(vehicleType?: string) {
    const qb = this.categoryRepository
      .createQueryBuilder('c')
      .orderBy('c.sort_order', 'ASC');
    if (vehicleType === VehicleType.TWO_WHEELER) {
      qb.andWhere('(c.vehicle_type IS NULL OR c.vehicle_type = :vt)', {
        vt: VehicleType.TWO_WHEELER,
      });
    }
    const items = await qb.getMany();
    return { items };
  }

  async listOffers() {
    const items = await this.promotionRepository.find({
      where: { isActive: true, scope: PromotionScope.PLATFORM },
      order: { createdAt: 'DESC' },
      take: 10,
    });
    return { items };
  }

  async listCenters(query: ListCentersQueryDto) {
    if (query.lat === undefined || query.lng === undefined) {
      throw new BadRequestException('lat and lng are required');
    }
    const radius = query.radiusMeters ?? 15000;
    const centers = await this.centerRepository.find({
      where: { status: ServiceCenterStatus.ACTIVE },
    });

    const links = await this.centerCategoryRepository.find({
      relations: { category: true },
    });
    const categoriesByCenter = new Map<string, ServiceCategory[]>();
    for (const link of links) {
      const list = categoriesByCenter.get(link.serviceCenterId) ?? [];
      list.push(link.category);
      categoriesByCenter.set(link.serviceCenterId, list);
    }

    let items = centers
      .filter((c) => c.latitude != null && c.longitude != null)
      .map((c) => {
        const distanceMeters = haversineMeters(
          query.lat as number,
          query.lng as number,
          c.latitude as number,
          c.longitude as number,
        );
        return {
          id: c.id,
          displayName: c.displayName ?? c.name,
          latitude: c.latitude,
          longitude: c.longitude,
          distanceMeters: Math.round(distanceMeters),
          formattedAddress: c.formattedAddress,
          heroImageUrl: c.heroImageUrl,
          logoUrl: c.logoUrl,
          ratingAvg: c.ratingAvg ? Number(c.ratingAvg) : null,
          ratingCount: c.ratingCount,
          isFavorited: false,
          categories: (categoriesByCenter.get(c.id) ?? []).map((cat) => ({
            id: cat.id,
            name: cat.name,
          })),
        };
      })
      .filter((c) => c.distanceMeters <= radius);

    if (query.categoryId) {
      items = items.filter((c) =>
        c.categories.some((cat) => cat.id === query.categoryId),
      );
    }
    if (query.q) {
      const q = query.q.toLowerCase();
      items = items.filter((c) => c.displayName.toLowerCase().includes(q));
    }

    const sort = query.sort ?? 'nearest';
    if (sort === 'top_rated') {
      items.sort((a, b) => (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0));
    } else {
      items.sort((a, b) => a.distanceMeters - b.distanceMeters);
    }

    return { items, nextCursor: null };
  }

  async getCenter(id: string) {
    const center = await this.centerRepository.findOne({ where: { id } });
    if (!center || center.status !== ServiceCenterStatus.ACTIVE) {
      throw new NotFoundException();
    }
    const links = await this.centerCategoryRepository.find({
      where: { serviceCenterId: id },
      relations: { category: true },
    });
    return {
      id: center.id,
      displayName: center.displayName ?? center.name,
      latitude: center.latitude,
      longitude: center.longitude,
      formattedAddress: center.formattedAddress,
      heroImageUrl: center.heroImageUrl,
      logoUrl: center.logoUrl,
      ratingAvg: center.ratingAvg ? Number(center.ratingAvg) : null,
      ratingCount: center.ratingCount,
      hoursStart: center.hoursStart,
      hoursEnd: center.hoursEnd,
      weeklyHours: await this.tenancyService.getWeeklyHours(center),
      address: {
        line1: center.addressLine1,
        line2: center.addressLine2,
        city: center.city,
        state: center.state,
        postalCode: center.postalCode,
      },
      publicPhone: center.publicPhone,
      supportedVehicleTypes: center.supportedVehicleTypes,
      pickupDropEnabled: center.pickupDropEnabled,
      bookingEnabled: center.bookingEnabled,
      categories: links.map((l) => ({
        id: l.category.id,
        name: l.category.name,
      })),
      about: `${center.displayName ?? center.name} — trusted ${center.supportedVehicleTypes
        .map((type) => (type === VehicleType.TWO_WHEELER ? '2W' : '4W'))
        .join(' & ')} service.`,
    };
  }
}
