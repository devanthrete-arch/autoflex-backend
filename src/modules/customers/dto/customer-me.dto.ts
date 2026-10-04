import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpsertProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;

  /** 10-digit Indian mobile, with or without a +91 prefix. Stored as +91XXXXXXXXXX. */
  @IsOptional()
  @IsString()
  @Matches(/^(?:\+91)?[6-9]\d{9}$/)
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
}

export class CreateGarageVehicleDto {
  @IsOptional()
  @IsString()
  vehicleType?: string;

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
  @IsNumber()
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
}
