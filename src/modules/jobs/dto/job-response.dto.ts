import { ApiProperty } from '@nestjs/swagger';
import { JobPriority } from '../../../common/enums/job-priority.enum';
import { JobStatus } from '../../../common/enums/job-status.enum';
import { VehicleType } from '../../../common/enums/vehicle-type.enum';

export class JobResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  serviceCenterId: string;

  @ApiProperty()
  customerId: string;

  @ApiProperty()
  vehicleId: string;

  @ApiProperty({ enum: VehicleType })
  vehicleType: VehicleType;

  @ApiProperty({ enum: JobStatus })
  status: JobStatus;

  @ApiProperty()
  serviceType: string;

  @ApiProperty({ nullable: true })
  odometerKm: number | null;

  @ApiProperty({ nullable: true })
  fuelLevel: string | null;

  @ApiProperty({ nullable: true })
  estimatedReadyAt: Date | null;

  @ApiProperty({ nullable: true })
  assignedTechnicianId: string | null;

  @ApiProperty({ enum: JobPriority })
  priority: JobPriority;

  @ApiProperty({ nullable: true })
  budgetCeiling: string | null;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  accessoriesChecklist: Record<string, unknown> | null;

  @ApiProperty({ nullable: true })
  paymentMode: string | null;

  @ApiProperty()
  publicToken: string;

  @ApiProperty({ nullable: true })
  sourceBookingId: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ nullable: true })
  closedAt: Date | null;
}

export class PaginatedJobsResponseDto {
  @ApiProperty({ type: [JobResponseDto] })
  data: JobResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
