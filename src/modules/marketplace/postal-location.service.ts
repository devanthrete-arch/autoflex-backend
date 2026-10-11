import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

export type PostalLocation = {
  postalCode: string;
  areas: { locality: string; district: string; state: string }[];
  source: 'postalpincode.in';
};

/** Postal directory lookup only: it does not return or invent geographic coordinates. */
@Injectable()
export class PostalLocationService {
  private readonly cache = new Map<
    string,
    { until: number; value: PostalLocation | null }
  >();
  private readonly pending = new Map<string, Promise<PostalLocation>>();

  async lookup(postalCode: string): Promise<PostalLocation> {
    if (!/^[1-9]\d{5}$/.test(postalCode))
      throw new BadRequestException('Enter a valid six-digit Indian PIN code');
    const cached = this.cache.get(postalCode);
    if (cached && cached.until > Date.now()) {
      if (!cached.value)
        throw new NotFoundException('No postal areas found for this PIN code');
      return cached.value;
    }
    const existing = this.pending.get(postalCode);
    if (existing) return existing;
    if (this.pending.size >= 50)
      throw new ServiceUnavailableException(
        'PIN lookup is busy. Please try again.',
      );
    const request = this.load(postalCode).finally(() =>
      this.pending.delete(postalCode),
    );
    this.pending.set(postalCode, request);
    return request;
  }

  private remember(postalCode: string, value: PostalLocation | null) {
    // Bounded cache; failures are never cached as a successful location.
    if (this.cache.size >= 500)
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(postalCode, {
      value,
      until: Date.now() + (value ? 86400000 : 300000),
    });
  }

  private async load(postalCode: string): Promise<PostalLocation> {
    try {
      const response = await fetch(
        `https://api.postalpincode.in/pincode/${postalCode}`,
        {
          signal: AbortSignal.timeout(5000),
          redirect: 'error',
        },
      );
      if (!response.ok) throw new Error('Postal directory unavailable');
      const text = await response.text();
      if (text.length > 500000)
        throw new Error('Unexpected postal directory response');
      const payload: unknown = JSON.parse(text);
      if (
        !Array.isArray(payload) ||
        payload.length !== 1 ||
        !payload[0] ||
        typeof payload[0] !== 'object'
      )
        throw new Error('Unexpected postal directory response');
      const result = payload[0] as Record<string, unknown>;
      if (result.Status === 'Error' && result.PostOffice === null) {
        this.remember(postalCode, null);
        throw new NotFoundException('No postal areas found for this PIN code');
      }
      if (result.Status !== 'Success' || !Array.isArray(result.PostOffice))
        throw new Error('Unexpected postal directory response');
      const clean = (v: unknown) =>
        typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 100
          ? v.trim()
          : null;
      const areas = new Map<string, PostalLocation['areas'][number]>();
      for (const raw of result.PostOffice) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const locality = clean(row.Name),
          district = clean(row.District),
          state = clean(row.State);
        if (
          row.Pincode !== postalCode ||
          row.Country !== 'India' ||
          !locality ||
          !district ||
          !state
        )
          continue;
        const area = { locality, district, state };
        areas.set(JSON.stringify(area), area);
      }
      if (!areas.size) throw new Error('Unexpected postal directory response');
      const value: PostalLocation = {
        postalCode,
        areas: [...areas.values()].sort((a, b) =>
          a.locality.localeCompare(b.locality),
        ),
        source: 'postalpincode.in',
      };
      this.remember(postalCode, value);
      return value;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new ServiceUnavailableException(
        'PIN lookup is unavailable. Retry, use your location, or skip for now.',
      );
    }
  }
}
