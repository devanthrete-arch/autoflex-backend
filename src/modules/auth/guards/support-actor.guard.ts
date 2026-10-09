import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_SUPPORT_KEY } from '../decorators/require-support.decorator';
import {
  AUTH_CONTEXT_KEY,
  AuthContext,
} from '../interfaces/auth-context.interface';

@Injectable()
export class SupportActorGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    if (
      !this.reflector.getAllAndOverride<boolean>(REQUIRE_SUPPORT_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const auth = context
      .switchToHttp()
      .getRequest<{ [AUTH_CONTEXT_KEY]?: AuthContext }>()[AUTH_CONTEXT_KEY];
    if (
      auth?.actorType !== 'support' ||
      !auth.supportAgentProfileId ||
      !auth.roles.some((role) =>
        ['support_agent', 'support_manager'].includes(role),
      )
    ) {
      throw new ForbiddenException(
        'An authorized Autoflex support account is required',
      );
    }
    return true;
  }
}
