import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateMaintenanceItemDto {
  @ApiProperty()
  @IsUUID()
  vehicleId: string;

  @ApiProperty({ example: 'Engine oil change' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ example: '2026-12-01' })
  @IsOptional()
  @IsDateString({ strict: true })
  dueDate?: string;

  @ApiPropertyOptional({ example: 15000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000)
  dueOdometerKm?: number;

  @ApiPropertyOptional({ example: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  intervalMonths?: number;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(200_000)
  intervalKm?: number;
}

export class UpdateMaintenanceItemDto extends PartialType(
  OmitType(CreateMaintenanceItemDto, ['vehicleId'] as const),
) {}

export class CompleteMaintenanceItemDto {
  @ApiPropertyOptional({ description: 'Defaults to today (IST)' })
  @IsOptional()
  @IsDateString({ strict: true })
  completedOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000)
  odometerKm?: number;
}

export class SnoozeMaintenanceItemDto {
  @ApiProperty({ example: '2026-11-01' })
  @IsDateString({ strict: true })
  until: string;
}

export class ListMaintenanceQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeCompleted?: boolean;
}
