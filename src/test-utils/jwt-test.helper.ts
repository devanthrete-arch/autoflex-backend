import { generateKeyPairSync, KeyObject } from 'crypto';
import { exportJWK, SignJWT } from 'jose';
import { IamTokenPayload } from '../modules/auth/interfaces/auth-context.interface';

export interface JwtTestFixture {
  jwksJson: string;
  signAccessToken: (
    overrides?: Partial<IamTokenPayload>,
    options?: { expiresIn?: string; kid?: string },
  ) => Promise<string>;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

export async function createJwtTestFixture(): Promise<JwtTestFixture> {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  const jwk = await exportJWK(publicKey);
  const jwks = {
    keys: [{ ...jwk, alg: 'RS256', use: 'sig', kid: 'test-primary' }],
  };

  const signAccessToken = async (
    overrides: Partial<IamTokenPayload> = {},
    options: { expiresIn?: string; kid?: string } = {},
  ): Promise<string> => {
    const payload: IamTokenPayload = {
      sub: overrides.sub ?? 'user-123',
      domainId: overrides.domainId ?? 'domain-123',
      domainApplicationId: overrides.domainApplicationId ?? 'app-123',
      type: overrides.type ?? 'access',
      roles: overrides.roles ?? ['advisor'],
      permissions: overrides.permissions ?? [
        'jobs:create',
        'jobs:read',
        'jobs:update',
        'jobs:delete',
      ],
      email: overrides.email,
      mobile: overrides.mobile,
    };

    return new SignJWT(payload as unknown as Record<string, unknown>)
      .setProtectedHeader({
        alg: 'RS256',
        kid: options.kid ?? 'test-primary',
      })
      .setSubject(payload.sub)
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? '1h')
      .sign(privateKey);
  };

  return {
    jwksJson: JSON.stringify(jwks),
    signAccessToken,
    privateKey,
    publicKey,
  };
}
