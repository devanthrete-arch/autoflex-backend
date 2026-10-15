import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
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
  Max,
  ValidateNested,
} from 'class-validator';
import { JobPriority } from '../../../common/enums/job-priority.enum';
import { VehicleType } from '../../../common/enums/vehicle-type.enum';

export class NewIntakeVehicleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  registrationNumber: string;

  @IsEnum(VehicleType)
  vehicleType: VehicleType;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  makeModel?: string;
}

/** Legacy identity fields are transport-only for exact stored receipt replays. */
export class CreateJobDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  customerRevision?: number;

  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  vehicleRevision?: number;

  @IsOptional()
  @IsEnum(VehicleType)
  confirmedVehicleType?: VehicleType;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewIntakeVehicleDto)
  newVehicle?: NewIntakeVehicleDto;

  @ApiProperty({ example: '+919876543210' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  customerPhone?: string;

  @ApiPropertyOptional({ example: 'Rahul Sharma' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  customerName?: string;

  @ApiProperty({ example: 'MH12AB1234' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  vehicleRegistration?: string;

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
  @Max(2147483647)
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
  @Max(9999999999.99)
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
  @IsDate()
  estimatedReadyAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedTechnicianId?: string;

  @ApiPropertyOptional({ example: 'Rattling noise from the front at speed' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  customerRequest?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  waitingOnSite?: boolean;

  @ApiPropertyOptional({ description: 'The earlier job this visit returns to' })
  @IsOptional()
  @IsUUID()
  comebackOfJobId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comebackReason?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  warrantyIntent?: boolean;
}
