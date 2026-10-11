import { OfferingsService } from '../offerings/offerings.service';
import { ServiceDefinition } from '../offerings/entities/service-definition.entity';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { In, Repository } from 'typeorm';
import { PromotionScope } from '../../common/enums/promotion-scope.enum';
import { ServiceCenterStatus } from '../../common/enums/service-center-status.enum';
import { VehicleType } from '../../common/enums/vehicle-type.enum';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import { TenancyService } from '../tenancy/tenancy.service';
import { ListCentersQueryDto } from './dto/list-centers-query.dto';
import { AvailableServicesQueryDto } from './dto/discovery-area-query.dto';
import {
  DEFAULT_DISCOVERY_RADIUS_METERS,
  discoveryDistanceSql,
  eligibleDiscoveryCenter,
  eligibleDiscoveryOffering,
  validateDiscoveryArea,
} from './discovery-predicates';
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
    private readonly config: ConfigService,
  ) {}

  discoveryConfig() {
    const city =
      this.config.get<string>('DISCOVERY_DEFAULT_CITY')?.trim() || 'Bengaluru';
    const label =
      this.config.get<string>('DISCOVERY_DEFAULT_LABEL')?.trim() || city;
    const configured =
      !!city &&
      city.length >= 2 &&
      city.length <= 100 &&
      !!label &&
      label.length <= 255;
    return {
      defaultLocation: configured
        ? { mode: 'CITY' as const, city, label }
        : null,
      radiusMeters: DEFAULT_DISCOVERY_RADIUS_METERS,
    };
  }

  async availableServices(query: AvailableServicesQueryDto) {
    validateDiscoveryArea(query, true);
    const limit = query.limit ?? 200;
    const offset = query.offset ?? 0;
    const area = eligibleDiscoveryCenter(query);
    const rows = await this.centerRepository.manager
      .getRepository(ServiceDefinition)
      .createQueryBuilder('d')
      .where('d.is_active = true')
      .andWhere(
        `EXISTS (SELECT 1 FROM service_centers c JOIN service_offerings o ON o.service_center_id = c.id
          WHERE ${area.where} AND ${eligibleDiscoveryOffering(query)} AND o.service_definition_id = d.id)`,
        area.parameters,
      )
      .orderBy('d.category', 'ASC')
      .addOrderBy('d.name', 'ASC')
      .addOrderBy('d.id', 'ASC')
      .skip(offset)
      .take(limit + 1)
      .getMany();
    return {
      items: rows.slice(0, limit),
      nextOffset: rows.length > limit ? offset + limit : null,
    };
  }

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
    const serviceIds = [
      ...new Set([
        ...(query.serviceIds ?? []),
        ...(query.serviceId ? [query.serviceId.toLowerCase()] : []),
      ]),
    ];
    if (serviceIds.length > 10)
      throw new BadRequestException('Select up to 10 services');
    validateDiscoveryArea(query);
    if (
      (query.sort === 'nearest' || query.sort === 'farthest') &&
      query.lat === undefined
    )
      throw new BadRequestException(
        'Distance sorting needs a coordinate location',
      );
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const area = eligibleDiscoveryCenter(query);
    const qb = this.centerRepository
      .createQueryBuilder('c')
      .where(area.where, area.parameters);
    const usable = eligibleDiscoveryOffering(query);
    if (serviceIds.length)
      qb.andWhere(
        `EXISTS (SELECT 1 FROM service_offerings o LEFT JOIN service_definitions d ON d.id = o.service_definition_id WHERE ${usable} AND o.service_definition_id IN (:...serviceIds))`,
        { serviceIds },
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
    const distance = discoveryDistanceSql();
    if (query.lat !== undefined) {
      qb.addSelect(distance, 'distance_meters');
    }
    if (query.sort === 'top_rated')
      qb.orderBy('c.rating_avg', 'DESC', 'NULLS LAST');
    else if (query.lat !== undefined)
      qb.orderBy('distance_meters', query.sort === 'farthest' ? 'DESC' : 'ASC');
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
          if (
            serviceIds.length &&
            !serviceIds.includes(o.serviceDefinitionId ?? '')
          )
            return false;
          if (!term || serviceIds.length) return true;
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
          postalCode: c.postalCode,
          heroImageUrl: c.heroImageUrl,
          logoUrl: c.logoUrl,
          photoUrls: c.photoUrls,
          googleMapsUrl: c.googleMapsUrl,
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
      postalCode: center.postalCode,
      heroImageUrl: center.heroImageUrl,
      logoUrl: center.logoUrl,
      photoUrls: center.photoUrls,
      googleMapsUrl: center.googleMapsUrl,
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
