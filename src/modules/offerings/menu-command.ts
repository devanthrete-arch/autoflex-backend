import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { commandMeta } from '../idempotency/transactional-receipt';

export function menuCommand(req: Request, body: object, creation = false) {
  for (const name of creation
    ? ['idempotency-key']
    : ['idempotency-key', 'if-match']) {
    if (
      req.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === name)
        .length !== 1
    )
      throw new BadRequestException(`Exactly one ${name} header is required`);
  }
  // DELETE has no representation to validate; use an empty command body for its receipt.
  const commandRequest =
    req.method === 'DELETE' && req.body === undefined
      ? {
          method: req.method,
          originalUrl: req.originalUrl,
          headers: req.headers,
          body: {},
        }
      : req;
  const meta = commandMeta(
    commandRequest,
    body,
    creation ? 201 : 200,
    creation,
  );
  if (!creation && (!meta.version || meta.version > 2147483646))
    throw new BadRequestException('Invalid menu version');
  return meta;
}
