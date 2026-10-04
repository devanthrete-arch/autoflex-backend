import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtAuthService } from '../services/jwt-auth.service';
import { TenancyService } from '../../tenancy/tenancy.service';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import {
  AUTH_CONTEXT_KEY,
  AuthContext,
  IamTokenPayload,
} from '../interfaces/auth-context.interface';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtAuthService: JwtAuthService,
    private readonly tenancyService: TenancyService,
    private readonly customerProfilesService: CustomerProfilesService,
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      [AUTH_CONTEXT_KEY]?: AuthContext;
    }>();

    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid Authorization header',
      );
    }

    const token = authorization.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: IamTokenPayload;
    try {
      payload = await this.jwtAuthService.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    request[AUTH_CONTEXT_KEY] = await this.buildAuthContext(payload);
    return true;
  }

  private async buildAuthContext(
    payload: IamTokenPayload,
  ): Promise<AuthContext> {
    const customerAppId = this.configService.get<string>(
      'IAM_CUSTOMER_DOMAIN_APPLICATION_ID',
    );

    if (customerAppId && payload.domainApplicationId === customerAppId) {
      const profile = await this.customerProfilesService.findByIamUserId(
        payload.sub,
      );
      return {
        actorType: 'customer',
        userId: payload.sub,
        domainId: payload.domainId,
        domainApplicationId: payload.domainApplicationId,
        roles: payload.roles ?? [],
        permissions: payload.permissions ?? [],
        serviceCenterId: null,
        staffProfileId: null,
        customerProfileId: profile?.id ?? null,
        phone: payload.mobile,
      };
    }

    const mapping = await this.tenancyService.resolveTenantContext(
      payload.domainId,
      payload.sub,
    );

    return {
      actorType: 'staff',
      userId: payload.sub,
      domainId: payload.domainId,
      domainApplicationId: payload.domainApplicationId,
      roles: payload.roles ?? [],
      permissions: payload.permissions ?? [],
      serviceCenterId: mapping.serviceCenter.id,
      staffProfileId: mapping.staffProfile.id,
      customerProfileId: null,
      phone: payload.mobile,
    };
  }
}
