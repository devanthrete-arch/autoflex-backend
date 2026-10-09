import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { NotificationCategory } from '../../common/enums/ownership.enum';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { SupportAgentProfile } from '../support-identity/support-agent-profile.entity';
import { CommandMeta, withSupportReceipt } from './support-command';
import { SupportCommandBody } from './dto/support-workflow.dto';
import { supportConflict } from './support-errors';
import {
  authorizeSupportCommand,
  SupportCommand,
  supportTransition,
} from './support-policy';
import { SupportRequestEvent } from './support-request-event.entity';
import { SupportRequest } from './support-request.entity';

@Injectable()
export class SupportWorkflowService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
  ) {}
  async command(
    auth: AuthContext,
    id: string,
    command: SupportCommand,
    body: SupportCommandBody,
    meta: CommandMeta,
  ) {
    authorizeSupportCommand(auth, command);
    return this.dataSource.transaction(async (manager) => {
      await this.load(manager, auth, id);
      return withSupportReceipt(manager, auth, meta, async () => {
        const row = await this.load(manager, auth, id);
        if (row.version !== meta.version)
          throw supportConflict(
            'SUPPORT_VERSION_CONFLICT',
            'This request changed. Refresh it before sending again.',
            row.version,
          );
        const agents = manager.getRepository(SupportAgentProfile);
        if (
          command === 'assign' &&
          !(await agents.findOneBy({
            id: body.assignedAgentProfileId,
            iamDomainId: auth.domainId,
            isActive: true,
          }))
        )
          throw new UnprocessableEntityException({
            code: 'SUPPORT_ASSIGNEE_INVALID',
            message: 'Choose an active support operator',
          });
        const previousActive = row.assignedAgentProfileId
          ? !!(await agents.findOneBy({
              id: row.assignedAgentProfileId,
              isActive: true,
            }))
          : false;
        const now = new Date();
        const transition = supportTransition(
          row,
          auth,
          command,
          body,
          now,
          previousActive,
        );
        const result = await manager
          .getRepository(SupportRequest)
          .update(
            { id, version: row.version },
            {
              ...transition.changes,
              version: row.version + 1,
              updatedAt: now,
              lastActivityAt: now,
            },
          );
        if (!result.affected) {
          const latest = await this.load(manager, auth, id);
          throw supportConflict(
            'SUPPORT_VERSION_CONFLICT',
            'This request changed. Refresh it before sending again.',
            latest.version,
          );
        }
        const changes = Object.fromEntries(
          Object.entries(transition.changes).map(([field, after]) => [
            field,
            { before: row[field as keyof SupportRequest], after },
          ]),
        );
        const event = await manager
          .getRepository(SupportRequestEvent)
          .save({
            supportRequestId: id,
            requestVersion: row.version + 1,
            type: transition.type,
            visibility: transition.visibility,
            body: transition.body,
            actorType: command === 'customerReply' ? 'CUSTOMER' : 'SUPPORT',
            actorCustomerProfileId:
              command === 'customerReply' ? auth.customerProfileId : null,
            actorSupportAgentProfileId:
              command === 'customerReply' ? null : auth.supportAgentProfileId,
            changes,
            createdAt: now,
          });
        if (transition.visibility === 'PUBLIC' && command !== 'customerReply') {
          const profile = await manager
            .getRepository(CustomerProfile)
            .findOneByOrFail({ id: row.customerProfileId });
          await this.notifications.notifyProfile(manager, profile, {
            category: NotificationCategory.SUPPORT,
            templateKey: `support.${transition.type.toLowerCase()}`,
            title: `Update on ${row.referenceNumber}`,
            body: 'Your support request has an update. Open Help & Support to read it.',
            href: `/support/${id}`,
            major: true,
            payload: {
              supportRequestId: id,
              referenceNumber: row.referenceNumber,
              href: `/support/${id}`,
            },
          });
        }
        return {
          requestId: id,
          version: row.version + 1,
          status: transition.changes.status ?? row.status,
          eventId: event.id,
        };
      });
    });
  }
  private async load(manager: EntityManager, auth: AuthContext, id: string) {
    if (!['support', 'customer'].includes(auth.actorType))
      throw new ForbiddenException();
    const row = await manager.getRepository(SupportRequest).findOneBy({ id });
    if (
      !row ||
      (auth.actorType === 'customer' &&
        row.customerProfileId !== auth.customerProfileId)
    )
      throw new NotFoundException();
    return row;
  }
}
