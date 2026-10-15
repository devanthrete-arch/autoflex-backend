import { MigrationInterface, QueryRunner } from 'typeorm';

// Migration semantics are frozen here; future runtime validation changes must
// not change what this historical migration does on an existing database.
function tryCanonicalPhone(value: string): string | null {
  if (!/^\+?[\d\s-]+$/.test(value.trim())) return null;
  const match = /^(?:\+91|91)?([6-9]\d{9})$/.exec(
    value.trim().replace(/[\s-]/g, ''),
  );
  return match ? `+91${match[1]}` : null;
}
function tryCanonicalPlate(value: string): string | null {
  if (!/^[a-z\d\s-]+$/i.test(value.trim())) return null;
  const compact = value.trim().replace(/[\s-]/g, '').toUpperCase();
  return compact.length >= 4 &&
    compact.length <= 32 &&
    /[A-Z]/.test(compact) &&
    /\d/.test(compact)
    ? compact
    : null;
}

/** Preserve legacy collisions and unknown types; never merge or guess ownership. */
export class ReturningWalkIn1730000000011 implements MigrationInterface {
  name = 'ReturningWalkIn1730000000011';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_canonical varchar(20), ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1 CHECK (revision > 0)`,
    );
    await q.query(
      `ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS registration_canonical varchar(32), ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1 CHECK (revision > 0), ADD COLUMN IF NOT EXISTS vehicle_type vehicle_type_enum`,
    );
    // Bounded pages keep the migration usable on existing center data. Invalid
    // presentation remains NULL for explicit remediation; no identity is rewritten.
    for (let offset = 0; ; offset += 1000) {
      const rows = (await q.query(
        `SELECT id, phone FROM customers ORDER BY id LIMIT 1000 OFFSET ${offset}`,
      )) as { id: string; phone: string }[];
      for (const row of rows)
        await q.query(
          'UPDATE customers SET phone_canonical = $1 WHERE id = $2',
          [tryCanonicalPhone(row.phone), row.id],
        );
      if (rows.length < 1000) break;
    }
    for (let offset = 0; ; offset += 1000) {
      const rows = (await q.query(
        `SELECT id, registration_number FROM vehicles ORDER BY id LIMIT 1000 OFFSET ${offset}`,
      )) as { id: string; registration_number: string }[];
      for (const row of rows)
        await q.query(
          'UPDATE vehicles SET registration_canonical = $1 WHERE id = $2',
          [tryCanonicalPlate(row.registration_number), row.id],
        );
      if (rows.length < 1000) break;
    }
    for (let offset = 0; ; offset += 1000) {
      const linked = (await q.query(
        `SELECT v.id, v.vehicle_type AS center_vehicle_type, v.registration_canonical, g.registration_number, g.vehicle_type FROM vehicles v INNER JOIN garage_vehicles g ON v.garage_vehicle_id = g.id INNER JOIN customers c ON v.customer_id = c.id WHERE v.service_center_id = c.service_center_id AND c.customer_profile_id = g.customer_profile_id AND g.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY v.id LIMIT 1000 OFFSET ${offset}`,
      )) as {
        id: string;
        center_vehicle_type: string | null;
        registration_canonical: string | null;
        registration_number: string;
        vehicle_type: string;
      }[];
      for (const row of linked)
        if (
          !row.center_vehicle_type &&
          row.registration_canonical &&
          row.registration_canonical ===
            tryCanonicalPlate(row.registration_number)
        )
          await q.query('UPDATE vehicles SET vehicle_type = $1 WHERE id = $2', [
            row.vehicle_type,
            row.id,
          ]);
      if (linked.length < 1000) break;
    }
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_intake_customer_phone ON customers (service_center_id, phone_canonical) WHERE deleted_at IS NULL`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_intake_vehicle_plate ON vehicles (service_center_id, registration_canonical) WHERE deleted_at IS NULL`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_intake_customer_vehicles ON vehicles (service_center_id, customer_id, id) WHERE deleted_at IS NULL`,
    );
    await q.query(`CREATE OR REPLACE FUNCTION af006_customer_identity() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE digits text;
      BEGIN
        digits := regexp_replace(NEW.phone, '[\\s-]', '', 'g');
        NEW.phone_canonical := CASE
          WHEN digits ~ '^[6-9][0-9]{9}$' THEN '+91' || digits
          WHEN digits ~ '^91[6-9][0-9]{9}$' THEN '+' || digits
          WHEN digits ~ '^\\+91[6-9][0-9]{9}$' THEN digits
          ELSE NULL END;
        IF TG_OP = 'UPDATE' THEN
          IF ROW(NEW.service_center_id, NEW.phone, NEW.name, NEW.customer_profile_id, NEW.deleted_at) IS DISTINCT FROM ROW(OLD.service_center_id, OLD.phone, OLD.name, OLD.customer_profile_id, OLD.deleted_at) THEN NEW.revision := OLD.revision + 1;
          ELSE NEW.revision := OLD.revision; END IF;
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE OR REPLACE FUNCTION af006_vehicle_identity() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE plate text;
      BEGIN
        plate := upper(regexp_replace(NEW.registration_number, '[\\s-]', '', 'g'));
        NEW.registration_canonical := CASE WHEN NEW.registration_number ~ '^[a-zA-Z0-9\\s-]+$' AND plate ~ '[A-Z]' AND plate ~ '[0-9]' AND length(plate) BETWEEN 4 AND 32 THEN plate ELSE NULL END;
        IF TG_OP = 'UPDATE' THEN
          IF ROW(NEW.service_center_id, NEW.customer_id, NEW.registration_number, NEW.make_model, NEW.make, NEW.model, NEW.variant, NEW.chassis_number, NEW.engine_number, NEW.garage_vehicle_id, NEW.vehicle_type, NEW.deleted_at) IS DISTINCT FROM ROW(OLD.service_center_id, OLD.customer_id, OLD.registration_number, OLD.make_model, OLD.make, OLD.model, OLD.variant, OLD.chassis_number, OLD.engine_number, OLD.garage_vehicle_id, OLD.vehicle_type, OLD.deleted_at) THEN NEW.revision := OLD.revision + 1;
          ELSE NEW.revision := OLD.revision; END IF;
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(
      `CREATE TRIGGER af006_customer_identity BEFORE INSERT OR UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION af006_customer_identity()`,
    );
    await q.query(
      `CREATE TRIGGER af006_vehicle_identity BEFORE INSERT OR UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION af006_vehicle_identity()`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      'DROP TRIGGER IF EXISTS af006_customer_identity ON customers',
    );
    await q.query('DROP TRIGGER IF EXISTS af006_vehicle_identity ON vehicles');
    await q.query('DROP FUNCTION IF EXISTS af006_customer_identity()');
    await q.query('DROP FUNCTION IF EXISTS af006_vehicle_identity()');
    await q.query('DROP INDEX IF EXISTS idx_intake_customer_phone');
    await q.query('DROP INDEX IF EXISTS idx_intake_vehicle_plate');
    await q.query('DROP INDEX IF EXISTS idx_intake_customer_vehicles');
    // Deliberately retain additive columns and confirmed types/revisions. A UI
    // rollback must not erase intake evidence or restore unsafe reassignment.
  }
}
