import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { CommunicationChannel } from '../../common/enums/communication-channel.enum';
import { JobEventType } from '../../common/enums/job-event-type.enum';
import { JobStatus } from '../../common/enums/job-status.enum';
import {
  DeliveryChannel,
  DeliveryStatus,
  NotificationCategory,
} from '../../common/enums/ownership.enum';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { ServiceJobEvent } from '../events/entities/service-job-event.entity';
import { ServiceJob } from '../jobs/entities/service-job.entity';
import { CustomerNotification } from './entities/customer-notification.entity';
import { NotificationDelivery } from './entities/notification-delivery.entity';

export interface NotificationMessage {
  category: NotificationCategory;
  templateKey: string;
  title: string;
  body: string;
  href: string | null;
  /** Major messages go out even when the owner waits at the center. */
  major: boolean;
  jobId?: string | null;
  bookingId?: string | null;
  serviceCenterId?: string | null;
  payload?: Record<string, unknown>;
}

export interface NotificationView {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  href: string | null;
  jobId: string | null;
  bookingId: string | null;
  read: boolean;
  createdAt: Date;
}

const toView = (row: CustomerNotification): NotificationView => ({
  id: row.id,
  category: row.category,
  title: row.title,
  body: row.body,
  href: row.href,
  jobId: row.jobId,
  bookingId: row.bookingId,
  read: row.readAt !== null,
  createdAt: row.createdAt,
});

/**
 * Turns customer-visible job events into an inbox entry and an outbound
 * message. Outbound rows are `SIMULATED` until a WhatsApp/SMS provider exists.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(CustomerNotification)
    private readonly inbox: Repository<CustomerNotification>,
    @InjectRepository(NotificationDelivery)
    private readonly deliveries: Repository<NotificationDelivery>,
  ) {}

  async onJobEvent(
    event: ServiceJobEvent,
    manager: EntityManager,
  ): Promise<void> {
    if (!event.visibleToCustomer) return;
    const job = await manager.getRepository(ServiceJob).findOne({
      where: { id: event.jobId },
      relations: { customer: true, serviceCenter: true },
    });
    if (!job) return;
    const message = this.messageFor(event, job);
    if (!message) return;

    const profile = job.customer?.customerProfileId
      ? await manager
          .getRepository(CustomerProfile)
          .findOne({ where: { id: job.customer.customerProfileId } })
      : null;
    await this.dispatch(manager, message, {
      profile,
      phone: job.customer?.phone ?? null,
      waitingOnSite: job.waitingOnSite,
    });
  }

  /** Messages that are not job timeline events, e.g. booking decisions. */
  async notifyProfile(
    manager: EntityManager,
    profile: CustomerProfile,
    message: NotificationMessage,
  ): Promise<void> {
    await this.dispatch(manager, message, {
      profile,
      phone: profile.phone,
      waitingOnSite: false,
    });
  }

  async list(
    customerProfileId: string,
    unreadOnly = false,
  ): Promise<{ items: NotificationView[]; unreadCount: number }> {
    const [items, unreadCount] = await Promise.all([
      this.inbox.find({
        where: {
          customerProfileId,
          ...(unreadOnly ? { readAt: IsNull() } : {}),
        },
        order: { createdAt: 'DESC' },
        take: 100,
      }),
      this.inbox.count({ where: { customerProfileId, readAt: IsNull() } }),
    ]);
    return { items: items.map(toView), unreadCount };
  }

  async markRead(
    customerProfileId: string,
    id: string,
  ): Promise<NotificationView> {
    const row = await this.inbox.findOne({ where: { id, customerProfileId } });
    if (!row) throw new NotFoundException();
    if (!row.readAt) {
      row.readAt = new Date();
      await this.inbox.save(row);
    }
    return toView(row);
  }

  async markAllRead(customerProfileId: string): Promise<{ updated: number }> {
    const result = await this.inbox.update(
      { customerProfileId, readAt: IsNull() },
      { readAt: new Date() },
    );
    return { updated: result.affected ?? 0 };
  }

  async listForJob(
    serviceCenterId: string,
    jobId: string,
  ): Promise<NotificationDelivery[]> {
    return this.deliveries.find({
      where: { serviceCenterId, jobId },
      order: { createdAt: 'ASC' },
    });
  }

  private async dispatch(
    manager: EntityManager,
    message: NotificationMessage,
    to: {
      profile: CustomerProfile | null;
      phone: string | null;
      waitingOnSite: boolean;
    },
  ): Promise<void> {
    const deliveries = manager.getRepository(NotificationDelivery);
    let notificationId: string | null = null;

    if (to.profile) {
      const inbox = manager.getRepository(CustomerNotification);
      const saved = await inbox.save(
        inbox.create({
          customerProfileId: to.profile.id,
          category: message.category,
          title: message.title,
          body: message.body,
          href: message.href,
          jobId: message.jobId ?? null,
          bookingId: message.bookingId ?? null,
        }),
      );
      notificationId = saved.id;
    }

    const outbound = this.pickChannel(to.profile, to.phone);
    const suppressed =
      (!message.major && to.waitingOnSite) ||
      (to.profile !== null && !to.profile.serviceUpdates && !message.major);
    if (!outbound) return;
    await deliveries.save(
      deliveries.create({
        notificationId,
        customerProfileId: to.profile?.id ?? null,
        serviceCenterId: message.serviceCenterId ?? null,
        jobId: message.jobId ?? null,
        channel: outbound.channel,
        templateKey: message.templateKey,
        recipient: outbound.recipient,
        payload: {
          title: message.title,
          body: message.body,
          ...(message.payload ?? {}),
        },
        status: suppressed ? DeliveryStatus.SKIPPED : DeliveryStatus.SIMULATED,
        lastError: suppressed ? 'Suppressed by notification preferences' : null,
      }),
    );
  }

  private pickChannel(
    profile: CustomerProfile | null,
    phone: string | null,
  ): { channel: DeliveryChannel; recipient: string } | null {
    if (profile) {
      if (
        profile.preferredChannel === CommunicationChannel.EMAIL &&
        profile.email &&
        profile.emailConsent
      ) {
        return { channel: DeliveryChannel.EMAIL, recipient: profile.email };
      }
      if (
        profile.preferredChannel === CommunicationChannel.WHATSAPP &&
        profile.whatsappConsent &&
        profile.phone
      ) {
        return { channel: DeliveryChannel.WHATSAPP, recipient: profile.phone };
      }
    }
    const number = profile?.phone ?? phone;
    return number ? { channel: DeliveryChannel.SMS, recipient: number } : null;
  }

  private messageFor(
    event: ServiceJobEvent,
    job: ServiceJob,
  ): NotificationMessage | null {
    const center =
      job.serviceCenter?.displayName ?? job.serviceCenter?.name ?? 'The center';
    const ref = job.jobNumber ?? 'your service';
    const base = {
      href: `/services/${job.id}`,
      jobId: job.id,
      serviceCenterId: job.serviceCenterId,
      payload: { jobNumber: job.jobNumber, centerName: center },
    };
    const payload = event.payload ?? {};

    switch (event.type) {
      case JobEventType.APPROVAL_REQUESTED:
        return {
          ...base,
          category: NotificationCategory.APPROVAL,
          templateKey: 'job.approval_requested',
          title: 'Approval needed',
          body: `${center} recommends extra work worth ₹${String(payload.totalInr)} on ${ref}. Review and decide in the app.`,
          major: true,
        };
      case JobEventType.INVOICE_ISSUED:
        if (payload.paidAtCounter) return null;
        return {
          ...base,
          category: NotificationCategory.PAYMENT,
          templateKey: 'job.invoice_issued',
          title: 'Your bill is ready',
          body: `Bill ${String(payload.invoiceNumber)} for ₹${String(payload.totalInr)}. Pay at the counter when you collect your vehicle.`,
          major: true,
          payload: { ...base.payload, upiVpa: job.serviceCenter?.upiVpa },
        };
      case JobEventType.NOTE:
        return {
          ...base,
          category: NotificationCategory.SERVICE,
          templateKey: 'job.note',
          title: `Update from ${center}`,
          body: (typeof payload.message === 'string'
            ? payload.message
            : ''
          ).slice(0, 500),
          major: false,
        };
      case JobEventType.STATUS_CHANGE:
        return this.statusMessage(event, base, center, ref);
      default:
        return null;
    }
  }

  private statusMessage(
    event: ServiceJobEvent,
    base: Pick<
      NotificationMessage,
      'href' | 'jobId' | 'serviceCenterId' | 'payload'
    >,
    center: string,
    ref: string,
  ): NotificationMessage | null {
    const common = { ...base, category: NotificationCategory.SERVICE };
    const reason = (event.payload as { reason?: string } | null)?.reason;
    switch (event.toStatus) {
      case JobStatus.CHECKED_IN:
        return {
          ...common,
          templateKey: 'job.checked_in',
          title: 'Vehicle checked in',
          body: `${center} has received your vehicle. Job card ${ref}.`,
          major: false,
        };
      case JobStatus.INSPECTION:
        return {
          ...common,
          templateKey: 'job.inspection',
          title: 'Inspection started',
          body: `A technician is inspecting your vehicle at ${center}.`,
          major: false,
        };
      case JobStatus.IN_PROGRESS:
        return {
          ...common,
          templateKey: 'job.in_progress',
          title: 'Service in progress',
          body: `Work on ${ref} is under way.`,
          major: false,
        };
      case JobStatus.ON_HOLD:
        return {
          ...common,
          templateKey: 'job.on_hold',
          title: 'Work paused',
          body: reason
            ? `Work on ${ref} is paused: ${reason}`
            : `Work on ${ref} is paused.`,
          major: true,
        };
      case JobStatus.READY_FOR_PICKUP:
        return {
          ...common,
          templateKey: 'job.ready_for_pickup',
          title: 'Your vehicle is ready',
          body: `${ref} is ready for pickup at ${center}.`,
          major: true,
        };
      case JobStatus.COMPLETED:
        return {
          ...common,
          templateKey: 'job.completed',
          title: 'Service complete',
          body: `Thanks for visiting ${center}. Your service record for ${ref} is saved.`,
          major: true,
        };
      case JobStatus.CANCELLED:
        return {
          ...common,
          templateKey: 'job.cancelled',
          title: 'Service cancelled',
          body: reason
            ? `${ref} was cancelled: ${reason}`
            : `${ref} was cancelled.`,
          major: true,
        };
      default:
        return null;
    }
  }
}
