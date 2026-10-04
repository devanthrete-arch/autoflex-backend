import 'reflect-metadata';
import dataSource from './data-source';
import { PromotionScope } from '../common/enums/promotion-scope.enum';
import { ServiceCenterStatus } from '../common/enums/service-center-status.enum';
import { VehicleType } from '../common/enums/vehicle-type.enum';
import { Promotion } from '../modules/marketplace/entities/promotion.entity';
import {
  ServiceCategory,
  ServiceCenterCategory,
} from '../modules/marketplace/entities/service-category.entity';
import { ServiceCenter } from '../modules/tenancy/entities/service-center.entity';
import { StaffProfile } from '../modules/tenancy/entities/staff-profile.entity';

async function seedDev() {
  await dataSource.initialize();
  const centerRepo = dataSource.getRepository(ServiceCenter);
  const staffRepo = dataSource.getRepository(StaffProfile);
  const categoryRepo = dataSource.getRepository(ServiceCategory);
  const linkRepo = dataSource.getRepository(ServiceCenterCategory);
  const promoRepo = dataSource.getRepository(Promotion);

  const domainId =
    process.env.SEED_IAM_DOMAIN_ID ?? '11111111-1111-4111-8111-111111111111';
  const iamUserId =
    process.env.SEED_IAM_USER_ID ?? '22222222-2222-4222-8222-222222222222';

  let center = await centerRepo.findOne({ where: { iamDomainId: domainId } });
  if (!center) {
    center = await centerRepo.save(
      centerRepo.create({
        iamDomainId: domainId,
        name: process.env.SEED_CENTER_NAME ?? 'Apex Auto Garage',
        displayName: 'Apex Auto Garage',
        status: ServiceCenterStatus.ACTIVE,
        latitude: 12.9716,
        longitude: 77.5946,
        formattedAddress: '12 MG Road, Bengaluru, KA 560001, IN',
        ratingAvg: '4.90',
        ratingCount: 128,
        autoAccept: true,
        bookingEnabled: true,
      }),
    );
    console.log(`Created service center ${center.id} for domain ${domainId}`);
  } else {
    center.displayName = center.displayName ?? 'Apex Auto Garage';
    center.latitude = center.latitude ?? 12.9716;
    center.longitude = center.longitude ?? 77.5946;
    center.formattedAddress =
      center.formattedAddress ?? '12 MG Road, Bengaluru, KA 560001, IN';
    center.ratingAvg = center.ratingAvg ?? '4.90';
    center.ratingCount = center.ratingCount || 128;
    center.autoAccept = true;
    center.bookingEnabled = true;
    center = await centerRepo.save(center);
    console.log(`Service center already exists: ${center.id}`);
  }

  let profile = await staffRepo.findOne({
    where: { serviceCenterId: center.id, iamUserId },
  });
  if (!profile) {
    profile = await staffRepo.save(
      staffRepo.create({
        serviceCenterId: center.id,
        iamUserId,
        displayName: process.env.SEED_STAFF_NAME ?? 'Demo Advisor',
        isActive: true,
      }),
    );
    console.log(
      `Created staff profile ${profile.id} for IAM user ${iamUserId}`,
    );
  } else {
    console.log(`Staff profile already exists: ${profile.id}`);
  }

  const categorySpecs = [
    {
      slug: 'periodic-service',
      name: 'Periodic service',
      iconKey: 'wrench',
      sortOrder: 1,
    },
    { slug: 'oil-change', name: 'Oil change', iconKey: 'oil', sortOrder: 2 },
    { slug: 'tyre', name: 'Tyre', iconKey: 'tyre', sortOrder: 3 },
  ];
  const categories: ServiceCategory[] = [];
  for (const spec of categorySpecs) {
    let cat = await categoryRepo.findOne({ where: { slug: spec.slug } });
    if (!cat) {
      cat = await categoryRepo.save(
        categoryRepo.create({
          ...spec,
          vehicleType: VehicleType.TWO_WHEELER,
        }),
      );
    }
    categories.push(cat);
  }

  for (const cat of categories) {
    const existingLink = await linkRepo.findOne({
      where: { serviceCenterId: center.id, categoryId: cat.id },
    });
    if (!existingLink) {
      await linkRepo.save(
        linkRepo.create({ serviceCenterId: center.id, categoryId: cat.id }),
      );
    }
  }

  const existingPromo = await promoRepo.findOne({
    where: { title: 'Enjoy extra off up to 30%' },
  });
  if (!existingPromo) {
    await promoRepo.save(
      promoRepo.create({
        scope: PromotionScope.PLATFORM,
        kicker: "Today's exclusive deals",
        title: 'Enjoy extra off up to 30%',
        percentOff: 30,
        ctaLabel: 'Claim now',
        isActive: true,
      }),
    );
  }

  await dataSource.destroy();
}

seedDev().catch((error) => {
  console.error(error);
  process.exit(1);
});
