import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class InvoiceBuyerDto {
  @IsIn(['INDIVIDUAL', 'BUSINESS']) type: 'INDIVIDUAL' | 'BUSINESS';
  @IsString() @MaxLength(160) name: string;
  @IsString() @MaxLength(500) address: string;
  @Matches(/^[1-9]\d{5}$/) pin: string;
  @Matches(/^\d{2}$/) stateCode: string;
  @IsOptional() @IsString() @Length(15, 15) gstin?: string;
}
export class InvoiceLineRuleDto {
  @IsOptional() @Matches(/^\d{1,10}(?:\.\d{1,2})?$/) discountInr?: string;
  @IsOptional() @IsString() @Length(3, 300) discountReason?: string;
  @IsUUID() lineItemId: string;
  @IsString() @Length(1, 80) ruleKey: string;
}
export class InvoiceSelectionDto {
  @IsIn(['AT_CENTER', 'PICKUP_DROP', 'FLEET', 'OFFSITE']) supplyContext:
    | 'AT_CENTER'
    | 'PICKUP_DROP'
    | 'FLEET'
    | 'OFFSITE';
  @IsString() @Length(1, 80) placeOfSupplyRuleKey: string;
  @ValidateNested() @Type(() => InvoiceBuyerDto) buyer: InvoiceBuyerDto;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) supplyDate: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineRuleDto)
  lineRules: InvoiceLineRuleDto[];
}
