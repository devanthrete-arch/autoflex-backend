import { EntityManager } from 'typeorm';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import {
  CommandMeta,
  withCommandReceipt,
} from '../idempotency/transactional-receipt';
export { commandMeta } from '../idempotency/transactional-receipt';
export type {
  CommandMeta,
  CommandRequest,
} from '../idempotency/transactional-receipt';

export async function withSupportReceipt<T extends object>(
  manager: EntityManager,
  auth: AuthContext,
  meta: CommandMeta,
  action: () => Promise<T>,
  authorizeReplay?: (value: T) => Promise<void>,
): Promise<T> {
  const scope =
    auth.actorType === 'support'
      ? `support:${auth.supportAgentProfileId}`
      : `customer:${auth.userId}`;
  return withCommandReceipt(manager, scope, meta, action, authorizeReplay);
}
