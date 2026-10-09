import { createHash, randomUUID } from 'crypto';
import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { CommandIdempotency } from '../idempotency/command-idempotency.entity';

export interface CommandRequest {
  method: string;
  originalUrl: string;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}
export interface CommandMeta {
  key?: string;
  hash: string;
  version?: number;
  status: number;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export function commandMeta(
  req: CommandRequest,
  body: unknown,
  status = 200,
  creation = false,
): CommandMeta {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
    throw new BadRequestException('Send a JSON object body');
  const key = req.headers['idempotency-key'];
  if (
    (!creation && !key) ||
    (key !== undefined &&
      (typeof key !== 'string' || !/^[A-Za-z0-9_.:-]{8,128}$/.test(key)))
  )
    throw new BadRequestException(
      'Idempotency-Key must be 8–128 letters, digits, or . _ : -',
    );
  let version: number | undefined;
  if (!creation) {
    const header = req.headers['if-match'];
    const match =
      typeof header === 'string'
        ? /^(?:([1-9]\d*)|"([1-9]\d*)")$/.exec(header)
        : null;
    version = match ? Number(match[1] ?? match[2]) : NaN;
    if (!Number.isSafeInteger(version))
      throw new BadRequestException(
        'If-Match must be a positive request version',
      );
  }
  // Creation preserves receipts written by the previous global interceptor.
  const text = creation
    ? `${req.method} ${req.originalUrl.split('?')[0]} ${JSON.stringify(req.body ?? null)}`
    : `${req.method} ${req.originalUrl.split('?')[0]} ${JSON.stringify(canonical(body))} ${version}`;
  return {
    key: key as string | undefined,
    hash: createHash('sha256').update(text).digest('hex'),
    version,
    status,
  };
}
export async function withSupportReceipt<T extends object>(
  manager: EntityManager,
  auth: AuthContext,
  meta: CommandMeta,
  action: () => Promise<T>,
  authorizeReplay?: (value: T) => Promise<void>,
): Promise<T> {
  if (!meta.key) return action();
  const scope =
    auth.actorType === 'support'
      ? `support:${auth.supportAgentProfileId}`
      : `customer:${auth.userId}`;
  const repo = manager.getRepository(CommandIdempotency);
  const id = randomUUID();
  // PostgreSQL waits here for a concurrent transaction owning this same key.
  // Never recover from a unique violation inside an already-aborted transaction.
  await repo
    .createQueryBuilder()
    .insert()
    .values({
      id,
      scope,
      idempotencyKey: meta.key,
      requestHash: meta.hash,
      responseStatus: meta.status,
      responseBody: null,
    })
    .orIgnore()
    .execute();
  const receipt = await repo.findOneOrFail({
    where: { scope, idempotencyKey: meta.key },
  });
  if (receipt.id !== id) {
    if (receipt.requestHash !== meta.hash)
      throw new UnprocessableEntityException(
        'This Idempotency-Key was already used for a different request',
      );
    if (!receipt.responseBody)
      throw new Error('A completed command receipt is missing its response');
    const value = receipt.responseBody as T;
    if (authorizeReplay) await authorizeReplay(value);
    return value;
  }
  const value = await action();
  await repo.save({ id, responseBody: value as Record<string, unknown> });
  return value;
}
