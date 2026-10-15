import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  FindOptionsRelations,
  IsNull,
  Repository,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { JobStatus } from '../../common/enums/job-status.enum';
import { ServiceJob } from './entities/service-job.entity';

export const STAFF_JOB_RELATIONS: FindOptionsRelations<ServiceJob> = {
  customer: true,
  vehicle: true,
  assignedTechnician: true,
  events: true,
  lineItems: true,
  approvals: true,
  media: true,
  invoices: true,
};

const CLOSED = new Set([JobStatus.COMPLETED, JobStatus.CANCELLED]);

/**
 * Loads jobs inside a center and applies changes with optimistic locking:
 * each change is an `UPDATE … WHERE version = loaded` that bumps the version.
 */
@Injectable()
export class JobStoreService {
  constructor(
    @InjectRepository(ServiceJob)
    private readonly repository: Repository<ServiceJob>,
  ) {}

  async get(
    serviceCenterId: string,
    jobId: string,
    options: {
      expectedVersion?: number;
      relations?: FindOptionsRelations<ServiceJob>;
      manager?: EntityManager;
    } = {},
  ): Promise<ServiceJob> {
    const repository = options.manager
      ? options.manager.getRepository(ServiceJob)
      : this.repository;
    const job = await repository.findOne({
      where: { id: jobId, serviceCenterId },
      relations: options.relations,
    });
    if (!job) {
      throw new NotFoundException();
    }
    if (
      options.expectedVersion !== undefined &&
      options.expectedVersion !== job.version
    ) {
      throw this.staleVersion(job.version);
    }
    return job;
  }

  async commit(
    job: ServiceJob,
    changes: QueryDeepPartialEntity<ServiceJob>,
    manager?: EntityManager,
  ): Promise<ServiceJob> {
    const repository = manager
      ? manager.getRepository(ServiceJob)
      : this.repository;
    const result = await repository.update(
      { id: job.id, version: job.version, deletedAt: IsNull() },
      { ...changes, version: job.version + 1 },
    );
    if (!result.affected) {
      const current = await repository.findOne({
        where: { id: job.id },
        select: { id: true, version: true },
      });
      throw this.staleVersion(current?.version ?? job.version);
    }
    Object.assign(job, changes, { version: job.version + 1 });
    return job;
  }

  assertOpen(job: ServiceJob): void {
    if (CLOSED.has(job.status)) {
      throw new ConflictException(`This job is ${job.status}`);
    }
  }

  assertStatus(job: ServiceJob, allowed: JobStatus[], action: string): void {
    if (!allowed.includes(job.status)) {
      throw new ConflictException(
        `Cannot ${action} while the job is ${job.status}`,
      );
    }
  }

  private staleVersion(currentVersion: number): ConflictException {
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: 'This job changed since you loaded it; reload and try again',
      currentVersion,
    });
  }
}
