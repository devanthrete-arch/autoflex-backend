import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  NotificationCategory,
  SupportCategory,
  SupportStatus,
} from '../../common/enums/ownership.enum';
import { generateReference } from '../../common/reference-number';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { Booking } from '../bookings/entities/booking.entity';
import { MeService } from '../customers/me.service';
import { ServiceJob } from '../jobs/entities/service-job.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateSupportRequestDto } from './dto/support.dto';
import { SupportRequest } from './support-request.entity';

export interface SupportRequestView {
  id: string;
  referenceNumber: string;
  category: SupportCategory;
  subject: string;
  message: string;
  jobId: string | null;
  bookingId: string | null;
  preferredChannel: string | null;
  status: SupportStatus;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const toView = (row: SupportRequest): SupportRequestView => ({
  id: row.id,
  referenceNumber: row.referenceNumber,
  category: row.category,
  subject: row.subject,
  message: row.message,
  jobId: row.jobId,
  bookingId: row.bookingId,
  preferredChannel: row.preferredChannel,
  status: row.status,
  resolvedAt: row.resolvedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** Customer help requests; the Autoflex support desk works them off-app for now. */
@Injectable()
export class SupportService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(SupportRequest)
    private readonly repository: Repository<SupportRequest>,
    private readonly meService: MeService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(auth: AuthContext): Promise<SupportRequestView[]> {
    const profile = await this.meService.ensureProfile(auth);
    const rows = await this.repository.find({
      where: { customerProfileId: profile.id },
      order: { createdAt: 'DESC' },
    });
    return rows.map(toView);
  }

  async get(auth: AuthContext, id: string): Promise<SupportRequestView> {
    const profile = await this.meService.ensureProfile(auth);
    const row = await this.repository.findOne({
      where: { id, customerProfileId: profile.id },
    });
    if (!row) throw new NotFoundException();
    return toView(row);
  }

  async create(
    auth: AuthContext,
    dto: CreateSupportRequestDto,
  ): Promise<SupportRequestView> {
    const profile = await this.meService.ensureProfile(auth);
    if (dto.jobId) {
      const job = await this.dataSource.getRepository(ServiceJob).findOne({
        where: { id: dto.jobId, customer: { customerProfileId: profile.id } },
        relations: { customer: true },
      });
      if (!job) {
        throw new UnprocessableEntityException('That service is not yours');
      }
    }
    if (dto.bookingId) {
      const booking = await this.dataSource.getRepository(Booking).findOne({
        where: { id: dto.bookingId, customerProfileId: profile.id },
      });
      if (!booking) {
        throw new UnprocessableEntityException('That booking is not yours');
      }
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SupportRequest);
      const row = await repo.save(
        repo.create({
          customerProfileId: profile.id,
          referenceNumber: generateReference('SR'),
          category: dto.category,
          subject: dto.subject.trim(),
          message: dto.message.trim(),
          jobId: dto.jobId ?? null,
          bookingId: dto.bookingId ?? null,
          preferredChannel: dto.preferredChannel ?? null,
        }),
      );
      await this.notifications.notifyProfile(manager, profile, {
        category: NotificationCategory.SUPPORT,
        templateKey: 'support.received',
        title: `We got your request ${row.referenceNumber}`,
        body: 'Our team will get back to you within one working day.',
        href: `/support/${row.id}`,
        major: true,
        jobId: row.jobId,
        bookingId: row.bookingId,
        payload: { referenceNumber: row.referenceNumber },
      });
      return row;
    });
    return toView(saved);
  }
}
