import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { JobStatus } from '../../../common/enums/job-status.enum';

export class UpdateJobStatusDto {
  @ApiProperty({ enum: JobStatus })
  @IsEnum(JobStatus)
  status: JobStatus;

  @ApiPropertyOptional({ example: 'Customer approved additional work' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
