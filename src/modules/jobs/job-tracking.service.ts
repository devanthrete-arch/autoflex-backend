import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { EventsService } from '../events/events.service';
import {
  CommandMeta,
  withCommandReceipt,
} from '../idempotency/transactional-receipt';
import { ServiceJob } from './entities/service-job.entity';

export const ROTATION_REASONS = [
  'SHARED_INCORRECTLY',
  'LINK_EXPOSED',
  'CUSTOMER_REQUEST',
  'OTHER',
] as const;
export type RotationReason = (typeof ROTATION_REASONS)[number];
export type CurrentTrackingToken = {
  jobId: string;
  version: number;
  publicToken: string;
};
export type TrackingRotationReceipt = {
  jobId: string;
  version: number;
  rotationId: string;
  rotatedAt: string;
};

@Injectable()
export class JobTrackingService {
  constructor(
    private readonly db: DataSource,
    private readonly events: EventsService,
  ) {}

  private authorize(auth: AuthContext, update = false): string {
    if (
      auth.actorType !== 'staff' ||
      !auth.staffProfileId ||
      !auth.serviceCenterId ||
      !auth.roles.some((role) =>
        ['admin', 'manager', 'advisor'].includes(role),
      ) ||
      !auth.permissions.includes('jobs:read') ||
      (update && !auth.permissions.includes('jobs:update'))
    )
      throw new ForbiddenException();
    return auth.serviceCenterId;
  }

  private async scoped(
    manager: EntityManager,
    center: string,
    id: string,
  ): Promise<ServiceJob> {
    const job = await manager.getRepository(ServiceJob).findOne({
      where: { id, serviceCenterId: center },
      select: { id: true, version: true, publicToken: true },
    });
    if (!job) throw new NotFoundException();
    return job;
  }

  async current(auth: AuthContext, id: string): Promise<CurrentTrackingToken> {
    const job = await this.scoped(this.db.manager, this.authorize(auth), id);
    return {
      jobId: job.id,
      version: job.version,
      publicToken: job.publicToken,
    };
  }

  // Separate method makes collisions deterministic in tests without weakening randomness.
  generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  async rotate(
    auth: AuthContext,
    id: string,
    reason: RotationReason,
    meta: CommandMeta,
  ): Promise<TrackingRotationReceipt> {
    const center = this.authorize(auth, true);
    if (
      !ROTATION_REASONS.includes(reason) ||
      !meta.key ||
      !/^[A-Za-z0-9_.:-]{8,128}$/.test(meta.key) ||
      !Number.isInteger(meta.version) ||
      !meta.version ||
      meta.version < 1 ||
      meta.version > 2147483647
    )
      throw new BadRequestException('Invalid tracking replacement command');
    let candidates = 0;
    const tokenIndex = this.db
      .getMetadata(ServiceJob)
      .indices.find(
        (index) =>
          index.isUnique &&
          index.columns.length === 1 &&
          index.columns[0].propertyName === 'publicToken',
      )?.name;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.transaction(async (manager) => {
          await this.scoped(manager, center, id);
          return withCommandReceipt(
            manager,
            `staff:${auth.staffProfileId}`,
            meta,
            async () => {
              const job = await this.scoped(manager, center, id);
              if (job.version !== meta.version)
                throw this.conflict(job.version);
              let token: string;
              do {
                token = this.generateToken();
                candidates++;
              } while (token === job.publicToken && candidates < 3);
              if (token === job.publicToken)
                throw new ServiceUnavailableException(
                  'Could not generate a replacement link; retry this attempt',
                );
              const result = await manager.getRepository(ServiceJob).update(
                {
                  id,
                  serviceCenterId: center,
                  version: meta.version,
                  deletedAt: IsNull(),
                },
                { publicToken: token, version: job.version + 1 },
              );
              if (!result.affected)
                throw this.conflict(
                  (await this.scoped(manager, center, id)).version,
                );
              const audit = await this.events.writeAuditLog(
                {
                  serviceCenterId: center,
                  entityType: 'ServiceJob',
                  entityId: id,
                  action: 'PUBLIC_TOKEN_ROTATED',
                  actorStaffProfileId: auth.staffProfileId,
                  metadata: { reason },
                  before: { version: job.version },
                  after: {
                    version: job.version + 1,
                    trackingLinkReplaced: true,
                  },
                },
                manager,
              );
              return {
                jobId: id,
                version: job.version + 1,
                rotationId: audit.id,
                rotatedAt: audit.createdAt.toISOString(),
              };
            },
          );
        });
      } catch (error) {
        const pg = error as {
          code?: string;
          constraint?: string;
          driverError?: { code?: string; constraint?: string };
        };
        const cause = pg.driverError ?? pg;
        const collision =
          cause.code === '23505' &&
          !!tokenIndex &&
          cause.constraint === tokenIndex;
        if (!collision) throw error;
        if (candidates >= 3 || attempt === 2)
          throw new ServiceUnavailableException(
            'Could not generate a replacement link; retry this attempt',
          );
      }
    }
    throw new Error('Tracking token generation failed');
  }

  private conflict(currentVersion: number): ConflictException {
    return new ConflictException({
      code: 'JOB_VERSION_CONFLICT',
      message: 'This job changed; reload and confirm again',
      currentVersion,
    });
  }
}
