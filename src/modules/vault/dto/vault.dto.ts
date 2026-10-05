import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  RecordStatus,
  VaultCategory,
} from '../../../common/enums/ownership.enum';

export const VAULT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const;
export const VAULT_MAX_BYTES = 10 * 1024 * 1024;

export class VaultFileDto {
  @ApiProperty({ example: 'rc-front.jpg' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName: string;

  @ApiProperty({ enum: VAULT_MIME_TYPES })
  @IsIn(VAULT_MIME_TYPES)
  mimeType: string;

  @ApiProperty({ maximum: VAULT_MAX_BYTES })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(VAULT_MAX_BYTES)
  sizeBytes: number;

  @ApiPropertyOptional({ description: 'A second image for the back side' })
  @IsOptional()
  @IsBoolean()
  hasBack?: boolean;
}

export class CreateVaultDocumentDto {
  @ApiProperty({ enum: VaultCategory })
  @IsEnum(VaultCategory)
  category: VaultCategory;

  @ApiPropertyOptional({
    description:
      'Required for RC, insurance and PUC; not allowed for a licence',
  })
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @ApiProperty({ example: 'Insurance policy' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  documentNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  issuer?: string;

  @ApiPropertyOptional({ example: '2026-01-15' })
  @IsOptional()
  @IsDateString({ strict: true })
  issueDate?: string;

  @ApiPropertyOptional({ example: '2027-01-14' })
  @IsOptional()
  @IsDateString({ strict: true })
  expiryDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({
    description: 'Declare a file to upload; confirm it after the upload',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => VaultFileDto)
  file?: VaultFileDto;
}

export class UpdateVaultDocumentDto extends PartialType(
  CreateVaultDocumentDto,
) {}

export class ListVaultQueryDto {
  @ApiPropertyOptional({ enum: VaultCategory })
  @IsOptional()
  @IsEnum(VaultCategory)
  category?: VaultCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @ApiPropertyOptional({ enum: RecordStatus, default: RecordStatus.ACTIVE })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;

  @ApiPropertyOptional({
    description: 'Only documents expiring within 30 days or expired',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  attention?: boolean;
}
