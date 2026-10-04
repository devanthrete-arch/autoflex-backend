import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  JWTVerifyGetKey,
  JWK,
} from 'jose';
import { IamTokenPayload } from '../interfaces/auth-context.interface';

export interface JwksProvider {
  getVerifyKey(): Promise<JWTVerifyGetKey>;
  invalidateCache(): void;
}

@Injectable()
export class JwksService implements JwksProvider {
  private readonly logger = new Logger(JwksService.name);
  private cachedVerifyKey: JWTVerifyGetKey | null = null;
  private cacheExpiresAt = 0;
  private readonly cacheTtlMs: number;
  private readonly jwksUrl: string;
  private readonly expectedIssuer?: string;
  private readonly expectedAudience?: string;
  private readonly localJwksOverride?: { keys: JWK[] };

  constructor(private readonly configService: ConfigService) {
    this.jwksUrl = this.configService.get<string>('IAM_JWKS_URL', '');
    this.cacheTtlMs = Number(
      this.configService.get<string>('JWKS_CACHE_TTL_MS', '300000'),
    );
    this.expectedIssuer = this.configService.get<string>('IAM_JWT_ISSUER');
    this.expectedAudience = this.configService.get<string>('IAM_JWT_AUDIENCE');

    const localJwksJson = this.configService.get<string>('LOCAL_JWKS_JSON');
    if (localJwksJson) {
      this.localJwksOverride = JSON.parse(localJwksJson) as { keys: JWK[] };
    }
  }

  invalidateCache(): void {
    this.cachedVerifyKey = null;
    this.cacheExpiresAt = 0;
  }

  getVerifyKey(): Promise<JWTVerifyGetKey> {
    const now = Date.now();
    if (this.cachedVerifyKey && now < this.cacheExpiresAt) {
      return Promise.resolve(this.cachedVerifyKey);
    }

    if (this.localJwksOverride) {
      this.cachedVerifyKey = createLocalJWKSet(this.localJwksOverride);
      this.cacheExpiresAt = now + this.cacheTtlMs;
      return Promise.resolve(this.cachedVerifyKey);
    }

    if (!this.jwksUrl) {
      return Promise.reject(new Error('IAM_JWKS_URL is not configured'));
    }

    this.logger.debug(`Refreshing JWKS from ${this.jwksUrl}`);
    this.cachedVerifyKey = createRemoteJWKSet(new URL(this.jwksUrl));
    this.cacheExpiresAt = now + this.cacheTtlMs;
    return Promise.resolve(this.cachedVerifyKey);
  }
}

@Injectable()
export class JwtAuthService {
  constructor(
    private readonly jwksService: JwksService,
    private readonly configService: ConfigService,
  ) {}

  async verifyAccessToken(token: string): Promise<IamTokenPayload> {
    if (!token || token.split('.').length !== 3) {
      throw new UnauthorizedException('Malformed JWT');
    }

    const verifyKey = await this.jwksService.getVerifyKey();
    const expectedIssuer = this.configService.get<string>('IAM_JWT_ISSUER');
    const expectedAudience = this.configService.get<string>('IAM_JWT_AUDIENCE');

    try {
      const { payload } = await jwtVerify(token, verifyKey, {
        algorithms: ['RS256'],
        issuer: expectedIssuer || undefined,
        audience: expectedAudience || undefined,
      });

      const typedPayload = payload as unknown as IamTokenPayload;

      if (typedPayload.type !== 'access') {
        throw new UnauthorizedException('Invalid token type');
      }

      if (!typedPayload.sub) {
        throw new UnauthorizedException('Token missing subject');
      }

      if (!typedPayload.domainId) {
        throw new UnauthorizedException('Token missing domainId');
      }

      if (!typedPayload.domainApplicationId) {
        throw new UnauthorizedException('Token missing domainApplicationId');
      }

      return typedPayload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
