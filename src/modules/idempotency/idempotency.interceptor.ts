import { createHash } from 'crypto';
import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { from, Observable, of, switchMap } from 'rxjs';
import { Repository } from 'typeorm';
import { Reflector } from '@nestjs/core';
import { TRANSACTIONAL_COMMAND_KEY } from './transactional-command.decorator';
import {
  AUTH_CONTEXT_KEY,
  AuthContext,
} from '../auth/interfaces/auth-context.interface';
import { CommandIdempotency } from './command-idempotency.entity';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

interface HttpRequest {
  method: string;
  originalUrl: string;
  body: unknown;
  headers: Record<string, string | undefined>;
  [AUTH_CONTEXT_KEY]?: AuthContext;
}

interface HttpResponse {
  statusCode: number;
  status(code: number): HttpResponse;
}

/**
 * Replays the stored response when a mutating request repeats an
 * `Idempotency-Key` from the same actor. Failed requests are not stored, so
 * they can be retried with the same key.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @InjectRepository(CommandIdempotency)
    private readonly repository: Repository<CommandIdempotency>,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const transactional = this.reflector.getAllAndOverride<boolean | string>(
      TRANSACTIONAL_COMMAND_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (
      transactional === true ||
      (typeof transactional === 'string' &&
        this.config.get(transactional) === 'true')
    )
      return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const key = request.headers['idempotency-key'];
    const auth = request[AUTH_CONTEXT_KEY];
    if (!key || !MUTATING.has(request.method) || !auth) {
      return next.handle();
    }
    if (!KEY_PATTERN.test(key)) {
      throw new BadRequestException(
        'Idempotency-Key must be 8–128 letters, digits, or . _ : -',
      );
    }

    const scope =
      auth.actorType === 'support'
        ? `support:${auth.supportAgentProfileId}`
        : auth.actorType === 'staff'
          ? `staff:${auth.staffProfileId}`
          : `customer:${auth.userId}`;
    const requestHash = createHash('sha256')
      .update(
        `${request.method} ${request.originalUrl.split('?')[0]} ${JSON.stringify(request.body ?? null)}`,
      )
      .digest('hex');
    const response = http.getResponse<HttpResponse>();

    return from(
      this.repository.findOne({ where: { scope, idempotencyKey: key } }),
    ).pipe(
      switchMap((stored) => {
        if (stored) {
          if (stored.requestHash !== requestHash) {
            throw new UnprocessableEntityException(
              'This Idempotency-Key was already used for a different request',
            );
          }
          response.status(stored.responseStatus);
          return of(stored.responseBody ?? undefined);
        }
        return next.handle().pipe(
          switchMap(async (body: unknown) => {
            try {
              await this.repository.save(
                this.repository.create({
                  scope,
                  idempotencyKey: key,
                  requestHash,
                  responseStatus: response.statusCode,
                  responseBody: (body ??
                    null) as CommandIdempotency['responseBody'],
                }),
              );
            } catch {
              // A concurrent duplicate stored first; its response is equivalent.
            }
            return body;
          }),
        );
      }),
    );
  }
}
