import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import {
  AUTH_CONTEXT_KEY,
  type AuthContext,
} from '../auth/interfaces/auth-context.interface';
/** Per-process budget. The deployment gateway must provide the replica-wide limit. */
@Injectable()
export class ReceptionRateLimitGuard implements CanActivate {
  private buckets = new Map<string, { at: number; count: number }>();
  canActivate(ctx: ExecutionContext) {
    const http = ctx.switchToHttp();
    const auth = http.getRequest<{ [AUTH_CONTEXT_KEY]?: AuthContext }>()[
      AUTH_CONTEXT_KEY
    ];
    if (!auth) return false;
    const now = Date.now();
    for (const [key, value] of this.buckets)
      if (now - value.at >= 60000) this.buckets.delete(key);
    const key = `${auth.actorType}:${auth.domainId}:${auth.userId}`;
    let value = this.buckets.get(key);
    if (!value) {
      if (this.buckets.size >= 5000)
        throw new HttpException('Requests temporarily busy', 429);
      value = { at: now, count: 0 };
      this.buckets.set(key, value);
    }
    if (value.count++ >= 40) {
      const seconds = Math.max(1, Math.ceil((value.at + 60000 - now) / 1000));
      http
        .getResponse<{ setHeader: (a: string, b: string) => void }>()
        .setHeader('Retry-After', String(seconds));
      throw new HttpException(
        {
          code: 'ACTOR_RATE_LIMITED',
          message: 'Wait before checking this request again.',
          retryAfterSeconds: seconds,
        },
        429,
      );
    }
    return true;
  }
}
