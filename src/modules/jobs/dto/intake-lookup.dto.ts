import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class LookupIntakeCustomerDto {
  @IsString()
  @MaxLength(32)
  phone: string;
}
export class LookupIntakeVehicleDto {
  @IsString()
  @MaxLength(32)
  registrationNumber: string;
}
export class ListIntakeVehiclesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}
export class WalkInAttemptStatusDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_.:-]{8,128}$/)
  idempotencyKey: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  requestHash: string;
}
