import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { VehicleType } from '../../../common/enums/vehicle-type.enum';

export class CreateOfferingDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** Leave out to offer it for every vehicle type the center supports. */
  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceInr: number;

  @IsOptional()
  @IsBoolean()
  priceIsStarting?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(24 * 60)
  durationMinutes: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class UpdateOfferingDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceInr?: number;

  @IsOptional()
  @IsBoolean()
  priceIsStarting?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(24 * 60)
  durationMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListOfferingsQueryDto {
  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;
}
