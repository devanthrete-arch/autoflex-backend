import { ConflictException } from '@nestjs/common';
export function supportConflict(
  code: string,
  message: string,
  currentVersion?: number,
) {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code,
    message,
    ...(currentVersion === undefined ? {} : { currentVersion }),
  });
}
