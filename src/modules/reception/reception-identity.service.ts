import {
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JSONWebKeySet,
} from 'jose';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { canonicalIntakePhone } from '../jobs/intake-identity';
/** Proposed broker assertion contract. Never infer verification from an editable profile. */
@Injectable()
export class ReceptionIdentityService {
  private key?: JWTVerifyGetKey;
  constructor(private readonly config: ConfigService) {}
  get ready() {
    return !!(
      this.config.get('RECEPTION_IDENTITY_ISSUER') &&
      this.config.get('RECEPTION_IDENTITY_AUDIENCE') &&
      (this.config.get('RECEPTION_IDENTITY_JWKS_URL') ||
        (process.env.NODE_ENV !== 'production' &&
          this.config.get('RECEPTION_IDENTITY_LOCAL_JWKS')))
    );
  }
  async acquire(
    auth: AuthContext,
    sessionId: string,
    phone: string,
  ): Promise<{ assertion: string }> {
    const endpoint = this.config.get<string>('RECEPTION_IDENTITY_BROKER_URL');
    const credential = this.config.get<string>(
      'RECEPTION_IDENTITY_BROKER_TOKEN',
    );
    let validEndpoint = false;
    try {
      validEndpoint = !!endpoint && new URL(endpoint).protocol === 'https:';
    } catch {
      /* Invalid configuration is unavailable, not a customer error. */
    }
    if (!validEndpoint || !credential)
      throw new ServiceUnavailableException({
        code: 'RECEPTION_IDENTITY_BROKER_NOT_CONFIGURED',
        message:
          'Phone verification is not available yet. Reception can keep this request and retry when IAM is ready.',
      });
    try {
      const response = await fetch(endpoint!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${credential}`,
          'Idempotency-Key': `reception:${sessionId}:${auth.userId}`,
        },
        body: JSON.stringify({
          sessionId,
          subject: auth.userId,
          domainId: auth.domainId,
          domainApplicationId: auth.domainApplicationId,
          phone,
          purpose: 'reception-registration',
        }),
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      if (!response.ok || !response.body) throw new Error('Broker unavailable');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          size += result.value.byteLength;
          if (size > 16000) throw new Error('Broker response too large');
          chunks.push(result.value);
        }
      } finally {
        await reader.cancel();
      }
      const result = JSON.parse(Buffer.concat(chunks).toString()) as {
        assertion?: unknown;
      };
      if (typeof result.assertion !== 'string')
        throw new Error('Verification is incomplete');
      await this.verify(result.assertion, auth, sessionId, phone);
      return { assertion: result.assertion };
    } catch {
      throw new ServiceUnavailableException({
        code: 'RECEPTION_IDENTITY_RETRY_REQUIRED',
        message:
          'Phone verification is incomplete or unavailable. Retry through IAM; no account link was made.',
      });
    }
  }
  async verify(
    assertion: string,
    auth: AuthContext,
    sessionId: string,
    phone: string,
  ) {
    if (!this.ready)
      throw new ServiceUnavailableException({
        code: 'RECEPTION_IDENTITY_NOT_CONFIGURED',
        message:
          'Verified reception identity is not configured. No account link has been made.',
      });
    try {
      if (!this.key) {
        const local = this.config.get<string>('RECEPTION_IDENTITY_LOCAL_JWKS');
        const url = this.config.get<string>('RECEPTION_IDENTITY_JWKS_URL');
        if (process.env.NODE_ENV !== 'production' && local)
          this.key = createLocalJWKSet(JSON.parse(local) as JSONWebKeySet);
        else {
          if (!url || new URL(url).protocol !== 'https:')
            throw new Error('HTTPS required');
          this.key = createRemoteJWKSet(new URL(url), {
            timeoutDuration: 5000,
          });
        }
      }
      const { payload } = await jwtVerify(assertion, this.key, {
        algorithms: ['RS256'],
        issuer: this.config.get<string>('RECEPTION_IDENTITY_ISSUER'),
        audience: this.config.get<string>('RECEPTION_IDENTITY_AUDIENCE'),
        requiredClaims: ['exp', 'iat', 'sub', 'jti'],
      });
      const now = Math.floor(Date.now() / 1000);
      if (
        payload.purpose !== 'reception-registration' ||
        payload.sessionId !== sessionId ||
        payload.sub !== auth.userId ||
        payload.domainApplicationId !== auth.domainApplicationId ||
        payload.domainId !== auth.domainId ||
        typeof payload.phone !== 'string' ||
        canonicalIntakePhone(payload.phone) !== phone ||
        typeof payload.verifiedAt !== 'number' ||
        payload.verifiedAt > now + 15 ||
        payload.verifiedAt < now - 600 ||
        typeof payload.iat !== 'number' ||
        payload.iat > now + 15 ||
        payload.iat < now - 600 ||
        typeof payload.jti !== 'string' ||
        !payload.jti.trim() ||
        payload.jti.length > 255
      )
        throw new Error('Mismatched evidence');
      return payload.jti;
    } catch {
      throw new UnprocessableEntityException({
        code: 'RECEPTION_IDENTITY_INVALID',
        message: 'Verify this phone through IAM again before consenting.',
      });
    }
  }
}
