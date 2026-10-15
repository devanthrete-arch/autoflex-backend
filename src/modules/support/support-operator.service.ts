import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, In, LessThan } from 'typeorm';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { Booking } from '../bookings/entities/booking.entity';
import { ServiceJob } from '../jobs/entities/service-job.entity';
import { JobCustomerAccess } from '../jobs/entities/job-customer-access.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { SupportAgentProfile } from '../support-identity/support-agent-profile.entity';
import {
  SupportHistoryQueryDto,
  SupportQueueQueryDto,
} from './dto/support-workflow.dto';
import { SupportContextService } from './support-context.service';
import { SupportRequestEvent } from './support-request-event.entity';
import { SupportRequest } from './support-request.entity';
import { isSupportManager } from './support-policy';
import { needsReply } from './support-view';
const replyExpression =
  "r.status IN ('OPEN', 'IN_PROGRESS') AND (r.last_public_reply_version IS NULL OR r.last_customer_message_version > r.last_public_reply_version)";
const priorityExpression = "CASE WHEN r.priority = 'HIGH' THEN 0 ELSE 1 END";
const agentView = (row: SupportAgentProfile) => ({
  id: row.id,
  displayName: row.displayName,
  isActive: row.isActive,
});

@Injectable()
export class SupportOperatorService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: SupportContextService,
  ) {}
  async me(auth: AuthContext) {
    const agent = await this.dataSource
      .getRepository(SupportAgentProfile)
      .findOneByOrFail({
        id: auth.supportAgentProfileId!,
        iamDomainId: auth.domainId,
        isActive: true,
      });
    return {
      ...agentView(agent),
      roles: auth.roles.filter((role) =>
        ['support_agent', 'support_manager'].includes(role),
      ),
      permissions: auth.permissions.filter((permission) =>
        ['support:read', 'support:work', 'support:manage'].includes(permission),
      ),
    };
  }
  async roster(auth: AuthContext, includeInactive = false) {
    if (includeInactive && !isSupportManager(auth))
      throw new ForbiddenException(
        'Only support managers can inspect inactive operators',
      );
    const rows = await this.dataSource.getRepository(SupportAgentProfile).find({
      where: {
        iamDomainId: auth.domainId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      order: { displayName: 'ASC', id: 'ASC' },
    });
    return rows.map(agentView);
  }
  private base(query: SupportQueueQueryDto) {
    const qb = this.dataSource
      .getRepository(SupportRequest)
      .createQueryBuilder('r')
      .leftJoin(
        CustomerProfile,
        'customer',
        'customer.id = r.customer_profile_id',
      )
      .leftJoin(
        SupportAgentProfile,
        'agent',
        'agent.id = r.assigned_agent_profile_id',
      );
    if (query.category)
      qb.andWhere('r.category = :category', { category: query.category });
    if (query.priority)
      qb.andWhere('r.priority = :priority', { priority: query.priority });
    if (query.q) {
      qb.leftJoin(
        Booking,
        'booking',
        'booking.id = r.booking_id AND booking.customer_profile_id = r.customer_profile_id',
      )
        .leftJoin(ServiceJob, 'job', 'job.id = r.job_id')
        .leftJoin(
          JobCustomerAccess,
          'visit_access',
          'visit_access.job_id = job.id AND visit_access.customer_profile_id = r.customer_profile_id AND visit_access.can_view = true AND visit_access.revoked_at IS NULL AND customer.deleted_at IS NULL',
        );
      const text = `%${query.q.replace(/[\\%_]/g, (value) => `\\${value}`)}%`;
      qb.andWhere(
        '(r.reference_number ILIKE :text OR r.subject ILIKE :text OR customer.display_name ILIKE :text OR customer.phone ILIKE :text OR booking.booking_number ILIKE :text OR (visit_access.id IS NOT NULL AND job.job_number ILIKE :text))',
        { text },
      );
    }
    return qb;
  }
  private filtered(auth: AuthContext, query: SupportQueueQueryDto) {
    const qb = this.base(query);
    const status = query.status ?? 'ACTIVE';
    if (status === 'ACTIVE') qb.andWhere("r.status IN ('OPEN','IN_PROGRESS')");
    else if (status !== 'ALL') qb.andWhere('r.status = :status', { status });
    if (query.assignee === 'me')
      qb.andWhere('r.assigned_agent_profile_id = :me', {
        me: auth.supportAgentProfileId,
      });
    else if (query.assignee === 'unassigned')
      qb.andWhere('r.assigned_agent_profile_id IS NULL');
    else if (query.assignee === 'inactive')
      qb.andWhere('agent.is_active = false');
    else if (query.assignee && query.assignee !== 'all')
      qb.andWhere('r.assigned_agent_profile_id = :assignee', {
        assignee: query.assignee,
      });
    if (query.waitingOn === 'NONE') qb.andWhere('r.waiting_on IS NULL');
    else if (query.waitingOn)
      qb.andWhere('r.waiting_on = :waitingOn', { waitingOn: query.waitingOn });
    if (query.needsReply)
      qb.andWhere(
        query.needsReply === 'true'
          ? `(${replyExpression})`
          : `NOT (${replyExpression})`,
      );
    return qb;
  }
  async summary(auth: AuthContext, query: SupportQueueQueryDto) {
    const base = this.base(query);
    const [
      active,
      unassigned,
      mine,
      needsReplyCount,
      resolved,
      closed,
      inactiveAssignee,
    ] = await Promise.all([
      base.clone().andWhere("r.status IN ('OPEN','IN_PROGRESS')").getCount(),
      base
        .clone()
        .andWhere(
          "r.status IN ('OPEN','IN_PROGRESS') AND r.assigned_agent_profile_id IS NULL",
        )
        .getCount(),
      base
        .clone()
        .andWhere(
          "r.status IN ('OPEN','IN_PROGRESS') AND r.assigned_agent_profile_id = :me",
          { me: auth.supportAgentProfileId },
        )
        .getCount(),
      base.clone().andWhere(replyExpression).getCount(),
      base.clone().andWhere("r.status = 'RESOLVED'").getCount(),
      base.clone().andWhere("r.status = 'CLOSED'").getCount(),
      base
        .clone()
        .andWhere(
          "r.status IN ('OPEN','IN_PROGRESS') AND agent.is_active = false",
        )
        .getCount(),
    ]);
    return {
      active,
      unassigned,
      mine,
      needsReply: needsReplyCount,
      resolved,
      closed,
      inactiveAssignee,
    };
  }
  async list(auth: AuthContext, query: SupportQueueQueryDto) {
    const normalized = {
      status: query.status ?? 'ACTIVE',
      assignee: query.assignee ?? 'all',
      category: query.category ?? null,
      priority: query.priority ?? null,
      waitingOn: query.waitingOn ?? null,
      needsReply: query.needsReply ?? null,
      q: query.q ?? '',
      sort: query.sort ?? 'oldest',
      limit: query.limit ?? 50,
      agent: auth.supportAgentProfileId,
    };
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');
    const qb = this.filtered(auth, query);
    const recent = normalized.sort === 'recentActivity';
    if (query.cursor) {
      let cursor: {
        fingerprint: string;
        id: string;
        date: string;
        priority: number;
      };
      try {
        cursor = JSON.parse(
          Buffer.from(query.cursor, 'base64url').toString('utf8'),
        ) as typeof cursor;
        if (
          cursor.fingerprint !== fingerprint ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            cursor.id,
          ) ||
          typeof cursor.date !== 'string' ||
          cursor.date.length > 64 ||
          !Number.isFinite(Date.parse(cursor.date)) ||
          ![0, 1].includes(cursor.priority)
        )
          throw new Error();
      } catch {
        throw new BadRequestException(
          'This cursor is invalid for the selected filters',
        );
      }
      if (recent)
        qb.andWhere(
          '(r.last_activity_at < :date OR (r.last_activity_at = :date AND r.id < :id))',
          { date: cursor.date, id: cursor.id },
        );
      else
        qb.andWhere(
          `(${priorityExpression} > :rank OR (${priorityExpression} = :rank AND (r.created_at > :date OR (r.created_at = :date AND r.id > :id))))`,
          { rank: cursor.priority, date: cursor.date, id: cursor.id },
        );
    }
    if (recent)
      qb.orderBy('r.last_activity_at', 'DESC').addOrderBy('r.id', 'DESC');
    else
      qb.orderBy(priorityExpression, 'ASC')
        .addOrderBy('r.created_at', 'ASC')
        .addOrderBy('r.id', 'ASC');
    // Preserve PostgreSQL microseconds in the cursor; JavaScript Date rounds to
    // milliseconds and would repeat/skip rows around the page boundary.
    const { entities: rows, raw } = await qb
      .addSelect(
        recent
          ? `to_char(r.last_activity_at, 'YYYY-MM-DD"T"HH24:MI:SS.USTZH:TZM')`
          : `to_char(r.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.USTZH:TZM')`,
        'cursor_date',
      )
      .limit(normalized.limit + 1)
      .getRawAndEntities<{ cursor_date: string }>();
    const page = rows.slice(0, normalized.limit);
    const last = page[page.length - 1];
    const customerIds = [...new Set(page.map((row) => row.customerProfileId))];
    const agentIds = [
      ...new Set(
        page
          .map((row) => row.assignedAgentProfileId)
          .filter((id): id is string => !!id),
      ),
    ];
    const [customers, agents] = await Promise.all([
      customerIds.length
        ? this.dataSource
            .getRepository(CustomerProfile)
            .findBy({ id: In(customerIds) })
        : Promise.resolve<CustomerProfile[]>([]),
      agentIds.length
        ? this.dataSource
            .getRepository(SupportAgentProfile)
            .findBy({ id: In(agentIds) })
        : Promise.resolve<SupportAgentProfile[]>([]),
    ]);
    const items = page.map((row) =>
      this.present(
        row,
        customers.find((customer) => customer.id === row.customerProfileId) ??
          null,
        agents.find((agent) => agent.id === row.assignedAgentProfileId) ?? null,
      ),
    );
    return {
      items,
      nextCursor:
        rows.length > normalized.limit && last
          ? Buffer.from(
              JSON.stringify({
                fingerprint,
                id: last.id,
                date: String(raw[normalized.limit - 1].cursor_date),
                priority: last.priority === 'HIGH' ? 0 : 1,
              }),
            ).toString('base64url')
          : null,
    };
  }
  private async view(row: SupportRequest) {
    const customer = await this.dataSource
      .getRepository(CustomerProfile)
      .findOneBy({ id: row.customerProfileId });
    const assignee = row.assignedAgentProfileId
      ? await this.dataSource
          .getRepository(SupportAgentProfile)
          .findOneBy({ id: row.assignedAgentProfileId })
      : null;
    return this.present(row, customer, assignee);
  }
  private present(
    row: SupportRequest,
    customer: CustomerProfile | null,
    assignee: SupportAgentProfile | null,
  ) {
    return {
      id: row.id,
      referenceNumber: row.referenceNumber,
      category: row.category,
      subject: row.subject,
      status: row.status,
      priority: row.priority,
      waitingOn: row.waitingOn,
      version: row.version,
      needsReply: needsReply(row),
      customer: customer
        ? { displayName: customer.displayName, phone: customer.phone }
        : null,
      assignee: assignee ? agentView(assignee) : null,
      createdAt: row.createdAt,
      lastActivityAt: row.lastActivityAt,
      firstResponseAt: row.firstResponseAt,
      lastCustomerMessageAt: row.lastCustomerMessageAt,
      lastPublicReplyAt: row.lastPublicReplyAt,
    };
  }
  async get(id: string) {
    const row = await this.dataSource
      .getRepository(SupportRequest)
      .findOneBy({ id });
    if (!row) throw new NotFoundException();
    const customer = await this.dataSource
      .getRepository(CustomerProfile)
      .findOneBy({ id: row.customerProfileId });
    const imported = await this.dataSource
      .getRepository(SupportRequestEvent)
      .findOneBy({ supportRequestId: id, type: 'IMPORTED' });
    return {
      ...(await this.view(row)),
      message: row.message,
      preferredChannel: row.preferredChannel,
      resolutionCode: row.resolutionCode,
      resolutionSummary: row.resolutionSummary,
      closureSummary: row.closureSummary,
      resolvedAt: row.resolvedAt,
      closedAt: row.closedAt,
      legacyResolutionUnknown:
        !!imported?.changes?.legacyResolutionUnknown && !row.resolutionSummary,
      customer: customer
        ? {
            displayName: customer.displayName,
            phone: customer.phone,
            email: customer.email,
            preferredChannel: customer.preferredChannel,
            whatsappConsent: customer.whatsappConsent,
            emailConsent: customer.emailConsent,
          }
        : null,
      linkedContext: await this.context.summary(row),
    };
  }
  async events(auth: AuthContext, id: string, query: SupportHistoryQueryDto) {
    if (!(await this.dataSource.getRepository(SupportRequest).existsBy({ id })))
      throw new NotFoundException();
    const limit = query.limit ?? 50;
    const rows = await this.dataSource.getRepository(SupportRequestEvent).find({
      where: {
        supportRequestId: id,
        ...(query.beforeVersion
          ? { requestVersion: LessThan(query.beforeVersion) }
          : {}),
      },
      order: { requestVersion: 'DESC' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const ids = page
      .map((row) => row.actorSupportAgentProfileId)
      .filter((id): id is string => !!id);
    const agents = ids.length
      ? await this.dataSource
          .getRepository(SupportAgentProfile)
          .findBy({ id: In(ids), iamDomainId: auth.domainId })
      : [];
    return {
      items: page.reverse().map((event) => ({
        id: event.id,
        version: event.requestVersion,
        type: event.type,
        visibility: event.visibility,
        body: event.body,
        author:
          event.actorType === 'CUSTOMER'
            ? 'Customer'
            : event.actorType === 'SYSTEM'
              ? 'System'
              : (agents.find(
                  (agent) => agent.id === event.actorSupportAgentProfileId,
                )?.displayName ?? 'Autoflex Support'),
        changes: event.changes,
        createdAt: event.createdAt,
      })),
      nextBeforeVersion:
        rows.length > limit ? rows[limit - 1].requestVersion : null,
    };
  }
}
