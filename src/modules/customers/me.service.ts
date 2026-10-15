import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import {
  ageYears,
  assertDateOfBirth,
  dateOfBirthString,
} from '../../common/time/date-of-birth';
import { istToday } from '../../common/time/ist';
import {
  bookingEligibility,
  type BookingEligibility,
} from './booking-eligibility';
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

/** Like `toIndiaE164`, but returns the input unchanged when it is not an Indian mobile. */
export function tryIndiaE164(raw: string): string {
  try {
    return toIndiaE164(raw);
  } catch {
    return raw;
  }
}

export interface ProfileView extends CustomerProfile {
  dateOfBirth: string | null;
  ageYears: number | null;
  bookingEligibility: BookingEligibility;
}

function presentProfile(profile: CustomerProfile): ProfileView {
  const dateOfBirth = dateOfBirthString(profile.dateOfBirth);
  const today = istToday();
  profile.dateOfBirth = dateOfBirth;
  return Object.assign(profile, {
    ageYears: ageYears(dateOfBirth, today),
    bookingEligibility: bookingEligibility(dateOfBirth, today),
  });
}

@Injectable()
export class MeService {
  constructor(
    @InjectRepository(CustomerProfile)
    private readonly profileRepository: Repository<CustomerProfile>,
  ) {}

  async getProfile(auth: AuthContext): Promise<ProfileView> {
    const profile = await this.profileRepository.findOne({
      where: { iamUserId: auth.userId },
    });
    if (!profile) {
      throw new NotFoundException();
    }
    return presentProfile(profile);
  }

  async upsertProfile(
    auth: AuthContext,
    dto: UpsertProfileDto,
  ): Promise<ProfileView> {
    const hasLatitude = dto.lastLat !== undefined;
    const hasLongitude = dto.lastLng !== undefined;
    if (hasLatitude !== hasLongitude)
      throw new BadRequestException(
        'Update or clear latitude and longitude together',
      );
    if (hasLatitude && (dto.lastLat === null) !== (dto.lastLng === null))
      throw new BadRequestException('Clear both coordinates together');
    let profile = await this.profileRepository.findOne({
      where: { iamUserId: auth.userId },
      withDeleted: true,
    });
    if (profile?.deletedAt)
      throw new ForbiddenException('This customer account is unavailable');
    const changes: Partial<CustomerProfile> = {};
    for (const field of [
      'displayName',
      'locale',
      'avatarUrl',
      'selectedPlaceLabel',
      'lastLat',
      'lastLng',
      'city',
      'state',
      'postalCode',
      'preferredChannel',
      'whatsappConsent',
      'emailConsent',
      'serviceUpdates',
      'maintenanceReminders',
      'documentReminders',
    ] as const) {
      if (dto[field] !== undefined)
        (changes as Record<string, unknown>)[field] = dto[field];
    }
    if (dto.phone !== undefined) changes.phone = toIndiaE164(dto.phone);
    if (dto.email !== undefined) changes.email = dto.email.toLowerCase();
    if (dto.dateOfBirth !== undefined) {
      changes.dateOfBirth = assertDateOfBirth(dto.dateOfBirth);
    }
    if (!profile) {
      // Concurrent first use must resolve the same IAM subject. An existing
      // (including deleted) profile is never overwritten by the insert.
      await this.profileRepository
        .createQueryBuilder()
        .insert()
        .values({
          iamUserId: auth.userId,
          phone: auth.phone ? tryIndiaE164(auth.phone) : null,
          ...changes,
        })
        .orIgnore()
        .execute();
      profile = await this.profileRepository.findOneOrFail({
        where: { iamUserId: auth.userId },
        withDeleted: true,
      });
      if (profile.deletedAt)
        throw new ForbiddenException('This customer account is unavailable');
    }
    if (!profile.phone && changes.phone === undefined && auth.phone) {
      changes.phone = tryIndiaE164(auth.phone);
    }
    // Always include both supplied coordinates in one UPDATE, even when one did
    // not change. ORM diff-saving could otherwise mix concurrent location pairs.
    if (Object.keys(changes).length) {
      const result = await this.profileRepository.update(
        { id: profile.id, deletedAt: IsNull() },
        changes,
      );
      if (result.affected !== 1)
        throw new ForbiddenException('This customer account is unavailable');
    }
    const current = await this.profileRepository.findOneBy({ id: profile.id });
    if (!current)
      throw new ForbiddenException('This customer account is unavailable');
    return presentProfile(current);
  }

  /** Returns the caller's profile, creating an empty one on first use. */
  async ensureProfile(auth: AuthContext): Promise<CustomerProfile> {
    if (auth.customerProfileId) {
      const profile = await this.profileRepository.findOne({
        where: { id: auth.customerProfileId, iamUserId: auth.userId },
      });
      if (profile) return profile;
    }
    return this.upsertProfile(auth, {});
  }
}
