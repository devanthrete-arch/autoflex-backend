import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SupportCategory } from '../../../common/enums/ownership.enum';
import { Transform } from 'class-transformer';

export const SUPPORT_CHANNELS = ['CALL', 'WHATSAPP', 'EMAIL'] as const;

export class CreateSupportRequestDto {
  @ApiProperty({ enum: SupportCategory })
  @IsEnum(SupportCategory)
  category: SupportCategory;

  @ApiProperty({ example: 'Bill amount looks higher than approved' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  subject: string;

  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  message: string;

  @ApiPropertyOptional({ description: 'The service this is about' })
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @ApiPropertyOptional({ description: 'The booking this is about' })
  @IsOptional()
  @IsUUID()
  bookingId?: string;

  @ApiPropertyOptional({ enum: SUPPORT_CHANNELS })
  @IsOptional()
  @IsIn(SUPPORT_CHANNELS)
  preferredChannel?: (typeof SUPPORT_CHANNELS)[number];
}
