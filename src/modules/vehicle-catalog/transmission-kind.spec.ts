import { transmissionKind } from './transmission-kind';

describe('transmissionKind', () => {
  it.each([
    ['5MT', 'manual'],
    ['6MT', 'manual'],
    ['6iMT', 'manual'],
    ['5AMT', 'automatic'],
    ['CVT', 'automatic'],
    ['7DCA', 'automatic'],
    ['1EV', 'automatic'],
  ] as const)('%s is %s', (code, kind) => {
    expect(transmissionKind(code)).toBe(kind);
  });
});
