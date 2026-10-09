import {
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SupportStatus } from '../../common/enums/ownership.enum';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { SupportRequest } from './support-request.entity';
import { SupportEventType } from './support-request-event.entity';
import { supportConflict } from './support-errors';
import { SupportCommandBody } from './dto/support-workflow.dto';

export type SupportCommand =
  | 'claim'
  | 'assign'
  | 'release'
  | 'notes'
  | 'replies'
  | 'wait'
  | 'priority'
  | 'resolve'
  | 'close'
  | 'reopen'
  | 'customerReply';
export function isSupportManager(auth: AuthContext): boolean {
  return (
    auth.roles.includes('support_manager') &&
    auth.permissions.includes('support:manage')
  );
}
export function authorizeSupportCommand(
  auth: AuthContext,
  command: SupportCommand,
): void {
  if (command === 'customerReply') {
    if (auth.actorType !== 'customer')
      throw new ForbiddenException('Customer account required');
    return;
  }
  const managerCommand = ['assign', 'close', 'reopen'].includes(command);
  if (
    auth.actorType !== 'support' ||
    !auth.supportAgentProfileId ||
    !auth.roles.some((role) =>
      ['support_agent', 'support_manager'].includes(role),
    ) ||
    !auth.permissions.includes('support:read') ||
    (managerCommand
      ? !isSupportManager(auth)
      : !auth.permissions.includes('support:work'))
  )
    throw new ForbiddenException('This support command is not permitted');
}
export function supportTransition(
  row: SupportRequest,
  auth: AuthContext,
  command: SupportCommand,
  body: SupportCommandBody,
  now: Date,
  previousAssigneeActive = false,
): {
  changes: Partial<SupportRequest>;
  type: SupportEventType;
  visibility: 'INTERNAL' | 'PUBLIC';
  body: string | null;
} {
  authorizeSupportCommand(auth, command);
  const active = [SupportStatus.OPEN, SupportStatus.IN_PROGRESS].includes(
    row.status,
  );
  const conflict = (message: string) => {
    throw supportConflict('SUPPORT_STATE_CONFLICT', message);
  };
  if (
    !['claim', 'assign', 'customerReply', 'close', 'reopen'].includes(command)
  ) {
    if (row.status !== SupportStatus.IN_PROGRESS)
      conflict('Claim an active request before working on it');
    if (
      row.assignedAgentProfileId !== auth.supportAgentProfileId &&
      !isSupportManager(auth)
    )
      throw new ForbiddenException(
        'This request is assigned to another operator',
      );
  }
  let changes: Partial<SupportRequest> = {};
  let type: SupportEventType;
  let visibility: 'INTERNAL' | 'PUBLIC' = 'INTERNAL';
  let text: string | null = body.message ?? body.reason ?? null;
  const clearResolution = {
    resolutionCode: null,
    resolutionSummary: null,
    resolvedAt: null,
    closureSummary: null,
    closedAt: null,
  };
  switch (command) {
    case 'claim':
      if (row.status !== SupportStatus.OPEN || row.assignedAgentProfileId)
        throw supportConflict(
          'SUPPORT_ALREADY_ASSIGNED',
          'This request is already assigned or no longer open',
        );
      changes = {
        status: SupportStatus.IN_PROGRESS,
        assignedAgentProfileId: auth.supportAgentProfileId!,
      };
      type = 'CLAIMED';
      break;
    case 'assign':
      if (!active) conflict('Only active requests can be assigned');
      if (row.assignedAgentProfileId === body.assignedAgentProfileId)
        conflict('This operator already owns the request');
      if (row.assignedAgentProfileId && !body.reason)
        throw new UnprocessableEntityException(
          'Give a reason for reassignment',
        );
      changes = {
        status: SupportStatus.IN_PROGRESS,
        assignedAgentProfileId: body.assignedAgentProfileId!,
      };
      type = 'ASSIGNED';
      break;
    case 'release':
      changes = {
        status: SupportStatus.OPEN,
        assignedAgentProfileId: null,
        waitingOn: null,
      };
      type = 'RELEASED';
      break;
    case 'notes':
      type = 'INTERNAL_NOTE';
      break;
    case 'replies':
      changes = { waitingOn: body.awaitCustomerReply ? 'CUSTOMER' : null };
      type = 'PUBLIC_REPLY';
      visibility = 'PUBLIC';
      break;
    case 'wait':
      if (row.waitingOn === body.waitingOn)
        conflict('This waiting state is already set');
      changes = { waitingOn: body.waitingOn };
      type = 'WAITING_CHANGED';
      break;
    case 'priority':
      if (row.priority === body.priority)
        conflict('This priority is already set');
      changes = { priority: body.priority };
      type = 'PRIORITY_CHANGED';
      break;
    case 'resolve':
      changes = {
        status: SupportStatus.RESOLVED,
        waitingOn: null,
        resolutionCode: body.resolutionCode,
        resolutionSummary: body.message,
        resolvedAt: now,
      };
      type = 'RESOLVED';
      visibility = 'PUBLIC';
      break;
    case 'close':
      if (row.status !== SupportStatus.RESOLVED)
        conflict('Resolve the request before closing it');
      changes = {
        status: SupportStatus.CLOSED,
        closedAt: now,
        closureSummary: body.message,
      };
      type = 'CLOSED';
      visibility = 'PUBLIC';
      break;
    case 'reopen':
      if (![SupportStatus.RESOLVED, SupportStatus.CLOSED].includes(row.status))
        conflict('Only resolved or closed requests can be reopened');
      changes = {
        ...clearResolution,
        status: SupportStatus.OPEN,
        assignedAgentProfileId: null,
        waitingOn: null,
      };
      type = 'REOPENED';
      visibility = 'PUBLIC';
      break;
    case 'customerReply':
      if (row.status === SupportStatus.CLOSED)
        throw supportConflict(
          'SUPPORT_REQUEST_CLOSED',
          'This request is closed. Create a new request for further help.',
        );
      if (row.status === SupportStatus.RESOLVED)
        changes = {
          ...clearResolution,
          status: previousAssigneeActive
            ? SupportStatus.IN_PROGRESS
            : SupportStatus.OPEN,
          assignedAgentProfileId: previousAssigneeActive
            ? row.assignedAgentProfileId
            : null,
          waitingOn: null,
        };
      else if (row.waitingOn === 'CUSTOMER') changes = { waitingOn: null };
      changes.lastCustomerMessageAt = now;
      changes.lastCustomerMessageVersion = row.version + 1;
      type = 'CUSTOMER_REPLY';
      visibility = 'PUBLIC';
      break;
  }
  if (visibility === 'PUBLIC' && command !== 'customerReply') {
    changes.lastPublicReplyAt = now;
    changes.lastPublicReplyVersion = row.version + 1;
    if (!row.firstResponseAt) changes.firstResponseAt = now;
  }
  return { changes, type: type!, visibility, body: text };
}
