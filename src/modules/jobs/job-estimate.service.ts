import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { JobEventType } from '../../common/enums/job-event-type.enum';
import { JobStatus } from '../../common/enums/job-status.enum';
import {
  DecisionChannel,
  JobApprovalStatus,
  JobLineStatus,
  PartType,
} from '../../common/enums/job-work.enum';
import { fromPaise, lineAmount, toPaise } from '../../common/money';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { EventsService } from '../events/events.service';
import {
  CreateLineItemDto,
  DecideApprovalDto,
  OverrideApprovalDto,
  RequestApprovalDto,
} from './dto/job-work.dto';
import { JobApproval } from './entities/job-approval.entity';
import { JobLineItem } from './entities/job-line-item.entity';
import { ServiceJob } from './entities/service-job.entity';
import { JobStoreService } from './job-store.service';
import { CustomerJobView, LineItemView, toLineItemView } from './job-view';
import { lockVisitDecisionAccess } from './visit-access';
import {
  CommandMeta,
  withCommandReceipt,
} from '../idempotency/transactional-receipt';

/** Agreed scope can change only before work starts. */
const SCOPE_EDITABLE = [JobStatus.CHECKED_IN, JobStatus.INSPECTION];
const CAN_REQUEST = [JobStatus.INSPECTION, JobStatus.IN_PROGRESS];
const NON_OEM = new Set<string>([PartType.OES, PartType.LOCAL]);

interface Decider {
  customerProfileId?: string;
  staffProfileId?: string;
  channel: DecisionChannel;
  contactPhone?: string;
}

@Injectable()
export class JobEstimateService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(JobLineItem)
    private readonly lineRepository: Repository<JobLineItem>,
    @InjectRepository(JobApproval)
    private readonly approvalRepository: Repository<JobApproval>,
    private readonly store: JobStoreService,
    private readonly eventsService: EventsService,
  ) {}

  async listLines(auth: AuthContext, jobId: string): Promise<LineItemView[]> {
    await this.store.get(auth.serviceCenterId!, jobId);
    const lines = await this.lineRepository.find({
      where: { jobId, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
    return lines.map(toLineItemView);
  }

  /** Adds work the owner already agreed to at the counter. */
  async addIncludedLine(
    auth: AuthContext,
    jobId: string,
    dto: CreateLineItemDto,
    expectedVersion?: number,
  ): Promise<LineItemView> {
    const centerId = auth.serviceCenterId!;
    const job = await this.store.get(centerId, jobId, { expectedVersion });
    this.store.assertStatus(job, SCOPE_EDITABLE, 'change the agreed scope');

    const line = await this.dataSource.transaction(async (manager) => {
      const lines = manager.getRepository(JobLineItem);
      const saved = await lines.save(
        this.buildLine(lines, job, dto, JobLineStatus.INCLUDED, auth),
      );
      await this.store.commit(job, {}, manager);
      await this.lineEvent(auth, job, manager, {
        action: 'ADDED',
        lineItemId: saved.id,
        description: saved.description,
        amountInr: saved.amountInr,
      });
      return saved;
    });
    return toLineItemView(line);
  }

  async removeIncludedLine(
    auth: AuthContext,
    jobId: string,
    lineId: string,
    expectedVersion?: number,
  ): Promise<void> {
    const centerId = auth.serviceCenterId!;
    const job = await this.store.get(centerId, jobId, { expectedVersion });
    this.store.assertStatus(job, SCOPE_EDITABLE, 'change the agreed scope');
    const line = await this.lineRepository.findOne({
      where: { id: lineId, jobId, deletedAt: IsNull() },
    });
    if (!line) {
      throw new NotFoundException();
    }
    if (line.status !== JobLineStatus.INCLUDED) {
      throw new ConflictException(
        'Lines under an approval request change through the request',
      );
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(JobLineItem).softDelete({ id: line.id });
      await this.store.commit(job, {}, manager);
      await this.lineEvent(auth, job, manager, {
        action: 'REMOVED',
        lineItemId: line.id,
        description: line.description,
        amountInr: line.amountInr,
      });
    });
  }

  /** Sends extra work to the owner and parks the job until they answer. */
  async requestApproval(
    auth: AuthContext,
    jobId: string,
    dto: RequestApprovalDto,
    expectedVersion?: number,
  ): Promise<JobApproval> {
    const centerId = auth.serviceCenterId!;
    const job = await this.store.get(centerId, jobId, { expectedVersion });
    this.store.assertStatus(job, CAN_REQUEST, 'request approval');
    const fromStatus = job.status;

    return this.dataSource.transaction(async (manager) => {
      const approvals = manager.getRepository(JobApproval);
      const lines = manager.getRepository(JobLineItem);
      const latest = await approvals.findOne({
        where: { jobId },
        order: { version: 'DESC' },
      });
      const version = (latest?.version ?? 0) + 1;
      const built = dto.items.map((item) =>
        this.buildLine(lines, job, item, JobLineStatus.PENDING, auth),
      );
      const total = built.reduce(
        (sum, line) => sum + toPaise(line.amountInr),
        0,
      );

      const approval = await approvals.save(
        approvals.create({
          jobId,
          serviceCenterId: centerId,
          version,
          status: JobApprovalStatus.PENDING,
          note: dto.note?.trim() || null,
          totalInr: fromPaise(total),
          returnStatus: fromStatus,
          requestedByStaffProfileId: auth.staffProfileId,
          requestedAt: new Date(),
        }),
      );
      for (const line of built) line.approvalId = approval.id;
      approval.lineItems = await lines.save(built);

      await this.store.commit(
        job,
        { status: JobStatus.AWAITING_APPROVAL },
        manager,
      );
      await this.eventsService.append(
        {
          jobId,
          serviceCenterId: centerId,
          type: JobEventType.APPROVAL_REQUESTED,
          payload: {
            approvalId: approval.id,
            version,
            totalInr: approval.totalInr,
            itemCount: built.length,
          },
          staffProfileId: auth.staffProfileId,
        },
        manager,
      );
      await this.eventsService.append(
        {
          jobId,
          serviceCenterId: centerId,
          type: JobEventType.STATUS_CHANGE,
          fromStatus,
          toStatus: JobStatus.AWAITING_APPROVAL,
          staffProfileId: auth.staffProfileId,
        },
        manager,
      );
      return approval;
    });
  }

  /** Records a decision the owner gave by phone or in person. */
  async override(
    auth: AuthContext,
    jobId: string,
    approvalId: string,
    dto: OverrideApprovalDto,
  ): Promise<void> {
    const job = await this.store.get(auth.serviceCenterId!, jobId);
    await this.decide(job, approvalId, dto, {
      staffProfileId: auth.staffProfileId!,
      channel: dto.channel,
      contactPhone: dto.contactPhone,
    });
  }

  /** Reauthorize both new decisions and receipt recovery within the transaction. */
  async decideAsCustomer(
    job: ServiceJob,
    approvalId: string,
    customerProfileId: string,
    dto: DecideApprovalDto,
    meta?: CommandMeta,
    actorId?: string,
    project?: (manager: EntityManager) => Promise<CustomerJobView>,
  ): Promise<CustomerJobView> {
    if (!project) throw new Error('Customer decision projection is required');
    return this.dataSource.transaction(async (manager) => {
      const authorize = async () => {
        await lockVisitDecisionAccess(manager, job.id, customerProfileId);
        if (
          !(await manager.getRepository(ServiceJob).findOneBy({ id: job.id }))
        )
          throw new NotFoundException();
      };
      await withCommandReceipt(
        manager,
        `customer:${actorId ?? customerProfileId}`,
        meta ?? { hash: '', status: 200 },
        async () => {
          await authorize();
          await this.decide(
            job,
            approvalId,
            dto,
            {
              customerProfileId,
              channel: DecisionChannel.APP,
            },
            manager,
          );
          return { id: job.id, approvalId };
        },
        async (receipt) => {
          await authorize();
          if (receipt.id !== job.id) throw new NotFoundException();
        },
      );
      // Materialize the authorized response while profile/grant locks are held.
      // A revocation immediately after commit cannot turn success into 404.
      return project(manager);
    });
  }

  async withdraw(
    auth: AuthContext,
    jobId: string,
    approvalId: string,
  ): Promise<void> {
    const centerId = auth.serviceCenterId!;
    const job = await this.store.get(centerId, jobId);
    await this.dataSource.transaction(async (manager) => {
      const approval = await this.claimPending(manager, job, approvalId, {
        status: JobApprovalStatus.WITHDRAWN,
        decidedAt: new Date(),
        decidedByStaffProfileId: auth.staffProfileId,
      });
      await manager
        .getRepository(JobLineItem)
        .update(
          { approvalId: approval.id, status: JobLineStatus.PENDING },
          { status: JobLineStatus.DECLINED },
        );
      await this.store.commit(job, { status: approval.returnStatus }, manager);
      await this.eventsService.append(
        {
          jobId,
          serviceCenterId: centerId,
          type: JobEventType.APPROVAL_RESOLVED,
          payload: { approvalId, status: JobApprovalStatus.WITHDRAWN },
          visibleToCustomer: true,
          staffProfileId: auth.staffProfileId,
        },
        manager,
      );
      await this.eventsService.append(
        {
          jobId,
          serviceCenterId: centerId,
          type: JobEventType.STATUS_CHANGE,
          fromStatus: JobStatus.AWAITING_APPROVAL,
          toStatus: approval.returnStatus,
          payload: { note: 'Approval request withdrawn' },
          staffProfileId: auth.staffProfileId,
        },
        manager,
      );
    });
  }

  private async decide(
    job: ServiceJob,
    approvalId: string,
    dto: DecideApprovalDto,
    decider: Decider,
    transaction?: EntityManager,
  ): Promise<void> {
    if ((dto.approved === undefined) === (dto.decisions === undefined)) {
      throw new BadRequestException(
        'Send either approved for the whole request or decisions per line',
      );
    }
    const pending = await this.lineRepository.find({
      where: {
        approvalId,
        jobId: job.id,
        status: JobLineStatus.PENDING,
        deletedAt: IsNull(),
      },
    });
    const verdicts = new Map<string, boolean>();
    if (dto.decisions) {
      for (const decision of dto.decisions) {
        verdicts.set(decision.lineItemId, decision.approved);
      }
      const unknown = [...verdicts.keys()].filter(
        (id) => !pending.some((line) => line.id === id),
      );
      if (unknown.length || verdicts.size !== pending.length) {
        throw new UnprocessableEntityException(
          'Decide every line in this request exactly once',
        );
      }
    } else {
      for (const line of pending) verdicts.set(line.id, dto.approved!);
    }

    const approvedLines = pending.filter((line) => verdicts.get(line.id));
    const needsAck = approvedLines.some(
      (line) => line.partType && NON_OEM.has(line.partType),
    );
    if (needsAck && !dto.acknowledgeNonOemParts) {
      throw new UnprocessableEntityException(
        'Approving OES or local parts needs acknowledgeNonOemParts: true',
      );
    }
    const status =
      approvedLines.length === pending.length
        ? JobApprovalStatus.APPROVED
        : approvedLines.length === 0
          ? JobApprovalStatus.DECLINED
          : JobApprovalStatus.PARTIALLY_APPROVED;
    const now = new Date();

    const apply = async (manager: EntityManager) => {
      const approval = await this.claimPending(manager, job, approvalId, {
        status,
        decidedAt: now,
        decidedByCustomerProfileId: decider.customerProfileId ?? null,
        decidedByStaffProfileId: decider.staffProfileId ?? null,
        decisionChannel: decider.channel,
        decisionNote: dto.note?.trim() || null,
        decisionContactPhone: decider.contactPhone ?? null,
        nonOemAcknowledgedAt: needsAck ? now : null,
      });
      const lines = manager.getRepository(JobLineItem);
      const approvedIds = approvedLines.map((line) => line.id);
      const declinedIds = pending
        .filter((line) => !verdicts.get(line.id))
        .map((line) => line.id);
      if (approvedIds.length) {
        await lines.update(
          { id: In(approvedIds) },
          { status: JobLineStatus.APPROVED },
        );
      }
      if (declinedIds.length) {
        await lines.update(
          { id: In(declinedIds) },
          { status: JobLineStatus.DECLINED },
        );
      }

      await this.store.commit(job, { status: JobStatus.IN_PROGRESS }, manager);
      const approvedTotal = approvedLines.reduce(
        (sum, line) => sum + toPaise(line.amountInr),
        0,
      );
      await this.eventsService.append(
        {
          jobId: job.id,
          serviceCenterId: job.serviceCenterId,
          type: JobEventType.APPROVAL_RESOLVED,
          payload: {
            approvalId: approval.id,
            version: approval.version,
            status,
            approvedInr: fromPaise(approvedTotal),
            approvedCount: approvedIds.length,
            declinedCount: declinedIds.length,
            channel: decider.channel,
            by: decider.customerProfileId ? 'CUSTOMER' : 'STAFF',
          },
          staffProfileId: decider.staffProfileId ?? null,
        },
        manager,
      );
      await this.eventsService.append(
        {
          jobId: job.id,
          serviceCenterId: job.serviceCenterId,
          type: JobEventType.STATUS_CHANGE,
          fromStatus: JobStatus.AWAITING_APPROVAL,
          toStatus: JobStatus.IN_PROGRESS,
          staffProfileId: decider.staffProfileId ?? null,
        },
        manager,
      );
      if (decider.staffProfileId) {
        await this.eventsService.writeAuditLog(
          {
            serviceCenterId: job.serviceCenterId,
            entityType: 'JobApproval',
            entityId: approval.id,
            action: 'VERBAL_OVERRIDE',
            actorStaffProfileId: decider.staffProfileId,
            metadata: {
              channel: decider.channel,
              contactPhone: decider.contactPhone ?? null,
              note: dto.note,
            },
            before: { status: JobApprovalStatus.PENDING },
            after: { status },
          },
          manager,
        );
      }
    };
    if (transaction) await apply(transaction);
    else await this.dataSource.transaction(apply);
  }

  /**
   * Moves a pending request to its outcome with a conditional update, so two
   * deciders racing each other cannot both win.
   */
  private async claimPending(
    manager: EntityManager,
    job: ServiceJob,
    approvalId: string,
    changes: QueryDeepPartialEntity<JobApproval>,
  ): Promise<JobApproval> {
    const approvals = manager.getRepository(JobApproval);
    const approval = await approvals.findOne({
      where: { id: approvalId, jobId: job.id },
    });
    if (!approval) {
      throw new NotFoundException();
    }
    const result = await approvals.update(
      { id: approvalId, status: JobApprovalStatus.PENDING },
      changes,
    );
    if (!result.affected) {
      throw new ConflictException(`This request is already ${approval.status}`);
    }
    if (job.status !== JobStatus.AWAITING_APPROVAL) {
      throw new ConflictException(
        `The job is ${job.status}, so this request cannot be decided`,
      );
    }
    return Object.assign(approval, changes);
  }

  private buildLine(
    repository: Repository<JobLineItem>,
    job: ServiceJob,
    dto: CreateLineItemDto,
    status: JobLineStatus,
    auth: AuthContext,
  ): JobLineItem {
    const quantity = dto.quantity ?? 1;
    return repository.create({
      jobId: job.id,
      serviceCenterId: job.serviceCenterId,
      kind: dto.kind,
      description: dto.description.trim(),
      partType: dto.partType ?? null,
      quantity: String(quantity),
      unitPriceInr: String(dto.unitPriceInr),
      amountInr: lineAmount(quantity, dto.unitPriceInr),
      status,
      createdByStaffProfileId: auth.staffProfileId,
    });
  }

  private lineEvent(
    auth: AuthContext,
    job: ServiceJob,
    manager: EntityManager,
    payload: Record<string, unknown>,
  ) {
    return this.eventsService.append(
      {
        jobId: job.id,
        serviceCenterId: job.serviceCenterId,
        type: JobEventType.LINE_ITEMS_CHANGED,
        payload,
        staffProfileId: auth.staffProfileId,
      },
      manager,
    );
  }
}
