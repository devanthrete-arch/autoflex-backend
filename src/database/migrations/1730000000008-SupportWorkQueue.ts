import { MigrationInterface, QueryRunner } from 'typeorm';
export class SupportWorkQueue1730000000008 implements MigrationInterface {
  name = 'SupportWorkQueue1730000000008';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE support_agent_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), iam_domain_id varchar(128) NOT NULL, iam_user_id varchar(128) NOT NULL,
      display_name varchar(255) NOT NULL, is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT UQ_support_agent_identity UNIQUE (iam_domain_id, iam_user_id))`);
    await runner.query(`ALTER TABLE support_requests
      ADD COLUMN assigned_agent_profile_id uuid REFERENCES support_agent_profiles(id) ON DELETE RESTRICT,
      ADD COLUMN priority varchar(8) NOT NULL DEFAULT 'NORMAL',
      ADD COLUMN waiting_on varchar(8), ADD COLUMN version integer NOT NULL DEFAULT 1,
      ADD COLUMN resolution_code varchar(32), ADD COLUMN resolution_summary text, ADD COLUMN closure_summary text,
      ADD COLUMN closed_at timestamptz, ADD COLUMN first_response_at timestamptz,
      ADD COLUMN last_activity_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN last_customer_message_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN last_public_reply_at timestamptz,
      ADD COLUMN last_customer_message_version integer NOT NULL DEFAULT 1,
      ADD COLUMN last_public_reply_version integer`);
    await runner.query(
      `UPDATE support_requests SET last_activity_at = updated_at, last_customer_message_at = created_at`,
    );
    await runner.query(`CREATE TABLE support_request_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), support_request_id uuid NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
      request_version integer NOT NULL CHECK (request_version > 0), type varchar(32) NOT NULL,
      visibility varchar(8) NOT NULL CHECK (visibility IN ('PUBLIC','INTERNAL')), body text,
      actor_type varchar(8) NOT NULL, actor_customer_profile_id uuid,
      actor_support_agent_profile_id uuid REFERENCES support_agent_profiles(id) ON DELETE RESTRICT,
      changes jsonb, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT UQ_support_event_version UNIQUE (support_request_id, request_version),
      CONSTRAINT CK_support_event_visibility CHECK ((visibility = 'PUBLIC' AND type IN ('CREATED','PUBLIC_REPLY','CUSTOMER_REPLY','RESOLVED','CLOSED','REOPENED')) OR (visibility = 'INTERNAL' AND type IN ('IMPORTED','CLAIMED','ASSIGNED','RELEASED','INTERNAL_NOTE','PRIORITY_CHANGED','WAITING_CHANGED'))),
      CONSTRAINT CK_support_event_body CHECK (body IS NULL OR char_length(body) <= 4000),
      CONSTRAINT CK_support_event_actor CHECK (
        (actor_type = 'CUSTOMER' AND actor_customer_profile_id IS NOT NULL AND actor_support_agent_profile_id IS NULL) OR
        (actor_type = 'SUPPORT' AND actor_customer_profile_id IS NULL AND actor_support_agent_profile_id IS NOT NULL) OR
        (actor_type = 'SYSTEM' AND actor_customer_profile_id IS NULL AND actor_support_agent_profile_id IS NULL)),
      CONSTRAINT CK_support_event_type CHECK (type IN ('CREATED','IMPORTED','CLAIMED','ASSIGNED','RELEASED','INTERNAL_NOTE','PUBLIC_REPLY','CUSTOMER_REPLY','PRIORITY_CHANGED','WAITING_CHANGED','RESOLVED','CLOSED','REOPENED')))`);
    // The parent's existing customer cascade deletes its ledger. A second FK on
    // the event actor could make account deletion depend on constraint order.
    const rows: Array<{ id: string; status: string }> = await runner.query(
      `SELECT id, status FROM support_requests`,
    );
    for (const row of rows)
      await runner.query(
        `INSERT INTO support_request_events (support_request_id,request_version,type,visibility,actor_type,changes)
        VALUES ($1,1,'IMPORTED','INTERNAL','SYSTEM',$2)`,
        [
          row.id,
          JSON.stringify({
            previousStatus: row.status,
            legacyResolutionUnknown: ['RESOLVED', 'CLOSED'].includes(
              row.status,
            ),
          }),
        ],
      );
    await runner.query(
      `UPDATE support_requests SET status = 'OPEN' WHERE status = 'IN_PROGRESS'`,
    );
    await runner.query(`ALTER TABLE support_requests
      ADD CONSTRAINT CK_support_priority CHECK (priority IN ('NORMAL','HIGH')),
      ADD CONSTRAINT CK_support_wait CHECK (waiting_on IS NULL OR (status = 'IN_PROGRESS' AND waiting_on IN ('CUSTOMER','CENTER','INTERNAL'))),
      ADD CONSTRAINT CK_support_version CHECK (version > 0 AND last_customer_message_version > 0 AND last_customer_message_version <= version AND (last_public_reply_version IS NULL OR (last_public_reply_version > 0 AND last_public_reply_version <= version))),
      ADD CONSTRAINT CK_support_assignment CHECK ((status = 'OPEN' AND assigned_agent_profile_id IS NULL) OR (status = 'IN_PROGRESS' AND assigned_agent_profile_id IS NOT NULL) OR status IN ('RESOLVED','CLOSED'))`);
    await runner.query(
      `CREATE INDEX IDX_support_queue ON support_requests (status,priority,created_at,id)`,
    );
    await runner.query(
      `CREATE INDEX IDX_support_assignee ON support_requests (assigned_agent_profile_id,status,created_at,id)`,
    );
    await runner.query(
      `CREATE INDEX IDX_support_owner_history ON support_requests (customer_profile_id,created_at,id)`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE support_request_events`);
    await runner.query(`DROP INDEX IDX_support_queue`);
    await runner.query(`DROP INDEX IDX_support_assignee`);
    await runner.query(`DROP INDEX IDX_support_owner_history`);
    await runner.query(
      `ALTER TABLE support_requests DROP CONSTRAINT CK_support_priority, DROP CONSTRAINT CK_support_wait, DROP CONSTRAINT CK_support_version, DROP CONSTRAINT CK_support_assignment`,
    );
    for (const column of [
      'assigned_agent_profile_id',
      'priority',
      'waiting_on',
      'version',
      'resolution_code',
      'resolution_summary',
      'closure_summary',
      'closed_at',
      'first_response_at',
      'last_activity_at',
      'last_customer_message_at',
      'last_public_reply_at',
      'last_customer_message_version',
      'last_public_reply_version',
    ])
      await runner.query(`ALTER TABLE support_requests DROP COLUMN ${column}`);
    await runner.query(`DROP TABLE support_agent_profiles`);
  }
}
