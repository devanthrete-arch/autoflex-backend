import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';

/**
 * Reads the `If-Match` header as an integer record version. Quotes are
 * allowed (`"3"`, `W/"3"`). Absent means "apply to whatever is current".
 */
export const IfMatchVersion = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): number | undefined => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined> }>();
    const raw = request.headers['if-match'];
    if (raw === undefined || raw === '') return undefined;
    const value = Number(raw.replace(/^W\//, '').replace(/"/g, '').trim());
    if (!Number.isInteger(value) || value < 1) {
      throw new BadRequestException('If-Match must be a record version number');
    }
    return value;
  },
);
