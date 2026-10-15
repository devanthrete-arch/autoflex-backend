import type { ServiceScope } from '../offerings/entities/service-package.entity';
import { JobEventType } from '../../common/enums/job-event-type.enum';
import { JobStatus } from '../../common/enums/job-status.enum';
import {
  JobApprovalStatus,
  JobLineStatus,
  UploadStatus,
} from '../../common/enums/job-work.enum';
import { fromPaise, inr, toPaise } from '../../common/money';
import { InvoiceSummary, toInvoiceSummary } from '../billing/invoice-view';
import { ServiceJobEvent } from '../events/entities/service-job-event.entity';
import { JobApproval } from './entities/job-approval.entity';
import { JobLineItem } from './entities/job-line-item.entity';
import { JobMedia } from './entities/job-media.entity';
import { ServiceJob } from './entities/service-job.entity';

export interface LineItemView {
  scope: ServiceScope[];
  id: string;
  kind: string;
  description: string;
  partType: string | null;
  quantity: number;
  unitPriceInr: string;
  amountInr: string;
  status: JobLineStatus;
  approvalId: string | null;
  sourceBookingItemId: string | null;
  partReturnedAt: Date | null;
  createdAt: Date;
}

export interface ApprovalView {
  id: string;
  version: number;
  status: JobApprovalStatus;
  note: string | null;
  totalInr: string;
  requestedAt: Date;
  decidedAt: Date | null;
  decidedBy: 'CUSTOMER' | 'STAFF' | null;
  decisionChannel: string | null;
  decisionNote: string | null;
  items: LineItemView[];
}

export interface MediaView {
  id: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  caption: string | null;
  visibleToCustomer: boolean;
  uploadStatus: UploadStatus;
  lineItemId: string | null;
  createdAt: Date;
  /** Signed upload or download target; null until object storage is wired. */
  url: string | null;
}

export interface TimelineEntryView {
  id: string;
  type: JobEventType;
  fromStatus: JobStatus | null;
  toStatus: JobStatus | null;
  payload: Record<string, unknown> | null;
  visibleToCustomer: boolean;
  createdAt: Date;
}

export interface JobTotals {
  includedInr: string;
  approvedInr: string;
  pendingInr: string;
  declinedInr: string;
  /** Included scope plus approved extras. */
  currentInr: string;
}

export interface JobSummaryView {
  id: string;
  jobNumber: string | null;
  version: number;
  serviceCenterId: string;
  customerId: string;
  vehicleId: string;
  vehicleType: string;
  status: JobStatus;
  serviceType: string;
  priority: string;
  odometerKm: number | null;
  fuelLevel: string | null;
  estimatedReadyAt: Date | null;
  assignedTechnicianId: string | null;
  budgetCeiling: string | null;
  accessoriesChecklist: Record<string, unknown> | null;
  paymentMode: string | null;
  sourceBookingId: string | null;
  waitingOnSite: boolean;
  customer: { name: string | null; phone: string } | null;
  vehicle: { registrationNumber: string; makeModel: string | null } | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
}

export interface JobDetailView extends JobSummaryView {
  customerRequest: string | null;
  previousStatus: JobStatus | null;
  hold: { reason: string | null; expectedResumeAt: Date | null } | null;
  cancellationReason: string | null;
  comeback: {
    ofJobId: string;
    reason: string | null;
    warrantyIntent: boolean;
  } | null;
  inspection: {
    items: ServiceJob['inspection'];
    completedAt: Date | null;
  };
  qc: {
    passedAt: Date | null;
    notes: string | null;
    byStaffProfileId: string | null;
  };
  assignedTechnician: { id: string; displayName: string | null } | null;
  totals: JobTotals;
  /** Warning only: the owner's check-in cap against current plus pending. */
  budget: { ceilingInr: string; projectedInr: string; exceeds: boolean } | null;
  lineItems: LineItemView[];
  approvals: ApprovalView[];
  pendingApprovalId: string | null;
  media: MediaView[];
  timeline: TimelineEntryView[];
  skippedSteps: string[];
  pickupNote: string | null;
  close: CloseView | null;
  invoice: InvoiceSummary | null;
}

export interface CloseView {
  finalAmountInr: string;
  adjustmentReason: string | null;
  adjustmentNote: string | null;
  finalNotes: string | null;
  checklist: Record<string, boolean> | null;
}

function toCloseView(job: ServiceJob): CloseView | null {
  if (job.finalAmountInr === null || job.finalAmountInr === undefined) {
    return null;
  }
  return {
    finalAmountInr: inr(job.finalAmountInr),
    adjustmentReason: job.amountAdjustmentReason,
    adjustmentNote: job.amountAdjustmentNote,
    finalNotes: job.finalNotes,
    checklist: job.closeChecklist,
  };
}

export function toLineItemView(line: JobLineItem): LineItemView {
  return {
    id: line.id,
    kind: line.kind,
    description: line.description,
    scope: Array.isArray(line.scope) ? line.scope : [],
    partType: line.partType,
    quantity: Number(line.quantity),
    unitPriceInr: inr(line.unitPriceInr),
    amountInr: inr(line.amountInr),
    status: line.status,
    approvalId: line.approvalId,
    sourceBookingItemId: line.sourceBookingItemId,
    partReturnedAt: line.partReturnedAt,
    createdAt: line.createdAt,
  };
}

export function toMediaView(media: JobMedia): MediaView {
  return {
    id: media.id,
    kind: media.kind,
    mimeType: media.mimeType,
    sizeBytes: media.sizeBytes,
    caption: media.caption,
    visibleToCustomer: media.visibleToCustomer,
    uploadStatus: media.uploadStatus,
    lineItemId: media.lineItemId,
    createdAt: media.createdAt,
    url: null,
  };
}

export function computeTotals(lines: JobLineItem[]): JobTotals {
  const sum = (status: JobLineStatus) =>
    lines
      .filter((line) => line.status === status)
      .reduce((total, line) => total + toPaise(line.amountInr), 0);
  const included = sum(JobLineStatus.INCLUDED);
  const approved = sum(JobLineStatus.APPROVED);
  return {
    includedInr: fromPaise(included),
    approvedInr: fromPaise(approved),
    pendingInr: fromPaise(sum(JobLineStatus.PENDING)),
    declinedInr: fromPaise(sum(JobLineStatus.DECLINED)),
    currentInr: fromPaise(included + approved),
  };
}

function byCreated<T extends { createdAt: Date }>(a: T, b: T): number {
  return a.createdAt.getTime() - b.createdAt.getTime();
}

function liveLines(job: ServiceJob): JobLineItem[] {
  return (job.lineItems ?? [])
    .filter((line) => !line.deletedAt)
    .sort(byCreated);
}

function toApprovalViews(
  job: ServiceJob,
  lines: JobLineItem[],
): ApprovalView[] {
  return [...(job.approvals ?? [])]
    .sort((a, b) => a.version - b.version)
    .map((approval: JobApproval) => ({
      id: approval.id,
      version: approval.version,
      status: approval.status,
      note: approval.note,
      totalInr: inr(approval.totalInr),
      requestedAt: approval.requestedAt,
      decidedAt: approval.decidedAt,
      decidedBy: approval.decidedByCustomerProfileId
        ? 'CUSTOMER'
        : approval.decidedByStaffProfileId
          ? 'STAFF'
          : null,
      decisionChannel: approval.decisionChannel,
      decisionNote: approval.decisionNote,
      items: lines
        .filter((line) => line.approvalId === approval.id)
        .map(toLineItemView),
    }));
}

function toTimeline(events: ServiceJobEvent[]): TimelineEntryView[] {
  return [...events].sort(byCreated).map((event) => ({
    id: event.id,
    type: event.type,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    payload: event.payload,
    visibleToCustomer: event.visibleToCustomer,
    createdAt: event.createdAt,
  }));
}

export function toJobSummary(job: ServiceJob): JobSummaryView {
  return {
    id: job.id,
    jobNumber: job.jobNumber,
    version: job.version,
    serviceCenterId: job.serviceCenterId,
    customerId: job.customerId,
    vehicleId: job.vehicleId,
    vehicleType: job.vehicleType,
    status: job.status,
    serviceType: job.serviceType,
    priority: job.priority,
    odometerKm: job.odometerKm,
    fuelLevel: job.fuelLevel,
    estimatedReadyAt: job.estimatedReadyAt,
    assignedTechnicianId: job.assignedTechnicianId,
    budgetCeiling:
      job.budgetCeiling === null || job.budgetCeiling === undefined
        ? null
        : inr(job.budgetCeiling),
    accessoriesChecklist: job.accessoriesChecklist,
    paymentMode: job.paymentMode,
    sourceBookingId: job.sourceBookingId,
    waitingOnSite: job.waitingOnSite,
    customer: job.customer
      ? { name: job.customer.name, phone: job.customer.phone }
      : null,
    vehicle: job.vehicle
      ? {
          registrationNumber: job.vehicle.registrationNumber,
          makeModel: job.vehicle.makeModel,
        }
      : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    closedAt: job.closedAt,
  };
}

function toBudget(
  ceiling: string | null,
  totals: JobTotals,
): JobDetailView['budget'] {
  if (ceiling === null || ceiling === undefined) return null;
  const projected = toPaise(totals.currentInr) + toPaise(totals.pendingInr);
  return {
    ceilingInr: inr(ceiling),
    projectedInr: fromPaise(projected),
    exceeds: projected > toPaise(ceiling),
  };
}

export function toJobDetail(job: ServiceJob): JobDetailView {
  const lines = liveLines(job);
  const approvals = toApprovalViews(job, lines);
  const totals = computeTotals(lines);
  return {
    ...toJobSummary(job),
    customerRequest: job.customerRequest,
    previousStatus: job.previousStatus,
    hold:
      job.status === JobStatus.ON_HOLD
        ? { reason: job.holdReason, expectedResumeAt: job.expectedResumeAt }
        : null,
    cancellationReason: job.cancellationReason,
    comeback: job.comebackOfJobId
      ? {
          ofJobId: job.comebackOfJobId,
          reason: job.comebackReason,
          warrantyIntent: job.warrantyIntent,
        }
      : null,
    inspection: {
      items: job.inspection,
      completedAt: job.inspectionCompletedAt,
    },
    qc: {
      passedAt: job.qcPassedAt,
      notes: job.qcNotes,
      byStaffProfileId: job.qcByStaffProfileId,
    },
    assignedTechnician: job.assignedTechnician
      ? {
          id: job.assignedTechnician.id,
          displayName: job.assignedTechnician.displayName,
        }
      : null,
    totals,
    budget: toBudget(job.budgetCeiling, totals),
    lineItems: lines.map(toLineItemView),
    approvals,
    pendingApprovalId:
      approvals.find((a) => a.status === JobApprovalStatus.PENDING)?.id ?? null,
    media: (job.media ?? [])
      .filter((media) => !media.deletedAt)
      .sort(byCreated)
      .map(toMediaView),
    timeline: toTimeline(job.events ?? []),
    skippedSteps: job.skippedSteps ?? [],
    pickupNote: job.pickupNote,
    close: toCloseView(job),
    invoice: toInvoiceSummary(job.invoices),
  };
}

/** What the vehicle owner sees in the app. */
export interface CustomerJobView {
  id: string;
  jobNumber: string | null;
  status: JobStatus;
  serviceType: string;
  estimatedReadyAt: Date | null;
  expectedResumeAt: Date | null;
  center: { id: string; name: string; phone: string | null } | null;
  vehicle: {
    registrationNumber: string;
    makeModel: string | null;
    /** The owner's garage vehicle, when the center copy is linked. */
    garageVehicleId: string | null;
  } | null;
  bookingId: string | null;
  customerRequest: string | null;
  odometerKm: number | null;
  holdReason: string | null;
  totals: JobTotals;
  lineItems: LineItemView[];
  approvals: ApprovalView[];
  pendingApprovalId: string | null;
  media: MediaView[];
  timeline: TimelineEntryView[];
  qcPassedAt: Date | null;
  finalAmountInr: string | null;
  finalNotes: string | null;
  invoice: InvoiceSummary | null;
  /** UPI id for paying at the counter. */
  upiVpa: string | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
}

export function toCustomerJobView(job: ServiceJob): CustomerJobView {
  const lines = liveLines(job);
  const approvals = toApprovalViews(job, lines).filter(
    (approval) => approval.status !== JobApprovalStatus.WITHDRAWN,
  );
  const center = job.serviceCenter;
  return {
    id: job.id,
    jobNumber: job.jobNumber,
    status: job.status,
    serviceType: job.serviceType,
    estimatedReadyAt: job.estimatedReadyAt,
    expectedResumeAt:
      job.status === JobStatus.ON_HOLD ? job.expectedResumeAt : null,
    center: center
      ? {
          id: center.id,
          name: center.displayName ?? center.name,
          phone: center.publicPhone,
        }
      : null,
    vehicle: job.intakeSnapshot
      ? {
          registrationNumber: job.intakeSnapshot.vehicleRegistration,
          makeModel: job.intakeSnapshot.vehicleLabel,
          garageVehicleId: job.intakeSnapshot.garageVehicleId,
        }
      : null,
    bookingId: job.sourceBookingId,
    customerRequest: job.customerRequest,
    odometerKm: job.odometerKm,
    holdReason: job.status === JobStatus.ON_HOLD ? job.holdReason : null,
    totals: computeTotals(lines),
    lineItems: lines
      .filter((line) => line.status !== JobLineStatus.DECLINED)
      .map(toLineItemView),
    approvals,
    pendingApprovalId:
      approvals.find((a) => a.status === JobApprovalStatus.PENDING)?.id ?? null,
    media: (job.media ?? [])
      .filter(
        (media) =>
          !media.deletedAt &&
          media.visibleToCustomer &&
          media.uploadStatus === UploadStatus.CONFIRMED,
      )
      .sort(byCreated)
      .map(toMediaView),
    timeline: toTimeline(
      (job.events ?? []).filter((event) => event.visibleToCustomer),
    ),
    qcPassedAt: job.qcPassedAt,
    finalAmountInr:
      job.finalAmountInr === null || job.finalAmountInr === undefined
        ? null
        : inr(job.finalAmountInr),
    finalNotes: job.finalNotes,
    invoice: toInvoiceSummary(job.invoices),
    upiVpa: center?.upiVpa ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    closedAt: job.closedAt,
  };
}

/** Link-only progress; the only phone is the center's public business contact. */
export interface PublicTrackingView {
  jobNumber: string | null;
  status: JobStatus;
  serviceType: string;
  estimatedReadyAt: Date | null;
  centerName: string | null;
  centerPhone: string | null;
  vehicleRegistration: string | null;
  awaitingApproval: boolean;
  progress: { status: JobStatus | null; at: Date }[];
  updatedAt: Date;
}

export function maskRegistration(
  registration: string | null | undefined,
): string | null {
  const plate = registration?.toUpperCase().replace(/[^A-Z0-9]/g, '') ?? '';
  if (!plate) return null;
  if (plate.length <= 8) return '•'.repeat(plate.length);
  return `${plate.slice(0, 4)}${'•'.repeat(plate.length - 8)}${plate.slice(-4)}`;
}

export function publicCenterPhone(
  raw: string | null | undefined,
): string | null {
  if (!raw || !/^\+?[\d ()-]+$/.test(raw.trim())) return null;
  const value = raw.trim().replace(/[ ()-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(value)) return value;
  if (/^[1-9]\d{9}$/.test(value)) return `+91${value}`;
  if (/^0[1-9]\d{9}$/.test(value)) return `+91${value.slice(1)}`;
  if (/^91[1-9]\d{9}$/.test(value)) return `+${value}`;
  return null;
}

export function toPublicTrackingView(job: ServiceJob): PublicTrackingView {
  return {
    jobNumber: job.jobNumber,
    status: job.status,
    serviceType: job.serviceType,
    estimatedReadyAt: job.estimatedReadyAt,
    centerName: job.serviceCenter
      ? (job.serviceCenter.displayName ?? job.serviceCenter.name)
      : null,
    centerPhone: publicCenterPhone(job.serviceCenter?.publicPhone),
    vehicleRegistration: job.vehicle
      ? maskRegistration(job.vehicle.registrationNumber)
      : null,
    awaitingApproval: job.status === JobStatus.AWAITING_APPROVAL,
    progress: [...(job.events ?? [])]
      .filter(
        (event) =>
          event.visibleToCustomer && event.type === JobEventType.STATUS_CHANGE,
      )
      // Preserve the database's microsecond ordering and ID tie-break. Sorting
      // JavaScript Dates here would lose sub-millisecond chronology.
      .map((event) => ({ status: event.toStatus, at: event.createdAt })),
    updatedAt: job.updatedAt,
  };
}
