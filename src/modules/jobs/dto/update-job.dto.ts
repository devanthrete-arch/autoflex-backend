import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { JobPriority } from '../../../common/enums/job-priority.enum';

export class UpdateJobDto {
  @ApiPropertyOptional({ example: 'Periodic service + brake pads' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  serviceType?: string;

  @ApiPropertyOptional({ example: 12600 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  odometerKm?: number;

  @ApiPropertyOptional({ example: 'Quarter' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  fuelLevel?: string;

  @ApiPropertyOptional({ enum: JobPriority })
  @IsOptional()
  @IsEnum(JobPriority)
  priority?: JobPriority;

  @ApiPropertyOptional({ example: 6000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  budgetCeiling?: number;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  accessoriesChecklist?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'Cash' })
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
  assignedTechnicianId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  customerRequest?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  waitingOnSite?: boolean;

  @ApiPropertyOptional({
    description: 'Counter note while waiting at pickup, e.g. a dispute',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  pickupNote?: string;
}
