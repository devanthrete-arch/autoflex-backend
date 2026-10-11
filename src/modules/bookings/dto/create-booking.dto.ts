import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  ValidateNested,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BookingMode } from '../../../common/enums/booking-mode.enum';
import { BookingStatus } from '../../../common/enums/booking-status.enum';
import { JobPriority } from '../../../common/enums/job-priority.enum';
import { PaymentMode } from '../../../common/enums/payment-mode.enum';
import { VehicleType } from '../../../common/enums/vehicle-type.enum';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class MenuSelectionDto {
  @IsIn(['SERVICE', 'PACKAGE']) kind: 'SERVICE' | 'PACKAGE';
  @IsUUID() id: string;
  @IsInt() @Min(1) @Max(2147483647) version: number;
}

export class ValidateBookingSelectionDto {
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => MenuSelectionDto)
  selections: MenuSelectionDto[];

  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;
}

export class CreateBookingDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => MenuSelectionDto)
  selections?: MenuSelectionDto[];

  @IsUUID()
  serviceCenterId: string;

  @IsUUID()
  vehicleId: string;

  @IsEnum(BookingMode)
  mode: BookingMode;

  @IsDateString()
  slotStart: string;

  @IsDateString()
  slotEnd: string;

  /** Services picked from the center menu; the estimate is their total. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  offeringIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  issueDescription?: string;

  @IsOptional()
  @IsEnum(PaymentMode)
  paymentMode?: PaymentMode;

  /** Used only when no offerings are picked. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  estimateInr?: number;
}

export class ListSlotsQueryDto {
  @IsOptional()
  @Matches(DATE)
  date?: string;
}

export class CancelBookingDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class DeclineBookingDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class CreateAttachmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName: string;

  @Matches(
    /^(image\/(jpeg|png|webp|heic)|application\/pdf|audio\/(mpeg|mp4|aac|ogg)|video\/mp4)$/,
  )
  mimeType: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10 * 1024 * 1024)
  sizeBytes: number;
}

export class ListCenterBookingsQueryDto {
  /** IST calendar date; defaults to today when `from` is omitted. */
  @IsOptional()
  @Matches(DATE)
  date?: string;

  /** Inclusive IST start date. When set without `to`, the next 14 days are returned. */
  @IsOptional()
  @Matches(DATE)
  from?: string;

  /** Inclusive IST end date. Requires `from` or `date`. */
  @IsOptional()
  @Matches(DATE)
  to?: string;

  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;
}

export class CheckInBookingDto {
  /** Defaults to the booked service names. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  serviceType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  odometerKm?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  fuelLevel?: string;

  @IsOptional()
  @IsObject()
  accessoriesChecklist?: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  assignedTechnicianId?: string;

  @IsOptional()
  @Type(() => Date)
  estimatedReadyAt?: Date;

  @IsOptional()
  @IsEnum(JobPriority)
  priority?: JobPriority;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  budgetCeiling?: number;
}
