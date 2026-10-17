import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  AUTH_CONTEXT_KEY,
  AuthContext,
} from '../auth/interfaces/auth-context.interface';
const KEY = 'billingWriteAction';

/** Runs before idempotency replay, including while the legacy rollout is active. */
@Injectable()
export class BillingWriteGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}
  canActivate(context: ExecutionContext) {
    const action = this.reflector.get<'issue' | 'close'>(
      KEY,
      context.getHandler(),
    );
    const auth = context
      .switchToHttp()
      .getRequest<{ [AUTH_CONTEXT_KEY]?: AuthContext }>()[AUTH_CONTEXT_KEY];
    const modern = this.config.get('BILLING_V2_ENABLED') === 'true';
    const required = modern
      ? [action === 'close' ? 'billing:record-payment' : 'billing:issue']
      : ['billing:manage'];
    if (action === 'close') required.push('jobs:update');
    if (
      !auth ||
      auth.actorType !== 'staff' ||
      !required.every((p) => auth.permissions.includes(p))
    )
      throw new ForbiddenException(
        'The required billing permission is unavailable',
      );
    return true;
  }
}
export const BillingWrite = (action: 'issue' | 'close') =>
  applyDecorators(SetMetadata(KEY, action), UseGuards(BillingWriteGuard));
