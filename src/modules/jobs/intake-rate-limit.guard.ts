import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import {
  AUTH_CONTEXT_KEY,
  AuthContext,
} from '../auth/interfaces/auth-context.interface';

/** Process-local budget, shared across intake reads. Replica-wide limit is external. */
@Injectable()
export class IntakeRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<
    string,
    { started: number; count: number }
  >();
  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const req = http.getRequest<{ [AUTH_CONTEXT_KEY]?: AuthContext }>();
    const auth = req[AUTH_CONTEXT_KEY];
    if (!auth?.staffProfileId || !auth.serviceCenterId) return false;
    const now = Date.now();
    for (const [key, value] of this.buckets)
      if (now - value.started >= 60000) this.buckets.delete(key);
    const key = `${auth.staffProfileId}:${auth.serviceCenterId}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= 5000) this.reject(http.getResponse(), 60);
      bucket = { started: now, count: 0 };
      this.buckets.set(key, bucket);
    }
    if (bucket.count >= 30)
      this.reject(
        http.getResponse(),
        Math.max(1, Math.ceil((bucket.started + 60000 - now) / 1000)),
      );
    bucket.count++;
    return true;
  }
  private reject(
    res: { setHeader(name: string, value: string): void },
    seconds: number,
  ): never {
    res.setHeader('Retry-After', String(seconds));
    throw new HttpException(
      {
        code: 'INTAKE_LOOKUP_RATE_LIMITED',
        message: 'Too many intake lookups; wait and retry',
        retryAfterSeconds: seconds,
      },
      429,
    );
  }
}
