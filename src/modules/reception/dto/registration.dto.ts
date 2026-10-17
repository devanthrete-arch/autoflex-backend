import { Equals, IsString, Length, Matches } from 'class-validator';
export class StartRegistrationDto {
  @IsString() @Length(10, 20) phone: string;
}
export class RegistrationChallengeDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) challenge: string;
}
export class ConsentRegistrationDto extends RegistrationChallengeDto {
  @Equals(true) consent: true;
  @IsString() @Length(1, 160) name: string;
  @IsString() @Length(16, 12000) verificationAssertion: string;
}
