import dataSource from '../database/data-source';
import {
  tryCanonicalPhone,
  tryCanonicalPlate,
} from '../modules/jobs/intake-identity';

type Contact = {
  id: string;
  service_center_id: string;
  phone: string;
  customer_profile_id: string | null;
};
type CenterVehicle = {
  id: string;
  service_center_id: string;
  customer_id: string;
  registration_number: string;
  garage_vehicle_id: string | null;
  vehicle_type?: string | null;
};
type Garage = {
  id: string;
  customer_profile_id: string;
  registration_number: string;
  vehicle_type: string;
  deleted_at: Date | null;
};
type Job = {
  service_center_id: string;
  customer_id: string;
  vehicle_id: string;
  status: string;
};

/** Read-only counts, deliberately excluding phone, plate, names and IDs from output. */
async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    const report = await dataSource.transaction(
      'REPEATABLE READ',
      async (manager) => {
        await manager.query('SET TRANSACTION READ ONLY');
        const contacts = await manager.query<Contact[]>(
          'SELECT id, service_center_id, phone, customer_profile_id FROM customers WHERE deleted_at IS NULL',
        );
        const vehicles = await manager.query<CenterVehicle[]>(
          'SELECT * FROM vehicles WHERE deleted_at IS NULL',
        );
        const garages = await manager.query<Garage[]>(
          'SELECT id, customer_profile_id, registration_number, vehicle_type, deleted_at FROM garage_vehicles',
        );
        const jobs = await manager.query<Job[]>(
          'SELECT service_center_id, customer_id, vehicle_id, status FROM service_jobs WHERE deleted_at IS NULL',
        );
        const contactsById = new Map(contacts.map((c) => [c.id, c]));
        const vehiclesById = new Map(vehicles.map((v) => [v.id, v]));
        const garagesById = new Map(garages.map((g) => [g.id, g]));
        function collisions(keys: (string | null)[]): number {
          const counts = new Map<string, number>();
          for (const key of keys)
            if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
          return [...counts.values()].filter((n) => n > 1).length;
        }
        return {
          mode: 'READ_ONLY_COUNTS',
          liveCenterCustomers: contacts.length,
          linkedCenterCustomers: contacts.filter((c) => !!c.customer_profile_id)
            .length,
          contactsRequiringAccountLink: contacts.filter(
            (c) => !c.customer_profile_id,
          ).length,
          invalidLegacyPhones: contacts.filter(
            (c) => !tryCanonicalPhone(c.phone),
          ).length,
          canonicalPhoneConflictGroups: collisions(
            contacts.map((c) => {
              const phone = tryCanonicalPhone(c.phone);
              return phone ? `${c.service_center_id}:${phone}` : null;
            }),
          ),
          liveCenterVehicles: vehicles.length,
          invalidLegacyPlates: vehicles.filter(
            (v) => !tryCanonicalPlate(v.registration_number),
          ).length,
          canonicalPlateConflictGroups: collisions(
            vehicles.map((v) => {
              const plate = tryCanonicalPlate(v.registration_number);
              return plate ? `${v.service_center_id}:${plate}` : null;
            }),
          ),
          unknownCenterVehicleTypes: vehicles.filter((v) => !v.vehicle_type)
            .length,
          vehicleCustomerCenterMismatches: vehicles.filter(
            (v) =>
              contactsById.get(v.customer_id)?.service_center_id !==
              v.service_center_id,
          ).length,
          incompatibleGarageLinks: vehicles.filter((v) => {
            if (!v.garage_vehicle_id) return false;
            const g = garagesById.get(v.garage_vehicle_id);
            const c = contactsById.get(v.customer_id);
            return (
              !g ||
              !!g.deleted_at ||
              g.customer_profile_id !== c?.customer_profile_id ||
              tryCanonicalPlate(g.registration_number) !==
                tryCanonicalPlate(v.registration_number) ||
              (!!v.vehicle_type && v.vehicle_type !== g.vehicle_type)
            );
          }).length,
          multipleActiveJobGroups: collisions(
            jobs
              .filter((j) => !['COMPLETED', 'CANCELLED'].includes(j.status))
              .map((j) => `${j.service_center_id}:${j.vehicle_id}`),
          ),
          historicalJobAssociationMismatches: jobs.filter((j) => {
            const v = vehiclesById.get(j.vehicle_id);
            const c = contactsById.get(j.customer_id);
            return (
              !v ||
              !c ||
              v.service_center_id !== j.service_center_id ||
              c.service_center_id !== j.service_center_id ||
              v.customer_id !== j.customer_id
            );
          }).length,
          warning:
            'A stored account/garage association is not VAHAN RC verification. Resolve conflicts explicitly; do not automatically merge or transfer records.',
        };
      },
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await dataSource.destroy();
  }
}

void main().catch(() => {
  process.stderr.write(
    'Intake preflight failed. Check database access/configuration; no records were changed.\n',
  );
  process.exitCode = 1;
});
