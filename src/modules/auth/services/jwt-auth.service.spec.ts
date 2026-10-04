import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createJwtTestFixture } from '../../../test-utils/jwt-test.helper';
import { JwtAuthService, JwksService } from './jwt-auth.service';

describe('JwtAuthService', () => {
  let fixture: Awaited<ReturnType<typeof createJwtTestFixture>>;
  let jwtAuthService: JwtAuthService;
  let jwksService: JwksService;

  beforeAll(async () => {
    fixture = await createJwtTestFixture();
    process.env.LOCAL_JWKS_JSON = fixture.jwksJson;

    const configService = {
      get: (key: string, defaultValue?: string) => {
        const values: Record<string, string> = {
          LOCAL_JWKS_JSON: fixture.jwksJson,
          JWKS_CACHE_TTL_MS: '300000',
        };
        return values[key] ?? defaultValue;
      },
    } as ConfigService;

    jwksService = new JwksService(configService);
    jwtAuthService = new JwtAuthService(jwksService, configService);
  });

  it('verifies a valid RS256 access token', async () => {
    const token = await fixture.signAccessToken();
    const payload = await jwtAuthService.verifyAccessToken(token);

    expect(payload.sub).toBe('user-123');
    expect(payload.domainId).toBe('domain-123');
    expect(payload.type).toBe('access');
    expect(payload.roles).toContain('advisor');
  });

  it('rejects malformed tokens', async () => {
    await expect(jwtAuthService.verifyAccessToken('not-a-jwt')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects expired tokens', async () => {
    const token = await fixture.signAccessToken({}, { expiresIn: '-1s' });
    await expect(jwtAuthService.verifyAccessToken(token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects non-access token types', async () => {
    const token = await fixture.signAccessToken({ type: 'refresh' });
    await expect(jwtAuthService.verifyAccessToken(token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects tokens signed with an unknown key id after cache invalidation', async () => {
    const token = await fixture.signAccessToken({}, { kid: 'unknown-kid' });
    jwksService.invalidateCache();
    await expect(jwtAuthService.verifyAccessToken(token)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
