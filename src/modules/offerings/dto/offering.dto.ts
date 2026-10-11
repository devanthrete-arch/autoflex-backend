import { Transform, Type } from 'class-transformer';
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
  @IsOptional() @IsUUID() serviceDefinitionId?: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
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
  @Max(9999999)
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
  @IsOptional() @IsUUID() serviceDefinitionId?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
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
  @Max(9999999)
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

export class ListServiceDefinitionsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}
