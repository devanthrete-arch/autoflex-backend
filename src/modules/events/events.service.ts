import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { JobEventType } from '../../common/enums/job-event-type.enum';
import { JobStatus } from '../../common/enums/job-status.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLog } from './entities/audit-log.entity';
import { ServiceJobEvent } from './entities/service-job-event.entity';

/**
 * The job timeline and the audit trail. Every timeline entry passes through
 * `append`, which also hands customer-visible entries to notifications.
 */
@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(ServiceJobEvent)
    private readonly eventRepository: Repository<ServiceJobEvent>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    private readonly notifications: NotificationsService,
  ) {}

  appendStatusChange(
    params: {
      jobId: string;
      serviceCenterId: string;
      fromStatus: JobStatus | null;
      toStatus: JobStatus;
      staffProfileId: string | null;
      note?: string;
    },
    manager?: EntityManager,
  ): Promise<ServiceJobEvent> {
    return this.append(
      {
        jobId: params.jobId,
        serviceCenterId: params.serviceCenterId,
        type: JobEventType.STATUS_CHANGE,
        fromStatus: params.fromStatus,
        toStatus: params.toStatus,
        payload: params.note ? { note: params.note } : null,
        staffProfileId: params.staffProfileId,
      },
      manager,
    );
  }

  /** Appends any timeline entry; staff id is null for customer-made entries. */
  async append(
    params: {
      jobId: string;
      serviceCenterId: string;
      type: JobEventType;
      payload?: Record<string, unknown> | null;
      visibleToCustomer?: boolean;
      staffProfileId?: string | null;
      fromStatus?: JobStatus | null;
      toStatus?: JobStatus | null;
    },
    manager?: EntityManager,
  ): Promise<ServiceJobEvent> {
    const em = manager ?? this.eventRepository.manager;
    const repository = em.getRepository(ServiceJobEvent);
    const event = await repository.save(
      repository.create({
        jobId: params.jobId,
        serviceCenterId: params.serviceCenterId,
        type: params.type,
        payload: params.payload ?? null,
        visibleToCustomer: params.visibleToCustomer ?? true,
        createdByStaffProfileId: params.staffProfileId ?? null,
        fromStatus: params.fromStatus ?? null,
        toStatus: params.toStatus ?? null,
      }),
    );
    await this.notifications.onJobEvent(event, em);
    return event;
  }

  async writeAuditLog(
    params: {
      serviceCenterId: string;
      entityType: string;
      entityId: string;
      action: string;
      actorStaffProfileId?: string | null;
      metadata?: Record<string, unknown>;
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
      correlationId?: string;
    },
    manager?: EntityManager,
  ): Promise<AuditLog> {
    const repository = manager
      ? manager.getRepository(AuditLog)
      : this.auditLogRepository;
    const log = repository.create({
      serviceCenterId: params.serviceCenterId,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      actorStaffProfileId: params.actorStaffProfileId ?? null,
      metadata: params.metadata ?? null,
      before: params.before ?? null,
      after: params.after ?? null,
      correlationId: params.correlationId ?? null,
    });
    return repository.save(log);
  }
}
