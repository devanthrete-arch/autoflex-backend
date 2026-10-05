import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_STAFF_KEY } from '../decorators/require-staff.decorator';
import {
  AUTH_CONTEXT_KEY,
  AuthContext,
} from '../interfaces/auth-context.interface';

@Injectable()
export class StaffActorGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_STAFF_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required) {
      return true;
    }

    const authContext = context
      .switchToHttp()
      .getRequest<{ [AUTH_CONTEXT_KEY]?: AuthContext }>()[AUTH_CONTEXT_KEY];

    if (
      authContext?.actorType !== 'staff' ||
      !authContext.serviceCenterId ||
      !authContext.staffProfileId
    ) {
      throw new ForbiddenException('Staff token required');
    }

    return true;
  }
}
