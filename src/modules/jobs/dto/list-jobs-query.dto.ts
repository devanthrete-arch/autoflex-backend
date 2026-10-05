import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { JobPriority } from '../../../common/enums/job-priority.enum';
import { JobStatus } from '../../../common/enums/job-status.enum';

export class ListJobsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: JobStatus })
  @IsOptional()
  @IsEnum(JobStatus)
  status?: JobStatus;

  @ApiPropertyOptional({ enum: JobPriority })
  @IsOptional()
  @IsEnum(JobPriority)
  priority?: JobPriority;

  @ApiPropertyOptional({
    description: 'Search customer phone or vehicle registration',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: '`me` or a staff profile id',
    example: 'me',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== 'me')
  @IsUUID()
  assignedTo?: string;

  @ApiPropertyOptional({
    description: 'Only jobs that are not completed or cancelled',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  active?: boolean;
}
