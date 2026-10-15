import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { VehicleType } from '../../src/common/enums/vehicle-type.enum';
import { CustomerProfile } from '../../src/modules/customers/entities/customer-profile.entity';
import { Customer } from '../../src/modules/customers/entities/customer.entity';
import { Vehicle } from '../../src/modules/customers/entities/vehicle.entity';

/** Test-only fixture: registration/account linking is not an intake API. */
export async function seedReturningWalkIn(
  db: DataSource,
  serviceCenterId: string,
  options: {
    phone?: string;
    name?: string;
    registrationNumber?: string;
    makeModel?: string;
    vehicleType?: VehicleType | null;
    profileId?: string;
  } = {},
) {
  const phone = options.phone ?? '+919876543210';
  const registrationNumber = options.registrationNumber ?? 'KA01AB1234';
  const profile = options.profileId
    ? await db.getRepository(CustomerProfile).findOneByOrFail({
        id: options.profileId,
      })
    : await db.getRepository(CustomerProfile).save({
        iamUserId: randomUUID(),
        phone,
        displayName: options.name ?? 'Returning customer',
      });
  const customer = await db.getRepository(Customer).save({
    serviceCenterId,
    phone,
    phoneCanonical: phone,
    name: options.name ?? 'Returning customer',
    customerProfileId: profile.id,
    revision: 1,
  });
  const vehicle = await db.getRepository(Vehicle).save({
    serviceCenterId,
    customerId: customer.id,
    registrationNumber,
    registrationCanonical: registrationNumber
      .replace(/[\s-]/g, '')
      .toUpperCase(),
    makeModel: options.makeModel ?? 'Honda Activa',
    vehicleType:
      options.vehicleType === undefined
        ? VehicleType.TWO_WHEELER
        : options.vehicleType,
    revision: 1,
  });
  return {
    profile,
    customer,
    vehicle,
    selection: {
      customerId: customer.id,
      customerRevision: customer.revision,
      vehicleId: vehicle.id,
      vehicleRevision: vehicle.revision,
    },
  };
}
