import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { VehicleType } from '../../../common/enums/vehicle-type.enum';
import { isGoogleMapsUrl } from '../google-maps-url';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const INDIA_PIN = /^[1-9]\d{5}$/;
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PHONE = /^(?:\+91)?[6-9]\d{9}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UPI_VPA = /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$/;

export class UpdateCenterDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  displayName?: string;

  @IsOptional()
  @Matches(SLUG)
  @MaxLength(100)
  slug?: string;

  @IsOptional()
  @Matches(PHONE)
  publicPhone?: string;

  @IsOptional()
  @Matches(GSTIN)
  gstin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  addressLine1?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  addressLine2?: string | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string | null;

  @IsOptional()
  @Matches(INDIA_PIN)
  postalCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  formattedAddress?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number | null;

  @IsOptional()
  @IsUrl({
    require_tld: false,
    protocols: ['https', 'http'],
    require_protocol: true,
    disallow_auth: true,
  })
  @MaxLength(1024)
  heroImageUrl?: string | null;

  @ValidateIf((dto: UpdateCenterDto) => dto.photoUrls !== undefined)
  @IsArray()
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsUrl(
    {
      require_tld: false,
      protocols: ['https', 'http'],
      require_protocol: true,
      disallow_auth: true,
    },
    { each: true },
  )
  @MaxLength(1024, { each: true })
  photoUrls?: string[];

  @ValidateBy({
    name: 'googleMapsUrl',
    validator: {
      validate: isGoogleMapsUrl,
      defaultMessage: () => 'googleMapsUrl must be a Google Maps HTTPS link',
    },
  })
  googleMapsUrl?: string | null;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(1024)
  logoUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(VehicleType, { each: true })
  supportedVehicleTypes?: VehicleType[];

  @IsOptional()
  @IsBoolean()
  pickupDropEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  autoAccept?: boolean;

  @IsOptional()
  @IsBoolean()
  bookingEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  slotCapacity?: number;

  /** Shown on bills so owners can pay at the counter. */
  @IsOptional()
  @Matches(UPI_VPA)
  @MaxLength(100)
  upiVpa?: string;

  @IsOptional()
  @IsBoolean()
  expressSkipEnabled?: boolean;

  @IsOptional()
  @Matches(HH_MM)
  hoursStart?: string;

  @IsOptional()
  @Matches(HH_MM)
  hoursEnd?: string;
}

export class DayHoursDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @IsBoolean()
  isClosed: boolean;

  @IsOptional()
  @Matches(HH_MM)
  openTime?: string;

  @IsOptional()
  @Matches(HH_MM)
  closeTime?: string;
}

export class PutHoursDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => DayHoursDto)
  days: DayHoursDto[];
}
