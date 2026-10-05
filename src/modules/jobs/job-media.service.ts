import { randomUUID } from 'crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { JobEventType } from '../../common/enums/job-event-type.enum';
import { UploadStatus } from '../../common/enums/job-work.enum';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { EventsService } from '../events/events.service';
import { AddJobMediaDto, UpdateJobMediaDto } from './dto/job-work.dto';
import { JobLineItem } from './entities/job-line-item.entity';
import { JobMedia } from './entities/job-media.entity';
import { JobStoreService } from './job-store.service';
import { MediaView, toMediaView } from './job-view';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

/**
 * Photo and video evidence. Records start `PENDING`; the client uploads the
 * bytes to `storageKey`, then confirms. Until object storage exists the
 * response carries `url: null` and confirm only flips the status.
 */
@Injectable()
export class JobMediaService {
  constructor(
    @InjectRepository(JobMedia)
    private readonly mediaRepository: Repository<JobMedia>,
    @InjectRepository(JobLineItem)
    private readonly lineRepository: Repository<JobLineItem>,
    private readonly store: JobStoreService,
    private readonly eventsService: EventsService,
  ) {}

  async list(auth: AuthContext, jobId: string): Promise<MediaView[]> {
    await this.store.get(auth.serviceCenterId!, jobId);
    const rows = await this.mediaRepository.find({
      where: { jobId, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
    return rows.map(toMediaView);
  }

  async add(
    auth: AuthContext,
    jobId: string,
    dto: AddJobMediaDto,
  ): Promise<MediaView> {
    const centerId = auth.serviceCenterId!;
    const job = await this.store.get(centerId, jobId);
    this.store.assertOpen(job);
    if (dto.lineItemId) {
      const line = await this.lineRepository.findOne({
        where: { id: dto.lineItemId, jobId, deletedAt: IsNull() },
      });
      if (!line) {
        throw new NotFoundException('Line item not found on this job');
      }
    }
    const id = randomUUID();
    const media = await this.mediaRepository.save(
      this.mediaRepository.create({
        id,
        jobId,
        serviceCenterId: centerId,
        kind: dto.kind,
        storageKey: `centers/${centerId}/jobs/${jobId}/media/${id}.${EXTENSIONS[dto.mimeType]}`,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        caption: dto.caption?.trim() || null,
        visibleToCustomer: dto.visibleToCustomer ?? false,
        uploadStatus: UploadStatus.PENDING,
        lineItemId: dto.lineItemId ?? null,
        uploadedByStaffProfileId: auth.staffProfileId,
      }),
    );
    return toMediaView(media);
  }

  async confirm(
    auth: AuthContext,
    jobId: string,
    mediaId: string,
  ): Promise<MediaView> {
    const media = await this.getMedia(auth, jobId, mediaId);
    if (media.uploadStatus === UploadStatus.CONFIRMED) {
      return toMediaView(media);
    }
    if (media.uploadStatus === UploadStatus.FAILED) {
      throw new ConflictException('This upload failed; add the file again');
    }
    media.uploadStatus = UploadStatus.CONFIRMED;
    const saved = await this.mediaRepository.save(media);
    await this.eventsService.append({
      jobId,
      serviceCenterId: media.serviceCenterId,
      type: JobEventType.MEDIA_ADDED,
      payload: { mediaId, kind: media.kind, caption: media.caption },
      visibleToCustomer: media.visibleToCustomer,
      staffProfileId: auth.staffProfileId,
    });
    return toMediaView(saved);
  }

  async update(
    auth: AuthContext,
    jobId: string,
    mediaId: string,
    dto: UpdateJobMediaDto,
  ): Promise<MediaView> {
    const media = await this.getMedia(auth, jobId, mediaId);
    if (dto.caption !== undefined) media.caption = dto.caption.trim() || null;
    if (dto.visibleToCustomer !== undefined) {
      media.visibleToCustomer = dto.visibleToCustomer;
    }
    return toMediaView(await this.mediaRepository.save(media));
  }

  async remove(
    auth: AuthContext,
    jobId: string,
    mediaId: string,
  ): Promise<void> {
    const media = await this.getMedia(auth, jobId, mediaId);
    await this.mediaRepository.softDelete({ id: media.id });
  }

  private async getMedia(
    auth: AuthContext,
    jobId: string,
    mediaId: string,
  ): Promise<JobMedia> {
    await this.store.get(auth.serviceCenterId!, jobId);
    const media = await this.mediaRepository.findOne({
      where: { id: mediaId, jobId, deletedAt: IsNull() },
    });
    if (!media) {
      throw new NotFoundException();
    }
    return media;
  }
}
