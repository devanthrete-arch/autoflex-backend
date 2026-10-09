import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { NotificationCategory } from '../../common/enums/ownership.enum';
import { generateReference } from '../../common/reference-number';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { MeService } from '../customers/me.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateSupportRequestDto } from './dto/support.dto';
import { SupportHistoryQueryDto } from './dto/support-workflow.dto';
import { CommandMeta, withSupportReceipt } from './support-command';
import { SupportContextService } from './support-context.service';
import { SupportRequestEvent } from './support-request-event.entity';
import { SupportRequest } from './support-request.entity';
import { customerSupportEvent, customerSupportView } from './support-view';
export type SupportRequestView = ReturnType<typeof customerSupportView>;

@Injectable()
export class SupportService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(SupportRequest)
    private readonly repository: Repository<SupportRequest>,
    private readonly meService: MeService,
    private readonly notifications: NotificationsService,
    private readonly context: SupportContextService,
  ) {}
  async list(auth: AuthContext) {
    const profile = await this.meService.ensureProfile(auth);
    const rows = await this.repository.find({
      where: { customerProfileId: profile.id },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return rows.map((row) => customerSupportView(row));
  }
  async owned(auth: AuthContext, id: string) {
    const profile = await this.meService.ensureProfile(auth);
    const row = await this.repository.findOneBy({
      id,
      customerProfileId: profile.id,
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  async get(auth: AuthContext, id: string) {
    const row = await this.owned(auth, id);
    const imported = await this.dataSource
      .getRepository(SupportRequestEvent)
      .findOneBy({ supportRequestId: id, type: 'IMPORTED' });
    return customerSupportView(
      row,
      !!imported?.changes?.legacyResolutionUnknown && !row.resolutionSummary,
    );
  }
  async events(auth: AuthContext, id: string, query: SupportHistoryQueryDto) {
    await this.owned(auth, id);
    const limit = query.limit ?? 50;
    const rows = await this.dataSource
      .getRepository(SupportRequestEvent)
      .find({
        where: {
          supportRequestId: id,
          visibility: 'PUBLIC',
          ...(query.beforeVersion
            ? { requestVersion: LessThan(query.beforeVersion) }
            : {}),
        },
        order: { requestVersion: 'DESC' },
        take: limit + 1,
      });
    const page = rows.slice(0, limit);
    return {
      items: page.slice().reverse().map(customerSupportEvent),
      nextBeforeVersion:
        rows.length > limit ? page[page.length - 1].requestVersion : null,
    };
  }
  async create(
    auth: AuthContext,
    dto: CreateSupportRequestDto,
    meta: CommandMeta,
  ) {
    const profile = await this.meService.ensureProfile(auth);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.dataSource.transaction((manager) =>
          withSupportReceipt(
            manager,
            auth,
            meta,
            async () => {
              await this.context.ownedLinks(
                profile.id,
                dto.jobId,
                dto.bookingId,
                manager,
              );
              const now = new Date();
              const repo = manager.getRepository(SupportRequest);
              const row = await repo.save(
                repo.create({
                  customerProfileId: profile.id,
                  referenceNumber: generateReference('SR'),
                  category: dto.category,
                  subject: dto.subject,
                  message: dto.message,
                  jobId: dto.jobId ?? null,
                  bookingId: dto.bookingId ?? null,
                  preferredChannel: dto.preferredChannel ?? null,
                  lastActivityAt: now,
                  lastCustomerMessageAt: now,
                }),
              );
              await manager
                .getRepository(SupportRequestEvent)
                .save({
                  supportRequestId: row.id,
                  requestVersion: 1,
                  type: 'CREATED',
                  visibility: 'PUBLIC',
                  body: null,
                  actorType: 'CUSTOMER',
                  actorCustomerProfileId: profile.id,
                  actorSupportAgentProfileId: null,
                  changes: null,
                  createdAt: now,
                });
              await this.notifications.notifyProfile(manager, profile, {
                category: NotificationCategory.SUPPORT,
                templateKey: 'support.received',
                title: `We got your request ${row.referenceNumber}`,
                body: 'Your request is saved. Read replies in Help & Support.',
                href: `/support/${row.id}`,
                major: true,
                jobId: row.jobId,
                bookingId: row.bookingId,
                payload: {
                  supportRequestId: row.id,
                  referenceNumber: row.referenceNumber,
                  href: `/support/${row.id}`,
                },
              });
              return customerSupportView(row);
            },
            async (value) => {
              await this.owned(auth, value.id);
            },
          ),
        );
      } catch (error) {
        const pg = error as { code?: string; constraint?: string };
        if (
          pg.code !== '23505' ||
          pg.constraint !== 'UQ_support_requests_reference' ||
          attempt === 4
        )
          throw error;
      }
    }
    throw new Error('Could not allocate a support reference');
  }
}
