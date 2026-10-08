import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    let profile = await this.profileRepository.findOne({
      where: { iamUserId: auth.userId },
    });
    if (!profile) {
      profile = this.profileRepository.create({
        iamUserId: auth.userId,
        phone: auth.phone ? tryIndiaE164(auth.phone) : null,
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
    if (dto.email !== undefined) profile.email = dto.email.toLowerCase();
    if (dto.city !== undefined) profile.city = dto.city;
    if (dto.state !== undefined) profile.state = dto.state;
    if (dto.postalCode !== undefined) profile.postalCode = dto.postalCode;
    if (dto.preferredChannel !== undefined) {
      profile.preferredChannel = dto.preferredChannel;
    }
    if (dto.whatsappConsent !== undefined) {
      profile.whatsappConsent = dto.whatsappConsent;
    }
    if (dto.emailConsent !== undefined) profile.emailConsent = dto.emailConsent;
    if (dto.serviceUpdates !== undefined) {
      profile.serviceUpdates = dto.serviceUpdates;
    }
    if (dto.maintenanceReminders !== undefined) {
      profile.maintenanceReminders = dto.maintenanceReminders;
    }
    if (dto.documentReminders !== undefined) {
      profile.documentReminders = dto.documentReminders;
    }
    if (dto.dateOfBirth !== undefined) {
      profile.dateOfBirth = assertDateOfBirth(dto.dateOfBirth);
    }
    if (!profile.phone && auth.phone) {
      profile.phone = tryIndiaE164(auth.phone);
    }
    return presentProfile(await this.profileRepository.save(profile));
  }

  /** Returns the caller's profile, creating an empty one on first use. */
  async ensureProfile(auth: AuthContext): Promise<CustomerProfile> {
    if (auth.customerProfileId) {
      const profile = await this.profileRepository.findOne({
        where: { id: auth.customerProfileId },
      });
      if (profile) return profile;
    }
    return this.upsertProfile(auth, {});
  }
}
