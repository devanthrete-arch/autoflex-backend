import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { CustomerProfile } from './entities/customer-profile.entity';
import { UpsertProfileDto } from './dto/customer-me.dto';

/** Normalizes a 10-digit Indian mobile (optional +91) to E.164. */
export function toIndiaE164(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const local =
    digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(local)) {
    throw new BadRequestException(
      'Enter a valid 10-digit Indian mobile number',
    );
  }
  return `+91${local}`;
}

@Injectable()
export class MeService {
  constructor(
    @InjectRepository(CustomerProfile)
    private readonly profileRepository: Repository<CustomerProfile>,
  ) {}

  async getProfile(auth: AuthContext): Promise<CustomerProfile> {
    const profile = await this.profileRepository.findOne({
      where: { iamUserId: auth.userId },
    });
    if (!profile) {
      throw new NotFoundException();
    }
    return profile;
  }

  async upsertProfile(
    auth: AuthContext,
    dto: UpsertProfileDto,
  ): Promise<CustomerProfile> {
    let profile = await this.profileRepository.findOne({
      where: { iamUserId: auth.userId },
    });
    if (!profile) {
      profile = this.profileRepository.create({
        iamUserId: auth.userId,
        phone: auth.phone ?? null,
      });
    }
    if (dto.displayName !== undefined) profile.displayName = dto.displayName;
    if (dto.phone !== undefined) profile.phone = toIndiaE164(dto.phone);
    if (dto.locale !== undefined) profile.locale = dto.locale;
    if (dto.avatarUrl !== undefined) profile.avatarUrl = dto.avatarUrl;
    if (dto.selectedPlaceLabel !== undefined) {
      profile.selectedPlaceLabel = dto.selectedPlaceLabel;
    }
    if (dto.lastLat !== undefined) profile.lastLat = dto.lastLat;
    if (dto.lastLng !== undefined) profile.lastLng = dto.lastLng;
    if (!profile.phone && auth.phone) {
      try {
        profile.phone = toIndiaE164(auth.phone);
      } catch {
        profile.phone = auth.phone;
      }
    }
    return this.profileRepository.save(profile);
  }
}
