import { BadRequestException } from '@nestjs/common';
import { ServiceCenterStatus } from '../../common/enums/service-center-status.enum';
import { VehicleType } from '../../common/enums/vehicle-type.enum';
import { DiscoveryAreaQueryDto } from './dto/discovery-area-query.dto';

export const DEFAULT_DISCOVERY_RADIUS_METERS = 15000;

export function validateDiscoveryArea(
  query: DiscoveryAreaQueryDto,
  requireArea = false,
) {
  if ((query.lat === undefined) !== (query.lng === undefined))
    throw new BadRequestException('Provide both latitude and longitude');
  if (query.radiusMeters !== undefined && query.lat === undefined)
    throw new BadRequestException('A radius needs a location');
  if (query.city?.trim() && query.postalCode)
    throw new BadRequestException('Choose either a city or a PIN code');
  if (
    requireArea &&
    !query.city?.trim() &&
    !query.postalCode &&
    query.lat === undefined
  )
    throw new BadRequestException(
      'Choose a city, PIN code or coordinate location',
    );
  if (requireArea && query.city?.trim() && query.lat !== undefined)
    throw new BadRequestException(
      'Choose either a city or a coordinate location',
    );
}

export function discoveryDistanceSql(center = 'c') {
  return `6371000 * acos(least(1.0, greatest(-1.0, sin(radians(:lat)) * sin(radians(${center}.latitude)) + cos(radians(:lat)) * cos(radians(${center}.latitude)) * cos(radians(${center}.longitude - :lng)))))`;
}

/** Used both on center rows and in the whole-area service-availability EXISTS query. */
export function eligibleDiscoveryCenter(query: DiscoveryAreaQueryDto) {
  const clauses = ['c.status = :centerStatus', 'c.deleted_at IS NULL'];
  const parameters: Record<string, unknown> = {
    centerStatus: ServiceCenterStatus.ACTIVE,
  };
  if (query.vehicleType) {
    clauses.push('c.supported_vehicle_types @> :types');
    parameters.types = JSON.stringify([query.vehicleType]);
    parameters.vehicleType = query.vehicleType;
  }
  if (query.city?.trim()) {
    clauses.push('LOWER(c.city) = :city');
    parameters.city = query.city.trim().toLowerCase();
  }
  if (query.postalCode) {
    clauses.push('c.postal_code = :postalCode');
    parameters.postalCode = query.postalCode;
  }
  if (query.lat !== undefined) {
    clauses.push('c.latitude IS NOT NULL AND c.longitude IS NOT NULL');
    clauses.push(`${discoveryDistanceSql()} <= :radius`);
    parameters.lat = query.lat;
    parameters.lng = query.lng;
    parameters.radius = query.radiusMeters ?? DEFAULT_DISCOVERY_RADIUS_METERS;
  }
  return { where: clauses.join(' AND '), parameters };
}

/** Aliases c/o/d refer to a center, its offering and the shared definition. */
export function eligibleDiscoveryOffering(query: DiscoveryAreaQueryDto) {
  const commonTypes = [VehicleType.TWO_WHEELER, VehicleType.FOUR_WHEELER]
    .map(
      (type) =>
        `(c.supported_vehicle_types @> '["${type}"]' AND (o.vehicle_type IS NULL OR o.vehicle_type = '${type}') AND (o.service_definition_id IS NULL OR d.vehicle_types @> '["${type}"]'))`,
    )
    .join(' OR ');
  return `o.service_center_id = c.id AND o.is_active = true AND o.deleted_at IS NULL
    AND (o.service_definition_id IS NULL OR d.is_active = true)
    AND (${commonTypes})
    ${query.vehicleType ? 'AND (o.vehicle_type IS NULL OR o.vehicle_type = :vehicleType) AND (o.service_definition_id IS NULL OR d.vehicle_types @> :types)' : ''}`;
}
