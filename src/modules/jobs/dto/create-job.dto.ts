import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { JobPriority } from '../../../common/enums/job-priority.enum';
import { VehicleType } from '../../../common/enums/vehicle-type.enum';

export class CreateJobDto {
  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  customerPhone: string;

  @ApiPropertyOptional({ example: 'Rahul Sharma' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  customerName?: string;

  @ApiProperty({ example: 'MH12AB1234' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  vehicleRegistration: string;

  @ApiPropertyOptional({ example: 'Honda Activa 6G' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  vehicleMakeModel?: string;

  @ApiPropertyOptional({ enum: VehicleType, default: VehicleType.TWO_WHEELER })
  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;

  @ApiProperty({ example: 'Periodic service' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  serviceType: string;

  @ApiPropertyOptional({ example: 12500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  odometerKm?: number;

  @ApiPropertyOptional({ example: 'Half' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  fuelLevel?: string;

  @ApiPropertyOptional({ enum: JobPriority, default: JobPriority.NORMAL })
  @IsOptional()
  @IsEnum(JobPriority)
  priority?: JobPriority;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  budgetCeiling?: number;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  accessoriesChecklist?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'UPI' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  paymentMode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  estimatedReadyAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedTechnicianId?: string;
}
