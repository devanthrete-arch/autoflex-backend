import { VehicleType } from '../../src/common/enums/vehicle-type.enum';
import { DataSource } from 'typeorm';
import { ServiceCenterStatus } from '../../src/common/enums/service-center-status.enum';
import { ServiceCenter } from '../../src/modules/tenancy/entities/service-center.entity';
import { StaffProfile } from '../../src/modules/tenancy/entities/staff-profile.entity';

export const TEST_DOMAIN_ID = '11111111-1111-4111-8111-111111111111';
export const TEST_IAM_USER_ID = '22222222-2222-4222-8222-222222222222';
export const TEST_OTHER_DOMAIN_ID = '33333333-3333-4333-8333-333333333333';
export const TEST_OTHER_USER_ID = '44444444-4444-4444-8444-444444444444';
/** Distinct from staff JWT `domainApplicationId` default (`app-123`). */
export const TEST_CUSTOMER_APP_ID = 'cust-app-123';
export const TEST_CUSTOMER_IAM_USER_ID = '55555555-5555-4555-8555-555555555555';
export const TEST_CUSTOMER_DOMAIN_ID = '66666666-6666-4666-8666-666666666666';

export async function seedTestTenancy(dataSource: DataSource): Promise<{
  serviceCenter: ServiceCenter;
  staffProfile: StaffProfile;
  otherCenter: ServiceCenter;
  otherStaffProfile: StaffProfile;
}> {
  const centerRepo = dataSource.getRepository(ServiceCenter);
  const staffRepo = dataSource.getRepository(StaffProfile);

  const serviceCenter = await centerRepo.save(
    centerRepo.create({
      iamDomainId: TEST_DOMAIN_ID,
      name: 'Test Motors',
      status: ServiceCenterStatus.ACTIVE,
      supportedVehicleTypes: [VehicleType.TWO_WHEELER],
    }),
  );

  const staffProfile = await staffRepo.save(
    staffRepo.create({
      serviceCenterId: serviceCenter.id,
      iamUserId: TEST_IAM_USER_ID,
      displayName: 'Test Advisor',
      isActive: true,
    }),
  );

  const otherCenter = await centerRepo.save(
    centerRepo.create({
      iamDomainId: TEST_OTHER_DOMAIN_ID,
      name: 'Other Motors',
      status: ServiceCenterStatus.ACTIVE,
      supportedVehicleTypes: [VehicleType.TWO_WHEELER],
    }),
  );

  const otherStaffProfile = await staffRepo.save(
    staffRepo.create({
      serviceCenterId: otherCenter.id,
      iamUserId: TEST_OTHER_USER_ID,
      displayName: 'Other Advisor',
      isActive: true,
    }),
  );

  return { serviceCenter, staffProfile, otherCenter, otherStaffProfile };
}

/** Optional listing/geo fields — kit marketplace + booking e2e. */
export async function seedCenterListing(
  dataSource: DataSource,
  centerId: string,
): Promise<ServiceCenter> {
  const centerRepo = dataSource.getRepository(ServiceCenter);
  const center = await centerRepo.findOne({ where: { id: centerId } });
  if (!center) {
    throw new Error(`Service center ${centerId} not found`);
  }
  center.displayName = center.displayName ?? center.name;
  center.latitude = center.latitude ?? 12.9716;
  center.longitude = center.longitude ?? 77.5946;
  center.formattedAddress =
    center.formattedAddress ?? '12 MG Road, Bengaluru, KA 560001, IN';
  center.ratingAvg = center.ratingAvg ?? '4.90';
  center.ratingCount = center.ratingCount || 128;
  center.autoAccept = true;
  center.bookingEnabled = true;
  center.hoursStart = center.hoursStart || '09:00';
  center.hoursEnd = center.hoursEnd || '17:00';
  return centerRepo.save(center);
}
