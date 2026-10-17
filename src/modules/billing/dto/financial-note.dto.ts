import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
export class NoteLineDto {
  @IsUUID() sourceLineId: string;
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/) netInr: string;
}
export class ProposeNoteDto {
  @IsIn(['CREDIT', 'DEBIT']) kind: 'CREDIT' | 'DEBIT';
  @IsString() @Length(3, 500) reason: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => NoteLineDto)
  lines: NoteLineDto[];
}
export class NoteDecisionDto {
  @IsIn(['ACCEPT', 'DECLINE']) decision: 'ACCEPT' | 'DECLINE';
}
export class IssueNoteDto {
  @IsString() @Length(3, 500) evidenceReference: string;
}
export class NotePaymentDto {
  @IsIn(['CASH', 'UPI', 'CARD']) method: 'CASH' | 'UPI' | 'CARD';
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/) amountInr: string;
  @IsString() @Length(0, 64) reference: string;
}
