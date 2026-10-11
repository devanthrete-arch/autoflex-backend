import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ServiceCenterStatus } from '../../common/enums/service-center-status.enum';
import { VehicleType } from '../../common/enums/vehicle-type.enum';
import { inr } from '../../common/money';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { EventsService } from '../events/events.service';
import {
  CommandMeta,
  withCommandReceipt,
} from '../idempotency/transactional-receipt';
import { ServiceCategory } from '../marketplace/entities/service-category.entity';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import {
  CreateOfferingDto,
  ListOfferingsQueryDto,
  ListServiceDefinitionsQueryDto,
  UpdateOfferingDto,
} from './dto/offering.dto';
import { SavePackageDto } from './dto/package.dto';
import { ServiceDefinition } from './entities/service-definition.entity';
import { ServiceOffering } from './entities/service-offering.entity';
import {
  ServicePackage,
  ServiceScope,
} from './entities/service-package.entity';

export function toOfferingView(o: ServiceOffering) {
  return {
    id: o.id,
    serviceDefinitionId: o.serviceDefinitionId,
    version: o.version,
    name: o.name,
    description: o.description,
    categoryId: o.categoryId,
    categoryName: o.serviceDefinition?.category ?? o.category?.name ?? null,
    vehicleType: o.vehicleType,
    priceInr: inr(o.priceInr),
    priceIsStarting: o.priceIsStarting,
    durationMinutes: o.durationMinutes,
    isActive: o.isActive,
    sortOrder: o.sortOrder,
  };
}
export type OfferingView = ReturnType<typeof toOfferingView>;
export type MenuSelection = {
  kind: 'SERVICE' | 'PACKAGE';
  id: string;
  version: number;
};
export type MenuSnapshot = {
  serviceOfferingId: string | null;
  servicePackageId: string | null;
  menuVersion: number;
  name: string;
  description: string | null;
  priceInr: string;
  priceIsStarting: boolean;
  durationMinutes: number;
  quantity: number;
  scope: ServiceScope[];
};

@Injectable()
export class OfferingsService {
  constructor(
    private readonly db: DataSource,
    private readonly events: EventsService,
  ) {}

  async definitions(query: ListServiceDefinitionsQueryDto = {}) {
    const limit = query.limit ?? 200;
    const offset = query.offset ?? 0;
    const rows = await this.db.getRepository(ServiceDefinition).find({
      where: { isActive: true },
      order: { category: 'ASC', name: 'ASC', id: 'ASC' },
      skip: offset,
      take: limit + 1,
    });
    return {
      items: rows.slice(0, limit),
      nextOffset: rows.length > limit ? offset + limit : null,
    };
  }

  private authorize(auth: AuthContext) {
    if (
      auth.actorType !== 'staff' ||
      !auth.serviceCenterId ||
      !auth.staffProfileId ||
      !auth.roles.some((r) => r === 'admin' || r === 'manager') ||
      !auth.permissions.includes('center:manage')
    )
      throw new ForbiddenException();
    return auth.serviceCenterId;
  }

  /** All menu writes and reservations acquire this row first. Never locks the workshop outside a transaction. */
  async lockCenter(manager: EntityManager, id: string) {
    const center = await manager
      .getRepository(ServiceCenter)
      .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!center) throw new NotFoundException();
    return center;
  }

  private async center(id: string, manager = this.db.manager) {
    const center = await manager
      .getRepository(ServiceCenter)
      .findOne({ where: { id } });
    if (!center || center.status !== ServiceCenterStatus.ACTIVE)
      throw new NotFoundException();
    return center;
  }
  private rows(
    centerId: string,
    manager = this.db.manager,
    withDeleted = false,
  ) {
    return manager.getRepository(ServiceOffering).find({
      where: { serviceCenterId: centerId },
      withDeleted,
      relations: { category: true, serviceDefinition: true },
      order: { sortOrder: 'ASC', name: 'ASC', id: 'ASC' },
    });
  }
  private available(
    o: ServiceOffering,
    center: ServiceCenter,
    type?: VehicleType,
  ) {
    const types = type ? [type] : center.supportedVehicleTypes;
    return (
      o.isActive &&
      !o.deletedAt &&
      (!o.serviceDefinitionId || o.serviceDefinition?.isActive) &&
      types.some(
        (t) =>
          center.supportedVehicleTypes.includes(t) &&
          (!o.vehicleType || o.vehicleType === t) &&
          (!o.serviceDefinition ||
            o.serviceDefinition.vehicleTypes.includes(t)),
      )
    );
  }
  async listPublic(
    centerId: string,
    query: ListOfferingsQueryDto,
  ): Promise<OfferingView[]> {
    const center = await this.center(centerId);
    return (await this.rows(centerId))
      .filter((o) => this.available(o, center, query.vehicleType))
      .map(toOfferingView);
  }
  async listForCenter(auth: AuthContext): Promise<OfferingView[]> {
    return (await this.rows(this.authorize(auth))).map(toOfferingView);
  }
  private scope(o: ServiceOffering, quantity = 1): ServiceScope {
    return {
      offeringId: o.id,
      serviceDefinitionId: o.serviceDefinitionId,
      name: o.name,
      description: o.description,
      quantity,
    };
  }
  private packageView(
    p: ServicePackage,
    rows: ServiceOffering[],
    center: ServiceCenter,
  ) {
    const components = p.components.map((c) => ({
      ...c,
      offering: rows.find((o) => o.id === c.offeringId),
    }));
    const available =
      p.isActive &&
      center.supportedVehicleTypes.includes(p.vehicleType) &&
      components.length >= 2 &&
      components.every(
        (c) => c.offering && this.available(c.offering, center, p.vehicleType),
      );
    return {
      id: p.id,
      version: p.version,
      name: p.name,
      description: p.description,
      vehicleType: p.vehicleType,
      priceInr: inr(p.priceInr),
      priceIsStarting: p.priceIsStarting,
      durationMinutes: p.durationMinutes,
      isActive: p.isActive,
      available: !!available,
      components: components.map((c) =>
        c.offering
          ? this.scope(c.offering, c.quantity)
          : {
              offeringId: c.offeringId,
              serviceDefinitionId: null,
              name: 'Unavailable service',
              description: null,
              quantity: c.quantity,
            },
      ),
    };
  }
  async packages(centerId: string, type?: VehicleType, auth?: AuthContext) {
    if (auth && this.authorize(auth) !== centerId)
      throw new ForbiddenException();
    const center = await this.center(centerId);
    const rows = await this.rows(centerId, this.db.manager, !!auth);
    const packages = await this.db.getRepository(ServicePackage).find({
      where: { serviceCenterId: centerId },
      order: { name: 'ASC', id: 'ASC' },
    });
    return packages
      .map((p) => this.packageView(p, rows, center))
      .filter(
        (p) => auth || (p.available && (!type || p.vehicleType === type)),
      );
  }

  private async write<T extends object>(
    auth: AuthContext,
    meta: CommandMeta,
    action: (manager: EntityManager, center: ServiceCenter) => Promise<T>,
  ) {
    const centerId = this.authorize(auth);
    return this.db.transaction(async (manager) => {
      const center = await this.lockCenter(manager, centerId);
      return withCommandReceipt(
        manager,
        `menu:${auth.staffProfileId}:${centerId}`,
        meta,
        () => action(manager, center),
      );
    });
  }
  private version(actual: number, expected?: number) {
    if (actual !== expected)
      throw new ConflictException({
        code: 'MENU_VERSION_CONFLICT',
        message: 'This menu item changed. Refresh it before saving.',
        currentVersion: actual,
      });
  }
  private async validateOffering(
    manager: EntityManager,
    center: ServiceCenter,
    o: ServiceOffering,
  ) {
    if (!o.name.trim())
      throw new BadRequestException('A service name is required');
    if (
      o.categoryId &&
      !(await manager
        .getRepository(ServiceCategory)
        .existsBy({ id: o.categoryId }))
    )
      throw new BadRequestException('Unknown service category');
    if (o.serviceDefinitionId) {
      const definition = await manager
        .getRepository(ServiceDefinition)
        .findOneBy({
          id: o.serviceDefinitionId,
          ...(o.isActive ? { isActive: true } : {}),
        });
      if (!definition)
        throw new BadRequestException('Unknown or retired service definition');
      o.serviceDefinition = definition;
    }
    const types = o.vehicleType
      ? [o.vehicleType]
      : center.supportedVehicleTypes;
    if (
      o.isActive &&
      (!types.length ||
        types.some(
          (t) =>
            !center.supportedVehicleTypes.includes(t) ||
            (o.serviceDefinition &&
              !o.serviceDefinition.vehicleTypes.includes(t)),
        ))
    )
      throw new BadRequestException(
        'Select a vehicle type supported by both the center and this service',
      );
  }
  private async audit(
    manager: EntityManager,
    auth: AuthContext,
    entityType: string,
    id: string,
    action: string,
    version: number,
  ) {
    await this.events.writeAuditLog(
      {
        serviceCenterId: auth.serviceCenterId!,
        entityType,
        entityId: id,
        action,
        actorStaffProfileId: auth.staffProfileId,
        after: { version },
      },
      manager,
    );
  }
  async create(auth: AuthContext, dto: CreateOfferingDto, meta: CommandMeta) {
    return this.write(auth, meta, async (manager, center) => {
      const repo = manager.getRepository(ServiceOffering);
      const row = repo.create({
        ...dto,
        serviceDefinitionId: dto.serviceDefinitionId ?? null,
        serviceCenterId: center.id,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        categoryId: dto.categoryId ?? null,
        vehicleType: dto.vehicleType ?? null,
        priceInr: dto.priceInr.toFixed(2),
        priceIsStarting: dto.priceIsStarting ?? false,
        sortOrder: dto.sortOrder ?? 0,
        isActive: true,
        version: 1,
      });
      await this.validateOffering(manager, center, row);
      await repo.save(row);
      await this.audit(
        manager,
        auth,
        'ServiceOffering',
        row.id,
        'SERVICE_CREATED',
        row.version,
      );
      return toOfferingView(row);
    });
  }
  async update(
    auth: AuthContext,
    id: string,
    dto: UpdateOfferingDto,
    meta: CommandMeta,
  ) {
    return this.write(auth, meta, async (manager, center) => {
      const repo = manager.getRepository(ServiceOffering);
      const row = await repo.findOne({
        where: { id, serviceCenterId: center.id },
        relations: { serviceDefinition: true, category: true },
      });
      if (!row) throw new NotFoundException();
      this.version(row.version, meta.version);
      const packageScope = {
        serviceDefinitionId: row.serviceDefinitionId,
        name: row.name,
        description: row.description,
        vehicleType: row.vehicleType,
        isActive: row.isActive,
      };
      // Patches cannot null required fields through IsOptional's null handling.
      if (Object.values(dto).some((v) => v === null))
        throw new BadRequestException(
          'Omit fields that should remain unchanged',
        );
      if (
        dto.serviceDefinitionId &&
        dto.serviceDefinitionId !== row.serviceDefinitionId
      )
        row.serviceDefinition = null;
      Object.assign(
        row,
        Object.fromEntries(
          Object.entries(dto).filter(([, value]) => value !== undefined),
        ),
        {
          priceInr:
            dto.priceInr === undefined ? row.priceInr : dto.priceInr.toFixed(2),
          version: row.version + 1,
        },
      );
      if (dto.categoryId) row.category = null;
      await this.validateOffering(manager, center, row);
      await repo.save(row);
      // Only changes to package contents or availability invalidate a customer's review.
      if (
        Object.entries(packageScope).some(
          ([key, value]) => value !== row[key as keyof typeof packageScope],
        )
      ) {
        const packages = await manager
          .getRepository(ServicePackage)
          .findBy({ serviceCenterId: center.id });
        for (const p of packages.filter((p) =>
          p.components.some((c) => c.offeringId === id),
        )) {
          p.version++;
          await manager.getRepository(ServicePackage).save(p);
        }
      }
      await this.audit(
        manager,
        auth,
        'ServiceOffering',
        id,
        'SERVICE_UPDATED',
        row.version,
      );
      return toOfferingView(row);
    });
  }
  async remove(auth: AuthContext, id: string, meta: CommandMeta) {
    return this.write(auth, meta, async (manager, center) => {
      const repo = manager.getRepository(ServiceOffering);
      const row = await repo.findOneBy({ id, serviceCenterId: center.id });
      if (!row) throw new NotFoundException();
      this.version(row.version, meta.version);
      row.version++;
      row.isActive = false;
      await repo.save(row);
      await repo.softRemove(row);
      for (const p of await manager
        .getRepository(ServicePackage)
        .findBy({ serviceCenterId: center.id })) {
        if (p.components.some((c) => c.offeringId === id)) {
          p.version++;
          await manager.getRepository(ServicePackage).save(p);
        }
      }
      await this.audit(
        manager,
        auth,
        'ServiceOffering',
        id,
        'SERVICE_REMOVED',
        row.version,
      );
      return { id, version: row.version };
    });
  }
  async savePackage(
    auth: AuthContext,
    id: string | undefined,
    dto: SavePackageDto,
    meta: CommandMeta,
  ) {
    return this.write(auth, meta, async (manager, center) => {
      const repo = manager.getRepository(ServicePackage);
      let row = id
        ? await repo.findOneBy({ id, serviceCenterId: center.id })
        : repo.create({ serviceCenterId: center.id, version: 0 });
      if (!row) throw new NotFoundException();
      if (id) this.version(row.version, meta.version);
      const rows = await this.rows(center.id, manager, !dto.isActive);
      const activities = new Set<string>();
      for (const c of dto.components) {
        const o = rows.find((o) => o.id === c.offeringId);
        if (!o || (dto.isActive && !this.available(o, center, dto.vehicleType)))
          throw new BadRequestException(
            'Every package component must be an active compatible service at this center',
          );
        const activity = o.serviceDefinitionId ?? o.id;
        if (activities.has(activity))
          throw new BadRequestException(
            'Choose distinct services; use quantity for repeated work',
          );
        activities.add(activity);
      }
      Object.assign(row, dto, {
        description: dto.description?.trim() || null,
        priceInr: dto.priceInr.toFixed(2),
        version: row.version + 1,
      });
      row = await repo.save(row);
      await this.audit(
        manager,
        auth,
        'ServicePackage',
        row.id,
        id ? 'PACKAGE_UPDATED' : 'PACKAGE_CREATED',
        row.version,
      );
      return this.packageView(row, rows, center);
    });
  }

  async snapshotSelections(
    manager: EntityManager,
    center: ServiceCenter,
    vehicleType: VehicleType,
    selections: MenuSelection[],
    legacyIds: string[] = [],
  ): Promise<MenuSnapshot[]> {
    const rows = await this.rows(center.id, manager);
    const packages = await manager
      .getRepository(ServicePackage)
      .findBy({ serviceCenterId: center.id });
    if (selections.length && legacyIds.length)
      throw new BadRequestException('Send selections or offeringIds, not both');
    const wanted = selections.length
      ? selections
      : [...new Set(legacyIds)].map((id) => ({
          kind: 'SERVICE' as const,
          id,
          version: undefined,
        }));
    const activities = new Set<string>();
    const snapshots: MenuSnapshot[] = [];
    for (const pick of wanted) {
      const o =
        pick.kind === 'SERVICE'
          ? rows.find((o) => o.id === pick.id)
          : packages.find((p) => p.id === pick.id);
      if (
        !o ||
        (o instanceof ServiceOffering
          ? !this.available(o, center, vehicleType)
          : !this.packageView(o, rows, center).available ||
            o.vehicleType !== vehicleType)
      )
        throw legacyIds.length
          ? new BadRequestException(
              'One or more services are not offered for this vehicle at this center',
            )
          : new ConflictException({
              code: 'MENU_UNAVAILABLE',
              message:
                'A selected service or package is no longer available for this vehicle. Review your selection.',
            });
      if (pick.version !== undefined && pick.version !== o.version)
        throw new ConflictException({
          code: 'MENU_CHANGED',
          message:
            'Price or service scope changed. Review the current menu and confirm again.',
        });
      const scope =
        o instanceof ServiceOffering
          ? [this.scope(o)]
          : o.components.map((c) =>
              this.scope(rows.find((r) => r.id === c.offeringId)!, c.quantity),
            );
      for (const part of scope) {
        const activity = part.serviceDefinitionId ?? part.offeringId;
        if (activities.has(activity))
          throw new BadRequestException({
            code: 'SERVICE_OVERLAP',
            message:
              'A service is included more than once. Remove the overlapping service or package.',
          });
        activities.add(activity);
      }
      snapshots.push({
        serviceOfferingId: o instanceof ServiceOffering ? o.id : null,
        servicePackageId: o instanceof ServicePackage ? o.id : null,
        menuVersion: o.version,
        name: o.name,
        description: o.description,
        priceInr: o.priceInr,
        priceIsStarting: o.priceIsStarting,
        durationMinutes: o.durationMinutes,
        quantity: 1,
        scope,
      });
    }
    return snapshots;
  }
}
