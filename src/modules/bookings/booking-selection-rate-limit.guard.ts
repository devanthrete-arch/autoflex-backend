import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';

export const BOOKING_SELECTION_LIMITS = {
  windowMs: 60_000,
  maxRequests: 60,
  maxClients: 10_000,
} as const;

type Window = { expiresAt: number; count: number };

/** Per-instance burst protection for public previews, shared across all centers. */
@Injectable()
export class BookingSelectionRateLimitGuard implements CanActivate {
  private readonly clients = new Map<string, Window>();
  private lastSweep = 0;

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    // Express only accepts forwarded IPs when a trusted proxy is configured.
    // Never key this limit directly from a caller-supplied forwarding header.
    const client = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    if (now - this.lastSweep >= BOOKING_SELECTION_LIMITS.windowMs) {
      for (const [key, window] of this.clients) {
        if (window.expiresAt <= now) this.clients.delete(key);
      }
      this.lastSweep = now;
    }
    let window = this.clients.get(client);
    if (window && window.expiresAt <= now) {
      this.clients.delete(client);
      window = undefined;
    }
    if (!window) {
      if (this.clients.size >= BOOKING_SELECTION_LIMITS.maxClients)
        this.reject(response, BOOKING_SELECTION_LIMITS.windowMs);
      window = { count: 0, expiresAt: now + BOOKING_SELECTION_LIMITS.windowMs };
      this.clients.set(client, window);
    }
    if (window.count >= BOOKING_SELECTION_LIMITS.maxRequests)
      this.reject(response, window.expiresAt - now);
    window.count += 1;
    return true;
  }

  private reject(response: Response, waitMs: number): never {
    const retryAfterSeconds = Math.max(1, Math.ceil(waitMs / 1000));
    response.setHeader('Retry-After', String(retryAfterSeconds));
    response.setHeader('Cache-Control', 'no-store');
    throw new HttpException(
      {
        code: 'BOOKING_PREVIEW_RATE_LIMITED',
        message: `Too many menu checks. Please try again in ${retryAfterSeconds} seconds.`,
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
