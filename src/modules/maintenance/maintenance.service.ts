import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Not, Repository } from 'typeorm';
import { MaintenanceStatus } from '../../common/enums/ownership.enum';
import {
  addDays,
  addMonths,
  daysBetween,
  istToday,
} from '../../common/time/ist';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { GarageVehicle } from '../customers/entities/garage-vehicle.entity';
import { GarageService } from '../customers/garage.service';
import { MeService } from '../customers/me.service';
import {
  CompleteMaintenanceItemDto,
  CreateMaintenanceItemDto,
  ListMaintenanceQueryDto,
  SnoozeMaintenanceItemDto,
  UpdateMaintenanceItemDto,
} from './dto/maintenance.dto';
import { MaintenanceItem } from './maintenance-item.entity';

export const DUE_SOON_DAYS = 14;
export const DUE_SOON_KM = 500;
export const MAX_SNOOZE_DAYS = 90;

export type MaintenanceState =
  | 'OVERDUE'
  | 'DUE_SOON'
  | 'UPCOMING'
  | 'SNOOZED'
  | 'COMPLETED';

export interface MaintenanceItemView {
  id: string;
  vehicle: {
    id: string;
    registrationNumber: string;
    label: string;
    currentOdometerKm: number | null;
  };
  title: string;
  notes: string | null;
  dueDate: string | null;
  dueOdometerKm: number | null;
  intervalMonths: number | null;
  intervalKm: number | null;
  lastCompletedOn: string | null;
  lastCompletedOdometerKm: number | null;
  status: MaintenanceStatus;
  /** Derived from today's date and the vehicle's odometer. */
  state: MaintenanceState;
  daysToDue: number | null;
  kmToDue: number | null;
  snoozedUntil: string | null;
  sourceJobId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const STATE_ORDER: Record<MaintenanceState, number> = {
  OVERDUE: 0,
  DUE_SOON: 1,
  UPCOMING: 2,
  SNOOZED: 3,
  COMPLETED: 4,
};

export function maintenanceState(
  item: MaintenanceItem,
  vehicle: GarageVehicle,
  today = istToday(),
): {
  state: MaintenanceState;
  daysToDue: number | null;
  kmToDue: number | null;
} {
  const daysToDue = item.dueDate ? daysBetween(today, item.dueDate) : null;
  const kmToDue =
    item.dueOdometerKm !== null && vehicle.currentOdometerKm !== null
      ? item.dueOdometerKm - vehicle.currentOdometerKm
      : null;
  if (item.status === MaintenanceStatus.COMPLETED) {
    return { state: 'COMPLETED', daysToDue, kmToDue };
  }
  if (
    item.status === MaintenanceStatus.SNOOZED &&
    item.snoozedUntil &&
    item.snoozedUntil > today
  ) {
    return { state: 'SNOOZED', daysToDue, kmToDue };
  }
  if (
    (daysToDue !== null && daysToDue < 0) ||
    (kmToDue !== null && kmToDue <= 0)
  ) {
    return { state: 'OVERDUE', daysToDue, kmToDue };
  }
  if (
    (daysToDue !== null && daysToDue <= DUE_SOON_DAYS) ||
    (kmToDue !== null && kmToDue <= DUE_SOON_KM)
  ) {
    return { state: 'DUE_SOON', daysToDue, kmToDue };
  }
  return { state: 'UPCOMING', daysToDue, kmToDue };
}

function toView(item: MaintenanceItem): MaintenanceItemView {
  const vehicle = item.garageVehicle;
  const derived = maintenanceState(item, vehicle);
  return {
    id: item.id,
    vehicle: {
      id: vehicle.id,
      registrationNumber: vehicle.registrationNumber,
      label: `${vehicle.make} ${vehicle.model}`,
      currentOdometerKm: vehicle.currentOdometerKm,
    },
    title: item.title,
    notes: item.notes,
    dueDate: item.dueDate,
    dueOdometerKm: item.dueOdometerKm,
    intervalMonths: item.intervalMonths,
    intervalKm: item.intervalKm,
    lastCompletedOn: item.lastCompletedOn,
    lastCompletedOdometerKm: item.lastCompletedOdometerKm,
    status: item.status,
    ...derived,
    snoozedUntil: item.snoozedUntil,
    sourceJobId: item.sourceJobId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

@Injectable()
export class MaintenanceService {
  constructor(
    @InjectRepository(MaintenanceItem)
    private readonly repository: Repository<MaintenanceItem>,
    private readonly meService: MeService,
    private readonly garageService: GarageService,
  ) {}

  /** Most urgent first. */
  async list(
    auth: AuthContext,
    query: ListMaintenanceQueryDto,
  ): Promise<MaintenanceItemView[]> {
    const profile = await this.meService.ensureProfile(auth);
    const where: FindOptionsWhere<MaintenanceItem> = {
      customerProfileId: profile.id,
      ...(query.vehicleId ? { garageVehicleId: query.vehicleId } : {}),
      ...(query.includeCompleted
        ? {}
        : { status: Not(MaintenanceStatus.COMPLETED) }),
    };
    const rows = await this.repository.find({
      where,
      relations: { garageVehicle: true },
    });
    return rows
      .map(toView)
      .sort(
        (a, b) =>
          STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
          (a.daysToDue ?? Infinity) - (b.daysToDue ?? Infinity),
      );
  }

  async get(auth: AuthContext, id: string): Promise<MaintenanceItemView> {
    return toView(await this.getOwned(auth, id));
  }

  async create(
    auth: AuthContext,
    dto: CreateMaintenanceItemDto,
  ): Promise<MaintenanceItemView> {
    const profile = await this.meService.ensureProfile(auth);
    await this.garageService.getOwned(auth, dto.vehicleId);
    this.assertDuePoint(dto.dueDate ?? null, dto.dueOdometerKm ?? null);
    const saved = await this.repository.save(
      this.repository.create({
        customerProfileId: profile.id,
        garageVehicleId: dto.vehicleId,
        title: dto.title.trim(),
        notes: dto.notes?.trim() || null,
        dueDate: dto.dueDate ?? null,
        dueOdometerKm: dto.dueOdometerKm ?? null,
        intervalMonths: dto.intervalMonths ?? null,
        intervalKm: dto.intervalKm ?? null,
      }),
    );
    return this.get(auth, saved.id);
  }

  async update(
    auth: AuthContext,
    id: string,
    dto: UpdateMaintenanceItemDto,
  ): Promise<MaintenanceItemView> {
    const item = await this.getOwned(auth, id);
    const dueDate = dto.dueDate !== undefined ? dto.dueDate : item.dueDate;
    const dueOdometerKm =
      dto.dueOdometerKm !== undefined ? dto.dueOdometerKm : item.dueOdometerKm;
    this.assertDuePoint(dueDate, dueOdometerKm);
    await this.repository.update(
      { id: item.id },
      {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
        dueDate,
        dueOdometerKm,
        ...(dto.intervalMonths !== undefined
          ? { intervalMonths: dto.intervalMonths }
          : {}),
        ...(dto.intervalKm !== undefined ? { intervalKm: dto.intervalKm } : {}),
      },
    );
    return this.get(auth, id);
  }

  /** With an interval the reminder rolls forward; otherwise it is done. */
  async complete(
    auth: AuthContext,
    id: string,
    dto: CompleteMaintenanceItemDto,
  ): Promise<MaintenanceItemView> {
    const item = await this.getOwned(auth, id);
    if (item.status === MaintenanceStatus.COMPLETED) {
      throw new UnprocessableEntityException('This reminder is already done');
    }
    const today = istToday();
    const completedOn = dto.completedOn ?? today;
    if (completedOn > today) {
      throw new UnprocessableEntityException(
        'The completion date cannot be in the future',
      );
    }
    const odometer = dto.odometerKm ?? null;
    const repeats = item.intervalMonths !== null || item.intervalKm !== null;
    const nextDate =
      item.intervalMonths !== null
        ? addMonths(completedOn, item.intervalMonths)
        : null;
    const nextKm =
      item.intervalKm !== null
        ? (odometer ?? item.dueOdometerKm ?? 0) + item.intervalKm
        : null;
    await this.repository.update(
      { id: item.id },
      {
        lastCompletedOn: completedOn,
        lastCompletedOdometerKm: odometer,
        snoozedUntil: null,
        ...(repeats
          ? {
              status: MaintenanceStatus.UPCOMING,
              dueDate: nextDate,
              dueOdometerKm: nextKm,
            }
          : { status: MaintenanceStatus.COMPLETED }),
      },
    );
    return this.get(auth, id);
  }

  async snooze(
    auth: AuthContext,
    id: string,
    dto: SnoozeMaintenanceItemDto,
  ): Promise<MaintenanceItemView> {
    const item = await this.getOwned(auth, id);
    if (item.status === MaintenanceStatus.COMPLETED) {
      throw new UnprocessableEntityException('This reminder is already done');
    }
    const today = istToday();
    if (dto.until <= today || dto.until > addDays(today, MAX_SNOOZE_DAYS)) {
      throw new UnprocessableEntityException(
        `Snooze until a date within the next ${MAX_SNOOZE_DAYS} days`,
      );
    }
    await this.repository.update(
      { id: item.id },
      { status: MaintenanceStatus.SNOOZED, snoozedUntil: dto.until },
    );
    return this.get(auth, id);
  }

  async remove(auth: AuthContext, id: string): Promise<void> {
    const item = await this.getOwned(auth, id);
    await this.repository.softDelete({ id: item.id });
  }

  private async getOwned(
    auth: AuthContext,
    id: string,
  ): Promise<MaintenanceItem> {
    const profile = await this.meService.ensureProfile(auth);
    const item = await this.repository.findOne({
      where: { id, customerProfileId: profile.id },
      relations: { garageVehicle: true },
    });
    if (!item) throw new NotFoundException();
    return item;
  }

  private assertDuePoint(dueDate: string | null, dueOdometerKm: number | null) {
    if (!dueDate && dueOdometerKm === null) {
      throw new UnprocessableEntityException(
        'Give a due date, a due odometer reading, or both',
      );
    }
  }
}
