import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { StaffDesignation } from '../../../common/enums/staff-designation.enum';

export class CreateStaffDto {
  /** IAM user id of a user already provisioned in the center's IAM domain. */
  @IsString()
  @MinLength(1)
  @MaxLength(36)
  iamUserId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  displayName: string;

  @IsOptional()
  @IsEnum(StaffDesignation)
  designation?: StaffDesignation;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  employeeCode?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  specializations?: string[];

  @IsOptional()
  @IsDateString()
  joinedAt?: string;
}

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  displayName?: string;

  @IsOptional()
  @IsEnum(StaffDesignation)
  designation?: StaffDesignation;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  employeeCode?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  specializations?: string[];

  @IsOptional()
  @IsDateString()
  joinedAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListStaffQueryDto {
  @IsOptional()
  @IsEnum(StaffDesignation)
  designation?: StaffDesignation;

  /** `true` (default) lists active staff only. */
  @IsOptional()
  @IsString()
  activeOnly?: string;
}
