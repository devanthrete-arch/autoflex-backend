import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CommunicationChannel } from '../../../common/enums/communication-channel.enum';
import { VehicleType } from '../../../common/enums/vehicle-type.enum';

const INDIA_MOBILE = /^(?:\+91)?[6-9]\d{9}$/;
const INDIA_PIN = /^[1-9]\d{5}$/;

export class UpsertProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;

  /** 10-digit Indian mobile, with or without a +91 prefix. Stored as +91XXXXXXXXXX. */
  @IsOptional()
  @IsString()
  @Matches(INDIA_MOBILE)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  avatarUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  selectedPlaceLabel?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lastLat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lastLng?: number;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @Matches(INDIA_PIN)
  postalCode?: string;

  @IsOptional()
  @IsEnum(CommunicationChannel)
  preferredChannel?: CommunicationChannel;

  @IsOptional()
  @IsBoolean()
  whatsappConsent?: boolean;

  @IsOptional()
  @IsBoolean()
  emailConsent?: boolean;

  @IsOptional()
  @IsBoolean()
  serviceUpdates?: boolean;

  @IsOptional()
  @IsBoolean()
  maintenanceReminders?: boolean;

  @IsOptional()
  @IsBoolean()
  documentReminders?: boolean;

  /** Calendar date `YYYY-MM-DD`. Not in the future, and not before 1900-01-01. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateOfBirth?: string;
}

export class CreateGarageVehicleDto {
  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  make: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  model: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2100)
  year?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  registrationNumber: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  fuel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  transmission?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  variant?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  chassisNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  engineNumber?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  currentOdometerKm?: number;

  @IsOptional()
  @IsDateString()
  purchaseDate?: string;
}

export class UpdateGarageVehicleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  make?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  model?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  registrationNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  fuel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  transmission?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  variant?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  chassisNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  engineNumber?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  currentOdometerKm?: number;

  @IsOptional()
  @IsDateString()
  purchaseDate?: string;
}

export class ListGarageVehiclesQueryDto {
  /** `active` (default), `archived`, or `all`. */
  @IsOptional()
  @Matches(/^(active|archived|all)$/)
  status?: 'active' | 'archived' | 'all';
}

export class CreateAddressDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  label: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  line1: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  line2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  landmark?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @Matches(INDIA_PIN)
  postalCode: string;

  @IsOptional()
  @Matches(INDIA_MOBILE)
  contactPhone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  label?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  line1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  line2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  landmark?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @Matches(INDIA_PIN)
  postalCode?: string;

  @IsOptional()
  @Matches(INDIA_MOBILE)
  contactPhone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
