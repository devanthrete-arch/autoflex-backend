import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export const RESOLUTION_CODES = [
  'INFORMATION_PROVIDED',
  'ACTION_COMPLETED',
  'DUPLICATE',
  'WITHDRAWN',
  'NO_ACTION_REQUIRED',
] as const;
export class SupportMessageDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(4000) message: string;
}
export class SupportPublicReplyDto extends SupportMessageDto {
  @IsBoolean() awaitCustomerReply: boolean;
}
export class SupportReasonDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}
export class SupportAssignDto {
  @IsUUID() assignedAgentProfileId: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason?: string;
}
export class SupportWaitDto extends SupportReasonDto {
  @IsIn(['CENTER', 'INTERNAL', null]) waitingOn: 'CENTER' | 'INTERNAL' | null;
}
export class SupportPriorityDto extends SupportReasonDto {
  @IsIn(['NORMAL', 'HIGH']) priority: 'NORMAL' | 'HIGH';
}
export class SupportExplanationDto {
  @Transform(trim) @IsString() @MinLength(10) @MaxLength(4000) message: string;
}
export class SupportResolveDto extends SupportExplanationDto {
  @IsIn(RESOLUTION_CODES) resolutionCode: (typeof RESOLUTION_CODES)[number];
}
export class SupportEmptyDto {}
export class SupportQueueQueryDto {
  @IsOptional()
  @IsIn(['ACTIVE', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'ALL'])
  status?: string;
  @IsOptional()
  @Matches(
    /^(all|me|unassigned|inactive|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  assignee?: string;
  @IsOptional()
  @IsIn(['BOOKING', 'SERVICE', 'PAYMENT', 'ACCOUNT', 'APP', 'OTHER'])
  category?: string;
  @IsOptional() @IsIn(['NORMAL', 'HIGH']) priority?: string;
  @IsOptional()
  @IsIn(['CUSTOMER', 'CENTER', 'INTERNAL', 'NONE'])
  waitingOn?: string;
  @IsOptional() @IsIn(['true', 'false']) needsReply?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(150) q?: string;
  @IsOptional() @IsIn(['oldest', 'recentActivity']) sort?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(1000) cursor?: string;
}
export class SupportHistoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) beforeVersion?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
export class SupportRosterQueryDto {
  @IsOptional() @IsIn(['true', 'false']) includeInactive?: string;
}
export type SupportCommandBody = Partial<
  SupportPublicReplyDto &
    SupportReasonDto &
    SupportAssignDto &
    SupportWaitDto &
    SupportPriorityDto &
    SupportResolveDto
>;
