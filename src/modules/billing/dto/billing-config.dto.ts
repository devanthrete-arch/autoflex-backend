import { IsObject, IsString, Length } from 'class-validator';
import type { BillingPolicy } from '../billing-calculator';

export class CreateBillingConfigurationDto {
  @IsObject() policy: BillingPolicy;
  @IsString() @Length(1, 255) evidenceReference: string;
}

export class ApproveBillingConfigurationDto {
  @IsString() @Length(1, 255) evidenceReference: string;
}

export class SuspendBillingConfigurationDto {
  @IsString() @Length(1, 500) reason: string;
}
