import { randomInt } from 'crypto';
import { IST_OFFSET_MS } from './time/ist';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** `<PREFIX>-YYYYMMDD-XXXX`, dated in IST, without look-alike characters. */
export function generateReference(prefix: string, now = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const date = ist.toISOString().slice(0, 10).replace(/-/g, '');
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${prefix}-${date}-${suffix}`;
}
