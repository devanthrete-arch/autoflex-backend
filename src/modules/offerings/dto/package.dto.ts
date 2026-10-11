import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import { VehicleType } from '../../../common/enums/vehicle-type.enum';

export class PackageComponentDto {
  @IsUUID() offeringId: string;
  @IsInt() @Min(1) @Max(20) quantity: number;
}
export class SavePackageDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsEnum(VehicleType) vehicleType: VehicleType;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999) priceInr: number;
  @IsBoolean() priceIsStarting: boolean;
  @IsInt() @Min(15) @Max(1440) durationMinutes: number;
  @IsBoolean() isActive: boolean;
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PackageComponentDto)
  components: PackageComponentDto[];
}
