import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { StaffProfile } from '../tenancy/entities/staff-profile.entity';
import { CenterService, CenterView } from './center.service';
import {
  CreateStaffDto,
  ListStaffQueryDto,
  UpdateStaffDto,
} from './dto/staff.dto';

export interface StaffView {
  id: string;
  iamUserId: string;
  displayName: string;
  designation: string | null;
  employeeCode: string | null;
  specializations: string[];
  joinedAt: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface StaffMeView {
  staff: StaffView;
  center: CenterView;
  roles: string[];
  permissions: string[];
}

export function toStaffView(profile: StaffProfile): StaffView {
  return {
    id: profile.id,
    iamUserId: profile.iamUserId,
    displayName: profile.displayName,
    designation: profile.designation,
    employeeCode: profile.employeeCode,
    specializations: profile.specializations ?? [],
    joinedAt: profile.joinedAt,
    isActive: profile.isActive,
    createdAt: profile.createdAt,
  };
}

@Injectable()
export class StaffService {
  constructor(
    @InjectRepository(StaffProfile)
    private readonly staffRepository: Repository<StaffProfile>,
    private readonly centerService: CenterService,
  ) {}

  async me(auth: AuthContext): Promise<StaffMeView> {
    const profile = await this.getInCenter(auth, auth.staffProfileId!);
    return {
      staff: toStaffView(profile),
      center: await this.centerService.get(auth),
      roles: auth.roles,
      permissions: auth.permissions,
    };
  }

  async list(
    auth: AuthContext,
    query: ListStaffQueryDto,
  ): Promise<StaffView[]> {
    const activeOnly = query.activeOnly !== 'false';
    const rows = await this.staffRepository.find({
      where: {
        serviceCenterId: auth.serviceCenterId!,
        ...(activeOnly ? { isActive: true } : {}),
        ...(query.designation ? { designation: query.designation } : {}),
      },
      order: { displayName: 'ASC' },
    });
    return rows.map(toStaffView);
  }

  async create(auth: AuthContext, dto: CreateStaffDto): Promise<StaffView> {
    const serviceCenterId = auth.serviceCenterId!;
    const existing = await this.staffRepository.findOne({
      where: { serviceCenterId, iamUserId: dto.iamUserId },
    });
    if (existing) {
      throw new ConflictException('This user is already on the roster');
    }
    if (dto.employeeCode) {
      await this.assertEmployeeCodeFree(serviceCenterId, dto.employeeCode);
    }
    const profile = this.staffRepository.create({
      serviceCenterId,
      iamUserId: dto.iamUserId,
      displayName: dto.displayName.trim(),
      designation: dto.designation ?? null,
      employeeCode: dto.employeeCode ?? null,
      specializations: dto.specializations ?? [],
      joinedAt: dto.joinedAt ?? null,
      isActive: true,
    });
    return toStaffView(await this.staffRepository.save(profile));
  }

  async update(
    auth: AuthContext,
    id: string,
    dto: UpdateStaffDto,
  ): Promise<StaffView> {
    const profile = await this.getInCenter(auth, id);
    if (dto.isActive === false && profile.id === auth.staffProfileId) {
      throw new BadRequestException('You cannot deactivate your own profile');
    }
    if (
      dto.employeeCode !== undefined &&
      dto.employeeCode !== profile.employeeCode
    ) {
      await this.assertEmployeeCodeFree(
        profile.serviceCenterId,
        dto.employeeCode,
        profile.id,
      );
      profile.employeeCode = dto.employeeCode;
    }
    if (dto.displayName !== undefined) {
      profile.displayName = dto.displayName.trim();
    }
    if (dto.designation !== undefined) profile.designation = dto.designation;
    if (dto.specializations !== undefined) {
      profile.specializations = dto.specializations;
    }
    if (dto.joinedAt !== undefined) profile.joinedAt = dto.joinedAt;
    if (dto.isActive !== undefined) profile.isActive = dto.isActive;
    return toStaffView(await this.staffRepository.save(profile));
  }

  private async getInCenter(
    auth: AuthContext,
    id: string,
  ): Promise<StaffProfile> {
    const profile = await this.staffRepository.findOne({
      where: { id, serviceCenterId: auth.serviceCenterId! },
    });
    if (!profile) {
      throw new NotFoundException();
    }
    return profile;
  }

  private async assertEmployeeCodeFree(
    serviceCenterId: string,
    employeeCode: string,
    exceptId?: string,
  ): Promise<void> {
    const taken = await this.staffRepository.findOne({
      where: {
        serviceCenterId,
        employeeCode,
        ...(exceptId ? { id: Not(exceptId) } : {}),
      },
    });
    if (taken) {
      throw new ConflictException('This employee code is already in use');
    }
  }
}
