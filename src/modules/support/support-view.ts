import { SupportStatus } from '../../common/enums/ownership.enum';
import { SupportRequest } from './support-request.entity';
import { SupportRequestEvent } from './support-request-event.entity';

export const needsReply = (row: SupportRequest) =>
  [SupportStatus.OPEN, SupportStatus.IN_PROGRESS].includes(row.status) &&
  (row.lastPublicReplyVersion === null ||
    row.lastCustomerMessageVersion > row.lastPublicReplyVersion);
export const customerSupportView = (
  row: SupportRequest,
  legacyResolutionUnknown = false,
) => ({
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
  version: row.version,
  resolutionSummary: row.resolutionSummary,
  closureSummary: row.closureSummary,
  closedAt: row.closedAt,
  lastActivityAt: row.lastActivityAt,
  displayState:
    row.status === SupportStatus.IN_PROGRESS && row.waitingOn === 'CUSTOMER'
      ? 'AWAITING_YOUR_REPLY'
      : row.status,
  legacyResolutionUnknown,
});
export const customerSupportEvent = (event: SupportRequestEvent) => ({
  id: event.id,
  version: event.requestVersion,
  type: event.type,
  body: event.body,
  author: event.actorType === 'CUSTOMER' ? 'You' : 'Autoflex Support',
  createdAt: event.createdAt,
});
