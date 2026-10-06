import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  KeyObject,
} from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { exportJWK, SignJWT } from 'jose';
import { join } from 'path';
import { IamTokenPayload } from '../modules/auth/interfaces/auth-context.interface';
import { JwtTestFixture } from '../test-utils/jwt-test.helper';

const KEY_DIR = join(process.cwd(), '.workshop');
const KEY_FILE = join(KEY_DIR, 'dev-signing-key.json');

interface StoredKey {
  privatePem: string;
  publicPem: string;
}

/**
 * Local stand-in for the IAM signing key. The PEM is written once under
 * `.workshop/` (gitignored) so tokens minted by `POST /v1/dev/session` still
 * verify after the API process restarts. Delete the file to rotate it.
 */
export async function loadWorkshopSigner(): Promise<JwtTestFixture> {
  const { privateKey, publicKey } = await loadOrCreateKeys();
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
      permissions: overrides.permissions ?? [],
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

async function loadOrCreateKeys(): Promise<{
  privateKey: KeyObject;
  publicKey: KeyObject;
}> {
  try {
    const stored = JSON.parse(await readFile(KEY_FILE, 'utf8')) as StoredKey;
    return {
      privateKey: createPrivateKey(stored.privatePem),
      publicKey: createPublicKey(stored.publicPem),
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && code !== 'ENOENT') {
      throw error;
    }
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const stored: StoredKey = {
      privatePem: privateKey
        .export({ type: 'pkcs8', format: 'pem' })
        .toString(),
      publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    };
    await mkdir(KEY_DIR, { recursive: true });
    await writeFile(KEY_FILE, JSON.stringify(stored), { mode: 0o600 });
    return { privateKey, publicKey };
  }
}
