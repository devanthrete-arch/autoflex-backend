import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsEnum,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  AmountAdjustmentReason,
  InvoiceStatus,
  PaymentMethod,
} from '../../../common/enums/ownership.enum';
import { InvoiceSelectionDto } from './invoice-selection.dto';

export class IssueInvoiceDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => InvoiceSelectionDto)
  selection?: InvoiceSelectionDto;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  previewFingerprint?: string;
  @ApiPropertyOptional({
    description: 'Billed total; defaults to the approved total',
    example: 2299,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  finalAmountInr?: number;

  @ApiPropertyOptional({ enum: AmountAdjustmentReason })
  @IsOptional()
  @IsEnum(AmountAdjustmentReason)
  adjustmentReason?: AmountAdjustmentReason;

  @ApiPropertyOptional({ description: 'Required when the reason is OTHER' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  adjustmentNote?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class PaymentInputDto {
  @ApiProperty({
    enum: [PaymentMethod.CASH, PaymentMethod.UPI, PaymentMethod.CARD],
  })
  @IsIn([PaymentMethod.CASH, PaymentMethod.UPI, PaymentMethod.CARD])
  method: PaymentMethod;

  @ApiProperty({ example: 2299 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10_000_000)
  amountInr: number;

  @ApiPropertyOptional({
    description: 'UPI transaction id or card slip number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reference?: string;
}

export class CloseJobDto extends IssueInvoiceDto {
  @IsOptional()
  @IsUUID()
  invoiceId?: string;
  @ApiPropertyOptional({
    type: PaymentInputDto,
    description: 'Required unless the bill total is zero',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentInputDto)
  payment?: PaymentInputDto;

  @ApiPropertyOptional({ description: 'Shown on the service record' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  finalNotes?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Part lines whose replaced part was handed back',
  })
  @IsOptional()
  @IsUUID('all', { each: true })
  @ArrayMaxSize(50)
  returnedPartLineIds?: string[];

  @ApiPropertyOptional({
    description: 'Required when inspection or QC was skipped',
    example: {
      work_verified: true,
      road_test: true,
      no_tools_left: true,
      customer_briefed: true,
    },
  })
  @IsOptional()
  @IsObject()
  closeChecklist?: Record<string, boolean>;
}

export class ListCenterInvoicesQueryDto {
  @ApiPropertyOptional({ enum: InvoiceStatus })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;
}
