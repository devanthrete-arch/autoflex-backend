import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  DecisionChannel,
  JobLineKind,
  JobMediaKind,
  PartType,
} from '../../../common/enums/job-work.enum';
import { SkippableStep } from '../../../common/enums/ownership.enum';

export class SkipStepDto {
  @ApiProperty({ enum: SkippableStep })
  @IsEnum(SkippableStep)
  step: SkippableStep;

  @ApiProperty({ example: 'Oil change only; nothing to inspect' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class HoldJobDto {
  @ApiProperty({ example: 'Waiting for brake pads from the distributor' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expectedResumeAt?: Date;
}

export class CancelJobDto {
  @ApiProperty({ example: 'Customer took the vehicle back unrepaired' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class InspectionItemDto {
  @ApiProperty({ example: 'brakes' })
  @Matches(/^[a-z0-9_]{1,40}$/, {
    message: 'key must be 1–40 lowercase letters, digits, or underscores',
  })
  key: string;

  @ApiPropertyOptional({ example: 'Brakes' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @ApiProperty()
  @IsBoolean()
  ok: boolean;

  @ApiPropertyOptional({ example: 'Front pads at 2 mm' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RecordInspectionDto {
  @ApiProperty({ type: [InspectionItemDto] })
  @ValidateNested({ each: true })
  @Type(() => InspectionItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  items: InspectionItemDto[];

  @ApiPropertyOptional({
    description: 'Marks the inspection finished; later saves still edit it',
  })
  @IsOptional()
  @IsBoolean()
  complete?: boolean;
}

export class RecordQcDto {
  @ApiProperty()
  @IsBoolean()
  passed: boolean;

  @ApiPropertyOptional({ description: 'Required when the check fails' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class AddJobNoteDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  visibleToCustomer?: boolean;
}

export class AssignJobDto {
  @ApiProperty({ nullable: true, description: 'null unassigns' })
  @IsOptional()
  @IsUUID()
  staffProfileId: string | null;
}

export class CreateLineItemDto {
  @ApiProperty({ enum: JobLineKind })
  @IsEnum(JobLineKind)
  kind: JobLineKind;

  @ApiProperty({ example: 'Front brake pads' })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  description: string;

  @ApiPropertyOptional({ enum: PartType })
  @IsOptional()
  @IsEnum(PartType)
  partType?: PartType;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9999)
  quantity?: number;

  @ApiProperty({ example: 850 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  unitPriceInr: number;
}

export class RequestApprovalDto {
  @ApiPropertyOptional({ example: 'Pads are worn below the safe limit' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiProperty({ type: [CreateLineItemDto] })
  @ValidateNested({ each: true })
  @Type(() => CreateLineItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  items: CreateLineItemDto[];
}

export class LineDecisionDto {
  @ApiProperty()
  @IsUUID()
  lineItemId: string;

  @ApiProperty()
  @IsBoolean()
  approved: boolean;
}

/** Send `approved` for the whole bundle, or `decisions` line by line. */
export class ApprovalVerdictDto {
  @ApiPropertyOptional({ description: 'Approve or decline every line' })
  @IsOptional()
  @IsBoolean()
  approved?: boolean;

  @ApiPropertyOptional({
    type: [LineDecisionDto],
    description: 'One entry for every line in the request',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => LineDecisionDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  decisions?: LineDecisionDto[];

  @ApiPropertyOptional({
    description: 'Required when an approved line uses an OES or local part',
  })
  @IsOptional()
  @IsBoolean()
  acknowledgeNonOemParts?: boolean;
}

export class DecideApprovalDto extends ApprovalVerdictDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** A decision the owner gave the advisor by phone or at the counter. */
export class OverrideApprovalDto extends ApprovalVerdictDto {
  @ApiProperty({ enum: [DecisionChannel.PHONE, DecisionChannel.IN_PERSON] })
  @IsIn([DecisionChannel.PHONE, DecisionChannel.IN_PERSON])
  channel: DecisionChannel.PHONE | DecisionChannel.IN_PERSON;

  @ApiProperty({ example: 'Customer approved on call at 11:40' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @Matches(/^\+?[0-9]{10,15}$/)
  contactPhone?: string;
}

export const JOB_MEDIA_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'video/mp4',
  'video/quicktime',
] as const;

export const JOB_MEDIA_MAX_BYTES = 50 * 1024 * 1024;

export class AddJobMediaDto {
  @ApiProperty({ enum: JobMediaKind })
  @IsEnum(JobMediaKind)
  kind: JobMediaKind;

  @ApiProperty({ enum: JOB_MEDIA_MIME_TYPES })
  @IsIn(JOB_MEDIA_MIME_TYPES)
  mimeType: string;

  @ApiProperty({ maximum: JOB_MEDIA_MAX_BYTES })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(JOB_MEDIA_MAX_BYTES)
  sizeBytes: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  caption?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  visibleToCustomer?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  lineItemId?: string;
}

export class UpdateJobMediaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  caption?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  visibleToCustomer?: boolean;
}
