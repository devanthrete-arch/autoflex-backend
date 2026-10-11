import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DiscoveryAreaQueryDto } from './discovery-area-query.dto';
export class ListCentersQueryDto extends DiscoveryAreaQueryDto {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() serviceId?: string;
  @IsOptional()
  @Transform(({ value }) => {
    const values = typeof value === 'string' ? [value] : value;
    return Array.isArray(values)
      ? [
          ...new Set(
            values.map((id) =>
              typeof id === 'string' ? id.toLowerCase() : id,
            ),
          ),
        ]
      : values;
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID(undefined, { each: true })
  serviceIds?: string[];
  @IsOptional()
  @IsIn(['nearest', 'farthest', 'top_rated'])
  sort?: 'nearest' | 'farthest' | 'top_rated';
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  offset?: number;
}
