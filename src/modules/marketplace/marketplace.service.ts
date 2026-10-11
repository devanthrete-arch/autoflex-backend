import { OfferingsService } from '../offerings/offerings.service';
import { ServiceDefinition } from '../offerings/entities/service-definition.entity';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
    private readonly menus: OfferingsService,
  ) {}

  async listCategories(vehicleType?: string) {
    const qb = this.categoryRepository
      .createQueryBuilder('c')
      .orderBy('c.sort_order', 'ASC');
    if (
      vehicleType === VehicleType.TWO_WHEELER ||
      vehicleType === VehicleType.FOUR_WHEELER
    ) {
      qb.andWhere('(c.vehicle_type IS NULL OR c.vehicle_type = :vt)', {
        vt: vehicleType,
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
    if ((query.lat === undefined) !== (query.lng === undefined))
      throw new BadRequestException('Provide both latitude and longitude');
    if (query.radiusMeters !== undefined && query.lat === undefined)
      throw new BadRequestException('A radius needs a location');
    if (query.sort === 'nearest' && query.lat === undefined)
      throw new BadRequestException('Nearest sorting needs a location');
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const qb = this.centerRepository
      .createQueryBuilder('c')
      .where('c.status = :status', { status: ServiceCenterStatus.ACTIVE });
    if (query.vehicleType)
      qb.andWhere('c.supported_vehicle_types @> :types', {
        types: JSON.stringify([query.vehicleType]),
      });
    if (query.city?.trim())
      qb.andWhere('LOWER(c.city) = :city', {
        city: query.city.trim().toLowerCase(),
      });
    const usable = `o.service_center_id = c.id AND o.is_active = true AND o.deleted_at IS NULL
      AND (o.service_definition_id IS NULL OR d.is_active = true)
      AND (${[VehicleType.TWO_WHEELER, VehicleType.FOUR_WHEELER].map((type) => `(c.supported_vehicle_types @> '["${type}"]' AND (o.vehicle_type IS NULL OR o.vehicle_type = '${type}') AND (o.service_definition_id IS NULL OR d.vehicle_types @> '["${type}"]'))`).join(' OR ')})
      ${query.vehicleType ? 'AND (o.vehicle_type IS NULL OR o.vehicle_type = :vehicleType) AND (o.service_definition_id IS NULL OR d.vehicle_types @> :types)' : ''}`;
    qb.setParameter('vehicleType', query.vehicleType);
    if (query.serviceId)
      qb.andWhere(
        `EXISTS (SELECT 1 FROM service_offerings o LEFT JOIN service_definitions d ON d.id = o.service_definition_id WHERE ${usable} AND o.service_definition_id = :serviceId)`,
        { serviceId: query.serviceId },
      );
    if (query.categoryId)
      qb.andWhere(
        'EXISTS (SELECT 1 FROM service_center_categories cc WHERE cc.service_center_id = c.id AND cc.category_id = :categoryId)',
        { categoryId: query.categoryId },
      );
    if (query.q?.trim()) {
      const term =
        '%' +
        query.q
          .trim()
          .toLowerCase()
          .replace(/[\\%_]/g, '\\$&') +
        '%';
      qb.andWhere(
        `(LOWER(COALESCE(c.display_name, c.name)) LIKE :term OR EXISTS (
        SELECT 1 FROM service_offerings o LEFT JOIN service_definitions d ON d.id = o.service_definition_id
        WHERE ${usable} AND (LOWER(o.name) LIKE :term OR LOWER(o.description) LIKE :term OR LOWER(d.name) LIKE :term OR LOWER(CAST(d.aliases AS text)) LIKE :term)))`,
        { term },
      );
    }
    const distance =
      '6371000 * acos(least(1.0, greatest(-1.0, sin(radians(:lat)) * sin(radians(c.latitude)) + cos(radians(:lat)) * cos(radians(c.latitude)) * cos(radians(c.longitude - :lng)))))';
    if (query.lat !== undefined) {
      qb.andWhere(
        'c.latitude IS NOT NULL AND c.longitude IS NOT NULL',
      ).andWhere(`${distance} <= :radius`, {
        lat: query.lat,
        lng: query.lng,
        radius: query.radiusMeters ?? 15000,
      });
      qb.addSelect(distance, 'distance_meters');
    }
    if (query.sort === 'top_rated')
      qb.orderBy('c.rating_avg', 'DESC', 'NULLS LAST');
    else if (query.lat !== undefined) qb.orderBy('distance_meters', 'ASC');
    else qb.orderBy('c.name', 'ASC');
    qb.addOrderBy('c.id', 'ASC')
      .skip(offset)
      .take(limit + 1);
    const { entities: centers, raw } = await qb.getRawAndEntities();
    const hasMore = centers.length > limit;
    const definitions = query.q?.trim()
      ? await this.centerRepository.manager
          .getRepository(ServiceDefinition)
          .find({
            where: { isActive: true },
          })
      : [];
    const centerIds = centers.slice(0, limit).map((c) => c.id);
    const categoryLinks = centerIds.length
      ? await this.centerCategoryRepository.find({
          where: { serviceCenterId: In(centerIds) },
          relations: { category: true },
        })
      : [];
    const categoriesByCenter = new Map<
      string,
      { id: string; name: string }[]
    >();
    for (const link of categoryLinks) {
      const entries = categoriesByCenter.get(link.serviceCenterId) ?? [];
      entries.push({ id: link.category.id, name: link.category.name });
      categoriesByCenter.set(link.serviceCenterId, entries);
    }
    const items = await Promise.all(
      centers.slice(0, limit).map(async (c, i) => {
        const menu = await this.menus.listPublic(c.id, {
          vehicleType: query.vehicleType,
        });
        const term = query.q?.trim().toLowerCase();
        const matches = menu.filter((o) => {
          if (query.serviceId && o.serviceDefinitionId !== query.serviceId)
            return false;
          if (!term || query.serviceId) return true;
          const d = definitions.find((d) => d.id === o.serviceDefinitionId);
          return [o.name, o.description, d?.name, ...(d?.aliases ?? [])].some(
            (v) => v?.toLowerCase().includes(term),
          );
        });
        return {
          id: c.id,
          displayName: c.displayName ?? c.name,
          latitude: c.latitude,
          longitude: c.longitude,
          distanceMeters:
            query.lat === undefined
              ? null
              : Math.round(Number(raw[i].distance_meters)),
          formattedAddress: c.formattedAddress,
          heroImageUrl: c.heroImageUrl,
          logoUrl: c.logoUrl,
          ratingAvg: c.ratingAvg ? Number(c.ratingAvg) : null,
          ratingCount: c.ratingCount,
          isFavorited: false,
          supportedVehicleTypes: c.supportedVehicleTypes,
          bookingEnabled: c.bookingEnabled,
          matchingServices: matches,
          categories: categoriesByCenter.get(c.id) ?? [],
        };
      }),
    );
    return {
      items,
      nextOffset: hasMore ? offset + limit : null,
      nextCursor: null,
    };
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
