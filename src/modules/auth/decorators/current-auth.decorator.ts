import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  AUTH_CONTEXT_KEY,
  AuthContext,
} from '../interfaces/auth-context.interface';

export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest<{
      [AUTH_CONTEXT_KEY]?: AuthContext;
    }>();
    const authContext = request[AUTH_CONTEXT_KEY];
    if (!authContext) {
      throw new Error('Auth context not found — is JwtAuthGuard applied?');
    }
    return authContext;
  },
);
