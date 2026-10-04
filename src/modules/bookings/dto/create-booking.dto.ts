import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { BookingMode } from '../../../common/enums/booking-mode.enum';
import { PaymentMode } from '../../../common/enums/payment-mode.enum';

export class CreateBookingDto {
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

  @IsOptional()
  @IsString()
  issueDescription?: string;

  @IsOptional()
  @IsEnum(PaymentMode)
  paymentMode?: PaymentMode;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  estimateInr?: number;
}

export class ListSlotsQueryDto {
  @IsOptional()
  @IsString()
  date?: string;
}
