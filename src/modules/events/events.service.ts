import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobEventType } from '../../common/enums/job-event-type.enum';
import { JobStatus } from '../../common/enums/job-status.enum';
import { AuditLog } from './entities/audit-log.entity';
import { ServiceJobEvent } from './entities/service-job-event.entity';

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(ServiceJobEvent)
    private readonly eventRepository: Repository<ServiceJobEvent>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  async appendStatusChange(params: {
    jobId: string;
    serviceCenterId: string;
    fromStatus: JobStatus | null;
    toStatus: JobStatus;
    staffProfileId: string;
    note?: string;
  }): Promise<ServiceJobEvent> {
    const event = this.eventRepository.create({
      jobId: params.jobId,
      serviceCenterId: params.serviceCenterId,
      type: JobEventType.STATUS_CHANGE,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      payload: params.note ? { note: params.note } : null,
      visibleToCustomer: true,
      createdByStaffProfileId: params.staffProfileId,
    });
    return this.eventRepository.save(event);
  }

  async appendJobCreated(params: {
    jobId: string;
    serviceCenterId: string;
    staffProfileId: string;
  }): Promise<ServiceJobEvent> {
    const event = this.eventRepository.create({
      jobId: params.jobId,
      serviceCenterId: params.serviceCenterId,
      type: JobEventType.STATUS_CHANGE,
      fromStatus: null,
      toStatus: JobStatus.CHECKED_IN,
      payload: { message: 'Job created' },
      visibleToCustomer: true,
      createdByStaffProfileId: params.staffProfileId,
    });
    return this.eventRepository.save(event);
  }

  async writeAuditLog(params: {
    serviceCenterId: string;
    entityType: string;
    entityId: string;
    action: string;
    actorStaffProfileId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLog> {
    const log = this.auditLogRepository.create({
      serviceCenterId: params.serviceCenterId,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      actorStaffProfileId: params.actorStaffProfileId ?? null,
      metadata: params.metadata ?? null,
    });
    return this.auditLogRepository.save(log);
  }
}
