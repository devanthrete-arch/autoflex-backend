import type { Request } from 'express';
import { billingCommandMeta } from './billing-config.controller';

describe('finance command headers', () => {
  const body = { evidenceReference: 'reviewed-pack' };
  function request(rawHeaders: string[]): Request {
    return {
      method: 'POST',
      originalUrl: '/configuration',
      body,
      rawHeaders,
      headers: { 'if-match': '1', 'idempotency-key': 'finance-key' },
    } as Request;
  }
  it('requires exactly one copy of each command header', () => {
    expect(
      billingCommandMeta(
        request(['If-Match', '1', 'Idempotency-Key', 'finance-key']),
        body,
      ),
    ).toMatchObject({ version: 1, key: 'finance-key' });
    expect(() =>
      billingCommandMeta(
        request([
          'If-Match',
          '1',
          'If-Match',
          '1',
          'Idempotency-Key',
          'finance-key',
        ]),
        body,
      ),
    ).toThrow('Send exactly one if-match');
    expect(() => billingCommandMeta(request(['If-Match', '1']), body)).toThrow(
      'Send exactly one idempotency-key',
    );
  });
});
