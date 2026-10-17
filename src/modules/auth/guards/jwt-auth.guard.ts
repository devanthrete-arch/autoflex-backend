import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportAgentProfile } from '../../support-identity/support-agent-profile.entity';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtAuthService: JwtAuthService,
    private readonly tenancyService: TenancyService,
    private readonly customerProfilesService: CustomerProfilesService,
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    @InjectRepository(SupportAgentProfile)
    private readonly supportProfiles: Repository<SupportAgentProfile>,
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

    const supportAppId = this.configService.get<string>(
      'IAM_SUPPORT_DOMAIN_APPLICATION_ID',
    );
    const supportDomainId = this.configService.get<string>(
      'IAM_SUPPORT_DOMAIN_ID',
    );
    const financeAppId = this.configService.get<string>(
      'IAM_FINANCE_DOMAIN_APPLICATION_ID',
    );
    const financeDomainId = this.configService.get<string>(
      'IAM_FINANCE_DOMAIN_ID',
    );
    if (financeAppId && payload.domainApplicationId === financeAppId) {
      if (
        !financeDomainId ||
        payload.domainId !== financeDomainId ||
        financeAppId === customerAppId ||
        financeAppId === supportAppId ||
        financeDomainId === supportDomainId ||
        !payload.roles?.some((role) =>
          ['finance_operator', 'finance_reviewer'].includes(role),
        )
      ) {
        throw new ForbiddenException(
          'Finance identity configuration, domain, or role is invalid',
        );
      }
      return {
        actorType: 'finance',
        userId: payload.sub,
        domainId: payload.domainId,
        domainApplicationId: payload.domainApplicationId,
        roles: payload.roles ?? [],
        permissions: payload.permissions ?? [],
        serviceCenterId: null,
        staffProfileId: null,
        customerProfileId: null,
      };
    }
    // Central finance identities must never resolve as ordinary staff/customer
    // when IAM configuration is missing or their application claim is wrong.
    if (
      (financeDomainId && payload.domainId === financeDomainId) ||
      payload.roles?.some((role) =>
        ['finance_operator', 'finance_reviewer'].includes(role),
      )
    ) {
      throw new ForbiddenException(
        'Finance application identity is not configured or does not match',
      );
    }
    if (supportAppId && payload.domainApplicationId === supportAppId) {
      if (
        supportAppId === customerAppId ||
        !supportDomainId ||
        payload.domainId !== supportDomainId
      ) {
        throw new ForbiddenException(
          'Support identity configuration or domain is invalid',
        );
      }
      const profile = await this.supportProfiles.findOne({
        where: {
          iamDomainId: supportDomainId,
          iamUserId: payload.sub,
          isActive: true,
        },
      });
      if (!profile)
        throw new ForbiddenException('This support operator is unavailable');
      return {
        actorType: 'support',
        userId: payload.sub,
        domainId: payload.domainId,
        domainApplicationId: payload.domainApplicationId,
        roles: payload.roles ?? [],
        permissions: payload.permissions ?? [],
        serviceCenterId: null,
        staffProfileId: null,
        customerProfileId: null,
        supportAgentProfileId: profile.id,
      };
    }

    // A support claim or central support domain must never fall through into
    // a customer/center mapping when application configuration is absent/wrong.
    if (
      (supportDomainId && payload.domainId === supportDomainId) ||
      payload.roles?.some((role) =>
        ['support_agent', 'support_manager'].includes(role),
      )
    ) {
      throw new ForbiddenException(
        'Support application identity is not configured or does not match',
      );
    }

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
