import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { UploadStatus } from '../../common/enums/job-work.enum';
import {
  RecordStatus,
  VaultCategory,
  VEHICLE_VAULT_CATEGORIES,
  VerificationStatus,
} from '../../common/enums/ownership.enum';
import { daysBetween, istToday } from '../../common/time/ist';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { GarageService } from '../customers/garage.service';
import { MeService } from '../customers/me.service';
import {
  CreateVaultDocumentDto,
  ListVaultQueryDto,
  UpdateVaultDocumentDto,
  VaultFileDto,
} from './dto/vault.dto';
import { VaultDocument } from './vault-document.entity';

export const EXPIRING_SOON_DAYS = 30;

export type ExpiryState = 'NONE' | 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';

export interface VaultDocumentView {
  id: string;
  category: VaultCategory;
  title: string;
  documentNumber: string | null;
  issuer: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  expiryState: ExpiryState;
  daysToExpiry: number | null;
  vehicle: { id: string; registrationNumber: string; label: string } | null;
  file: {
    fileName: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    hasBack: boolean;
    uploadStatus: UploadStatus;
    /** Signed URLs arrive with object storage. */
    url: null;
  } | null;
  verificationStatus: VerificationStatus;
  status: RecordStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VaultUploadTarget {
  document: VaultDocumentView;
  /** Storage keys to upload to; signed upload URLs arrive with object storage. */
  uploads: { side: 'front' | 'back'; storageKey: string; url: null }[];
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

export function expiryOf(
  expiryDate: string | null,
  today = istToday(),
): { state: ExpiryState; days: number | null } {
  if (!expiryDate) return { state: 'NONE', days: null };
  const days = daysBetween(today, expiryDate);
  if (days < 0) return { state: 'EXPIRED', days };
  if (days <= EXPIRING_SOON_DAYS) return { state: 'EXPIRING_SOON', days };
  return { state: 'VALID', days };
}

function toView(doc: VaultDocument): VaultDocumentView {
  const expiry = expiryOf(doc.expiryDate);
  const vehicle = doc.garageVehicle;
  return {
    id: doc.id,
    category: doc.category,
    title: doc.title,
    documentNumber: doc.documentNumber,
    issuer: doc.issuer,
    issueDate: doc.issueDate,
    expiryDate: doc.expiryDate,
    expiryState: expiry.state,
    daysToExpiry: expiry.days,
    vehicle: vehicle
      ? {
          id: vehicle.id,
          registrationNumber: vehicle.registrationNumber,
          label: `${vehicle.make} ${vehicle.model}`,
        }
      : null,
    file: doc.frontStorageKey
      ? {
          fileName: doc.fileName,
          mimeType: doc.mimeType,
          sizeBytes: doc.sizeBytes,
          hasBack: Boolean(doc.backStorageKey),
          uploadStatus: doc.uploadStatus,
          url: null,
        }
      : null,
    verificationStatus: doc.verificationStatus,
    status: doc.status,
    notes: doc.notes,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

@Injectable()
export class VaultService {
  constructor(
    @InjectRepository(VaultDocument)
    private readonly repository: Repository<VaultDocument>,
    private readonly meService: MeService,
    private readonly garageService: GarageService,
  ) {}

  async list(
    auth: AuthContext,
    query: ListVaultQueryDto,
  ): Promise<VaultDocumentView[]> {
    const profile = await this.meService.ensureProfile(auth);
    const where: FindOptionsWhere<VaultDocument> = {
      customerProfileId: profile.id,
      status: query.status ?? RecordStatus.ACTIVE,
      ...(query.category ? { category: query.category } : {}),
      ...(query.vehicleId ? { garageVehicleId: query.vehicleId } : {}),
    };
    const rows = await this.repository.find({
      where,
      relations: { garageVehicle: true },
      order: { createdAt: 'DESC' },
    });
    const views = rows.map(toView);
    if (!query.attention) return views;
    return views
      .filter(
        (view) =>
          view.expiryState === 'EXPIRED' ||
          view.expiryState === 'EXPIRING_SOON',
      )
      .sort((a, b) => (a.daysToExpiry ?? 0) - (b.daysToExpiry ?? 0));
  }

  async get(auth: AuthContext, id: string): Promise<VaultDocumentView> {
    return toView(await this.getOwned(auth, id));
  }

  async create(
    auth: AuthContext,
    dto: CreateVaultDocumentDto,
  ): Promise<VaultUploadTarget> {
    const profile = await this.meService.ensureProfile(auth);
    await this.assertVehicleRule(auth, dto.category, dto.vehicleId ?? null);
    this.assertDates(dto.issueDate ?? null, dto.expiryDate ?? null);
    const doc = this.repository.create({
      customerProfileId: profile.id,
      garageVehicleId: dto.vehicleId ?? null,
      category: dto.category,
      title: dto.title.trim(),
      documentNumber: dto.documentNumber?.trim() || null,
      issuer: dto.issuer?.trim() || null,
      issueDate: dto.issueDate ?? null,
      expiryDate: dto.expiryDate ?? null,
      notes: dto.notes?.trim() || null,
      uploadStatus: dto.file ? UploadStatus.PENDING : UploadStatus.CONFIRMED,
    });
    const saved = await this.repository.save(doc);
    if (dto.file) this.attachFile(saved, dto.file);
    await this.repository.save(saved);
    return this.uploadTarget(auth, saved.id);
  }

  async update(
    auth: AuthContext,
    id: string,
    dto: UpdateVaultDocumentDto,
  ): Promise<VaultUploadTarget> {
    const doc = await this.getOwned(auth, id);
    const category = dto.category ?? doc.category;
    const vehicleId =
      dto.vehicleId !== undefined ? dto.vehicleId : doc.garageVehicleId;
    await this.assertVehicleRule(auth, category, vehicleId);
    this.assertDates(
      dto.issueDate ?? doc.issueDate,
      dto.expiryDate ?? doc.expiryDate,
    );
    doc.category = category;
    doc.garageVehicleId = vehicleId;
    if (dto.title !== undefined) doc.title = dto.title.trim();
    if (dto.documentNumber !== undefined) {
      doc.documentNumber = dto.documentNumber.trim() || null;
    }
    if (dto.issuer !== undefined) doc.issuer = dto.issuer.trim() || null;
    if (dto.issueDate !== undefined) doc.issueDate = dto.issueDate;
    if (dto.expiryDate !== undefined) doc.expiryDate = dto.expiryDate;
    if (dto.notes !== undefined) doc.notes = dto.notes.trim() || null;
    if (dto.file) {
      this.attachFile(doc, dto.file);
      doc.verificationStatus = VerificationStatus.UNVERIFIED;
    }
    delete (doc as Partial<VaultDocument>).garageVehicle;
    await this.repository.save(doc);
    return this.uploadTarget(auth, doc.id);
  }

  /** Marks the declared file as uploaded. */
  async confirm(auth: AuthContext, id: string): Promise<VaultDocumentView> {
    const doc = await this.getOwned(auth, id);
    if (!doc.frontStorageKey) {
      throw new UnprocessableEntityException('No file was declared');
    }
    if (doc.uploadStatus !== UploadStatus.CONFIRMED) {
      await this.repository.update(
        { id: doc.id },
        { uploadStatus: UploadStatus.CONFIRMED },
      );
    }
    return this.get(auth, id);
  }

  async setStatus(
    auth: AuthContext,
    id: string,
    status: RecordStatus,
  ): Promise<VaultDocumentView> {
    const doc = await this.getOwned(auth, id);
    await this.repository.update({ id: doc.id }, { status });
    return this.get(auth, id);
  }

  async remove(auth: AuthContext, id: string): Promise<void> {
    const doc = await this.getOwned(auth, id);
    await this.repository.softDelete({ id: doc.id });
  }

  private async getOwned(
    auth: AuthContext,
    id: string,
  ): Promise<VaultDocument> {
    const profile = await this.meService.ensureProfile(auth);
    const doc = await this.repository.findOne({
      where: { id, customerProfileId: profile.id },
      relations: { garageVehicle: true },
    });
    if (!doc) throw new NotFoundException();
    return doc;
  }

  private async uploadTarget(
    auth: AuthContext,
    id: string,
  ): Promise<VaultUploadTarget> {
    const doc = await this.getOwned(auth, id);
    const uploads: VaultUploadTarget['uploads'] = [];
    if (doc.uploadStatus === UploadStatus.PENDING && doc.frontStorageKey) {
      uploads.push({
        side: 'front',
        storageKey: doc.frontStorageKey,
        url: null,
      });
      if (doc.backStorageKey) {
        uploads.push({
          side: 'back',
          storageKey: doc.backStorageKey,
          url: null,
        });
      }
    }
    return { document: toView(doc), uploads };
  }

  private attachFile(doc: VaultDocument, file: VaultFileDto): void {
    const ext = EXTENSIONS[file.mimeType] ?? 'bin';
    const base = `customers/${doc.customerProfileId}/vault/${doc.id}`;
    doc.fileName = file.fileName;
    doc.mimeType = file.mimeType;
    doc.sizeBytes = file.sizeBytes;
    doc.frontStorageKey = `${base}/front.${ext}`;
    doc.backStorageKey = file.hasBack ? `${base}/back.${ext}` : null;
    doc.uploadStatus = UploadStatus.PENDING;
  }

  private async assertVehicleRule(
    auth: AuthContext,
    category: VaultCategory,
    vehicleId: string | null,
  ): Promise<void> {
    if (VEHICLE_VAULT_CATEGORIES.includes(category) && !vehicleId) {
      throw new UnprocessableEntityException(
        'Choose the vehicle this document belongs to',
      );
    }
    if (category === VaultCategory.DRIVING_LICENCE && vehicleId) {
      throw new UnprocessableEntityException(
        'A driving licence belongs to you, so it takes no vehicle',
      );
    }
    if (vehicleId) await this.garageService.getOwned(auth, vehicleId);
  }

  private assertDates(issueDate: string | null, expiryDate: string | null) {
    if (issueDate && expiryDate && expiryDate < issueDate) {
      throw new UnprocessableEntityException(
        'The expiry date is before the issue date',
      );
    }
  }
}
