import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JobEventType } from '../../common/enums/job-event-type.enum';
import { JobStatus } from '../../common/enums/job-status.enum';
import {
  JobApprovalStatus,
  JobLineStatus,
} from '../../common/enums/job-work.enum';
import { SkippableStep } from '../../common/enums/ownership.enum';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { EventsService } from '../events/events.service';
import {
  AddJobNoteDto,
  CancelJobDto,
  HoldJobDto,
  RecordInspectionDto,
  RecordQcDto,
  SkipStepDto,
} from './dto/job-work.dto';
import { JobApproval } from './entities/job-approval.entity';
import { ServiceJob } from './entities/service-job.entity';
import { JobStoreService } from './job-store.service';
import { JobsService } from './jobs.service';
import { JobDetailView, TimelineEntryView } from './job-view';

const HOLDABLE = [
  JobStatus.CHECKED_IN,
  JobStatus.INSPECTION,
  JobStatus.IN_PROGRESS,
  JobStatus.QUALITY_CHECK,
  JobStatus.READY_FOR_PICKUP,
];

const INSPECTABLE = [
  JobStatus.CHECKED_IN,
  JobStatus.INSPECTION,
  JobStatus.AWAITING_APPROVAL,
  JobStatus.IN_PROGRESS,
];

const SKIP_RULES: Record<
  SkippableStep,
  { from: JobStatus[]; to: JobStatus; event: JobEventType; label: string }
> = {
  [SkippableStep.INSPECTION]: {
    from: [JobStatus.CHECKED_IN, JobStatus.INSPECTION],
    to: JobStatus.IN_PROGRESS,
    event: JobEventType.INSPECTION_SKIPPED,
    label: 'Inspection',
  },
  [SkippableStep.QC]: {
    from: [JobStatus.IN_PROGRESS, JobStatus.QUALITY_CHECK],
    to: JobStatus.READY_FOR_PICKUP,
    event: JobEventType.QC_SKIPPED,
    label: 'Quality check',
  },
};

const SAFETY_CRITICAL = /\b(brakes?|abs|steering|suspension|tyres?|tires?)\b/i;

function isSafetyCritical(job: ServiceJob): boolean {
  const texts = [
    job.customerRequest ?? '',
    ...(job.lineItems ?? [])
      .filter(
        (line) => !line.deletedAt && line.status !== JobLineStatus.DECLINED,
      )
      .map((line) => line.description),
  ];
  return texts.some((text) => SAFETY_CRITICAL.test(text));
}

@Injectable()
export class JobWorkflowService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly store: JobStoreService,
    private readonly jobsService: JobsService,
    private readonly eventsService: EventsService,
  ) {}

  /** Pauses work; resume returns the job to the status it was paused in. */
  async hold(
    auth: AuthContext,
    jobId: string,
    dto: HoldJobDto,
    expectedVersion?: number,
  ): Promise<JobDetailView> {
    const centerId = auth.serviceCenterId!;
    const job = await this.store.get(centerId, jobId, { expectedVersion });
    this.store.assertStatus(job, HOLDABLE, 'put on hold');
    if (dto.expectedResumeAt && dto.expectedResumeAt.getTime() <= Date.now()) {
      throw new UnprocessableEntityException(
        'expectedResumeAt must be in the future',
      );
    }
    const fromStatus = job.status;
    await this.store.commit(job, {
      status: JobStatus.ON_HOLD,
      previousStatus: fromStatus,
      holdReason: dto.reason.trim(),
      expectedResumeAt: dto.expectedResumeAt ?? null,
    });
    await this.eventsService.append({
      jobId,
      serviceCenterId: centerId,
      type: JobEventType.STATUS_CHANGE,
      fromStatus,
      toStatus: JobStatus.ON_HOLD,
      payload: {
        reason: dto.reason.trim(),
        expectedResumeAt: dto.expectedResumeAt ?? null,
      },
      staffProfileId: auth.staffProfileId,
    });
    return this.jobsService.findOne(auth, jobId);
  }

  async resume(
    auth: AuthContext,
    jobId: string,
    expectedVersion?: number,
  ): Promise<JobDetailView> {
    const centerId = auth.serviceCenterId!;
    const job = await this.store.get(centerId, jobId, { expectedVersion });
    this.store.assertStatus(job, [JobStatus.ON_HOLD], 'resume');
    const toStatus = job.previousStatus ?? JobStatus.IN_PROGRESS;
    await this.store.commit(job, {
      status: toStatus,
      previousStatus: null,
      holdReason: null,
      expectedResumeAt: null,
    });
    await this.eventsService.appendStatusChange({
      jobId,
      serviceCenterId: centerId,
      fromStatus: JobStatus.ON_HOLD,
      toStatus,
      staffProfileId: auth.staffProfileId!,
      note: 'Work resumed',
    });
    return this.jobsService.findOne(auth, jobId);
  }

  /** Cancels the job and withdraws any request still waiting on the owner. */
  async cancel(
    auth: AuthContext,
    jobId: string,
    dto: CancelJobDto,
    expectedVersion?: number,
  ): Promise<JobDetailView> {
    const centerId = auth.serviceCenterId!;
    const job = await this.store.get(centerId, jobId, { expectedVersion });
    this.store.assertOpen(job);
    const fromStatus = job.status;
    const reason = dto.reason.trim();

    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(JobApproval)
        .update(
          { jobId, status: JobApprovalStatus.PENDING },
          { status: JobApprovalStatus.WITHDRAWN, decidedAt: new Date() },
        );
      await this.store.commit(
        job,
        {
          status: JobStatus.CANCELLED,
          cancellationReason: reason,
          closedAt: new Date(),
        },
        manager,
      );
      await this.eventsService.append(
        {
          jobId,
          serviceCenterId: centerId,
          type: JobEventType.STATUS_CHANGE,
          fromStatus,
          toStatus: JobStatus.CANCELLED,
          payload: { reason },
          staffProfileId: auth.staffProfileId,
        },
        manager,
      );
      await this.eventsService.writeAuditLog(
        {
          serviceCenterId: centerId,
          entityType: 'ServiceJob',
          entityId: jobId,
          action: 'CANCEL',
          actorStaffProfileId: auth.staffProfileId,
          before: { status: fromStatus },
          after: { status: JobStatus.CANCELLED, reason },
        },
        manager,
      );
    });
    return this.jobsService.findOne(auth, jobId);
  }

  /**
   * Saves the checklist. Saving on a just-checked-in job starts the
   * inspection.
   */
  async recordInspection(
    auth: AuthContext,
    jobId: string,
    dto: RecordInspectionDto,
    expectedVersion?: number,
  ): Promise<JobDetailView> {
    const centerId = auth.serviceCenterId!;
    const job = await this.store.get(centerId, jobId, { expectedVersion });
    this.store.assertStatus(job, INSPECTABLE, 'record the inspection');

    const keys = new Set<string>();
    const items: NonNullable<typeof job.inspection> = {};
    for (const item of dto.items) {
      if (keys.has(item.key)) {
        throw new UnprocessableEntityException(
          `Checklist item "${item.key}" appears twice`,
        );
      }
      keys.add(item.key);
      items[item.key] = {
        ok: item.ok,
        ...(item.label ? { label: item.label } : {}),
        ...(item.note ? { note: item.note } : {}),
      };
    }

    const fromStatus = job.status;
    const starts = fromStatus === JobStatus.CHECKED_IN;
    const completes = dto.complete === true && !job.inspectionCompletedAt;
    await this.store.commit(job, {
      inspection: items,
      ...(starts ? { status: JobStatus.INSPECTION } : {}),
      ...(completes ? { inspectionCompletedAt: new Date() } : {}),
    });

    if (starts) {
      await this.eventsService.appendStatusChange({
        jobId,
        serviceCenterId: centerId,
        fromStatus,
        toStatus: JobStatus.INSPECTION,
        staffProfileId: auth.staffProfileId!,
        note: 'Inspection started',
      });
    }
    const flagged = dto.items.filter((item) => !item.ok).length;
    await this.eventsService.append({
      jobId,
      serviceCenterId: centerId,
      type: JobEventType.INSPECTION_RECORDED,
      payload: {
        checked: dto.items.length,
        flagged,
        completed: Boolean(job.inspectionCompletedAt),
      },
      visibleToCustomer: completes,
      staffProfileId: auth.staffProfileId,
    });
    return this.jobsService.findOne(auth, jobId);
  }

  /** A pass releases the vehicle for pickup; a fail sends it back to work. */
  async recordQc(
    auth: AuthContext,
    jobId: string,
    dto: RecordQcDto,
    expectedVersion?: number,
  ): Promise<JobDetailView> {
    const centerId = auth.serviceCenterId!;
    const job = await this.store.get(centerId, jobId, { expectedVersion });
    this.store.assertStatus(
      job,
      [JobStatus.QUALITY_CHECK],
      'record a quality check',
    );
    const notes = dto.notes?.trim() || null;
    if (!dto.passed && !notes) {
      throw new UnprocessableEntityException(
        'Say what failed so the technician can fix it',
      );
    }
    const toStatus = dto.passed
      ? JobStatus.READY_FOR_PICKUP
      : JobStatus.IN_PROGRESS;
    await this.store.commit(job, {
      status: toStatus,
      qcNotes: notes,
      qcByStaffProfileId: auth.staffProfileId,
      qcPassedAt: dto.passed ? new Date() : null,
    });
    await this.eventsService.append({
      jobId,
      serviceCenterId: centerId,
      type: JobEventType.QC_RECORDED,
      payload: { passed: dto.passed, notes },
      visibleToCustomer: false,
      staffProfileId: auth.staffProfileId,
    });
    await this.eventsService.appendStatusChange({
      jobId,
      serviceCenterId: centerId,
      fromStatus: JobStatus.QUALITY_CHECK,
      toStatus,
      staffProfileId: auth.staffProfileId!,
      note: dto.passed ? 'Ready for pickup' : 'Sent back after quality check',
    });
    return this.jobsService.findOne(auth, jobId);
  }

  /**
   * Express path for quick jobs. Skipping inspection starts work; skipping
   * QC releases the vehicle. Either skip makes the close checklist required.
   */
  async skip(
    auth: AuthContext,
    jobId: string,
    dto: SkipStepDto,
    expectedVersion?: number,
  ): Promise<JobDetailView> {
    const centerId = auth.serviceCenterId!;
    const job = await this.store.get(centerId, jobId, {
      expectedVersion,
      relations: { serviceCenter: true, lineItems: true },
    });
    if (!job.serviceCenter.expressSkipEnabled) {
      throw new UnprocessableEntityException(
        'Express skip is turned off for this center',
      );
    }
    const rule = SKIP_RULES[dto.step];
    this.store.assertStatus(job, rule.from, `skip ${rule.label}`);
    if ((job.skippedSteps ?? []).includes(dto.step)) {
      throw new UnprocessableEntityException(
        `${rule.label} is already skipped`,
      );
    }
    if (dto.step === SkippableStep.INSPECTION && job.inspectionCompletedAt) {
      throw new UnprocessableEntityException('Inspection is already complete');
    }
    if (dto.step === SkippableStep.QC && isSafetyCritical(job)) {
      throw new UnprocessableEntityException(
        'Brake, steering and similar safety work always needs a quality check',
      );
    }

    const reason = dto.reason.trim();
    const fromStatus = job.status;
    await this.dataSource.transaction(async (manager) => {
      await this.store.commit(
        job,
        {
          status: rule.to,
          skippedSteps: [...(job.skippedSteps ?? []), dto.step],
        },
        manager,
      );
      await this.eventsService.append(
        {
          jobId,
          serviceCenterId: centerId,
          type: rule.event,
          payload: { reason },
          visibleToCustomer: false,
          staffProfileId: auth.staffProfileId,
        },
        manager,
      );
      await this.eventsService.appendStatusChange(
        {
          jobId,
          serviceCenterId: centerId,
          fromStatus,
          toStatus: rule.to,
          staffProfileId: auth.staffProfileId,
          note: `${rule.label} skipped`,
        },
        manager,
      );
      await this.eventsService.writeAuditLog(
        {
          serviceCenterId: centerId,
          entityType: 'ServiceJob',
          entityId: jobId,
          action: rule.event,
          actorStaffProfileId: auth.staffProfileId,
          before: { status: fromStatus },
          after: { status: rule.to, reason },
        },
        manager,
      );
    });
    return this.jobsService.findOne(auth, jobId);
  }

  async addNote(
    auth: AuthContext,
    jobId: string,
    dto: AddJobNoteDto,
  ): Promise<TimelineEntryView> {
    const centerId = auth.serviceCenterId!;
    const job = await this.store.get(centerId, jobId);
    const event = await this.eventsService.append({
      jobId: job.id,
      serviceCenterId: centerId,
      type: JobEventType.NOTE,
      payload: { message: dto.message.trim() },
      visibleToCustomer: dto.visibleToCustomer ?? false,
      staffProfileId: auth.staffProfileId,
    });
    return {
      id: event.id,
      type: event.type,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      payload: event.payload,
      visibleToCustomer: event.visibleToCustomer,
      createdAt: event.createdAt,
    };
  }
}
