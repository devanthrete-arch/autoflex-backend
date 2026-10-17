import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_FINANCE_KEY } from '../decorators/require-finance.decorator';
import {
  AUTH_CONTEXT_KEY,
  AuthContext,
} from '../interfaces/auth-context.interface';

@Injectable()
export class FinanceActorGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      !this.reflector.getAllAndOverride<boolean>(REQUIRE_FINANCE_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const auth = context
      .switchToHttp()
      .getRequest<{ [AUTH_CONTEXT_KEY]?: AuthContext }>()[AUTH_CONTEXT_KEY];
    if (
      auth?.actorType !== 'finance' ||
      !auth.roles.some((role) =>
        ['finance_operator', 'finance_reviewer'].includes(role),
      )
    ) {
      throw new ForbiddenException(
        'An authorized Autoflex finance account is required',
      );
    }
    return true;
  }
}
