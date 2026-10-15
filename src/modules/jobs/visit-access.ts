import { NotFoundException } from '@nestjs/common';
import { EntityManager, FindOptionsWhere, IsNull } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { Vehicle } from '../customers/entities/vehicle.entity';
import {
  JobCustomerAccess,
  VisitAccessSource,
} from './entities/job-customer-access.entity';
import { ServiceJob } from './entities/service-job.entity';

/** Shared by customer job reads and support context. No contact-link fallback. */
export function visitAccessWhere(
  profileId: string,
): FindOptionsWhere<ServiceJob> {
  return {
    customerAccess: {
      customerProfileId: profileId,
      canView: true,
      revokedAt: IsNull(),
      profile: { deletedAt: IsNull() },
    },
  };
}

/** Call only for a newly created job, inside its intake/check-in transaction. */
export async function recordVisitAccess(
  manager: EntityManager,
  job: ServiceJob,
  customer: Customer,
  vehicle: Vehicle,
  source: Exclude<VisitAccessSource, 'LEGACY_CONTACT_LINK'>,
): Promise<void> {
  if (!customer.customerProfileId) throw new NotFoundException();
  job.billingCustomerProfileId = customer.customerProfileId;
  job.intakeSnapshot = {
    customerName: customer.name,
    customerPhone: customer.phone,
    vehicleRegistration: vehicle.registrationNumber,
    vehicleLabel: vehicle.makeModel,
    garageVehicleId: vehicle.garageVehicleId ?? null,
  };
  await manager.getRepository(ServiceJob).update(job.id, {
    billingCustomerProfileId: job.billingCustomerProfileId,
    intakeSnapshot: job.intakeSnapshot,
  });
  await manager.getRepository(JobCustomerAccess).insert({
    jobId: job.id,
    customerProfileId: customer.customerProfileId,
    source,
    customerRevision: customer.revision,
    canView: true,
    canDecide: true,
    version: 1,
    revokedAt: null,
  });
}

/**
 * Recheck authorization within the decision transaction. Shared row locks keep
 * deletion/revocation from passing an accepted decision. Future grant writers
 * must take profile -> grant locks before approval/job writes in this order.
 */
export async function lockVisitDecisionAccess(
  manager: EntityManager,
  jobId: string,
  profileId: string,
): Promise<void> {
  const profile = await manager.getRepository(CustomerProfile).findOne({
    where: { id: profileId },
    lock: { mode: 'pessimistic_read' },
  });
  if (!profile) throw new NotFoundException();
  const grant = await manager.getRepository(JobCustomerAccess).findOne({
    where: {
      jobId,
      customerProfileId: profileId,
      canView: true,
      canDecide: true,
      revokedAt: IsNull(),
    },
    lock: { mode: 'pessimistic_read' },
  });
  if (!grant) throw new NotFoundException();
}
