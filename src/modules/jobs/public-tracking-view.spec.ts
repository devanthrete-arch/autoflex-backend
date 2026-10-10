import { maskRegistration, publicCenterPhone } from './job-view';

describe('Public registration masking', () => {
  it.each([
    [null, null],
    [undefined, null],
    ['', null],
    [' -- ', null],
    ['a', '•'],
    ['1234', '••••'],
    ['AB123', '•••••'],
    ['DL1AB123', '••••••••'],
    ['KA01AB1234', 'KA01••1234'],
    [' ka-01 ab 1234 ', 'KA01••1234'],
    ['AB1234567', 'AB12•4567'],
  ])(
    'masks %p as %p without overlapping visible characters',
    (input, expected) => {
      expect(maskRegistration(input)).toBe(expected);
    },
  );
});
describe('Public business contact', () => {
  it.each([
    ['+91 80 2345 6789', '+918023456789'],
    ['08023456789', '+918023456789'],
    ['8023456789', '+918023456789'],
    ['918023456789', '+918023456789'],
    ['+44 (20) 7123-4567', '+442071234567'],
    [null, null],
    ['', null],
    ['123', null],
    ['+0000000000', null],
    ['tel:+918023456789', null],
    ['+918023456789;123', null],
    ['+918023456789?call=1', null],
    ['+91\n8023456789', null],
  ])('returns a dialable number or null for %p', (input, expected) => {
    expect(publicCenterPhone(input)).toBe(expected);
  });
});
