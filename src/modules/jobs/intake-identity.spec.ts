import {
  canonicalIntakePhone,
  canonicalIntakePlate,
  tryCanonicalPhone,
  tryCanonicalPlate,
} from './intake-identity';

describe('intake identity normalization', () => {
  it.each(['9876543210', '+91 98765-43210', '919876543210', ' 98765 43210 '])(
    'preserves one Indian mobile identity from %s',
    (input) => {
      expect(canonicalIntakePhone(input)).toBe('+919876543210');
    },
  );
  it.each([
    '919876543210123',
    '+19876543210',
    'mobile9876543210',
    '(9876543210)',
    '+91',
    '1234567890',
    '98765432100',
  ])('rejects %s rather than truncating it into another identity', (input) => {
    expect(() => canonicalIntakePhone(input)).toThrow();
    expect(tryCanonicalPhone(input)).toBeNull();
  });
  it.each(['ka 01-ab 1234', 'KA01AB1234'])(
    'preserves the canonical plate for %s',
    (input) => expect(canonicalIntakePlate(input)).toBe('KA01AB1234'),
  );
  it.each(['', '---', '1234567', 'ABCDEFGHI', 'KA/01AB1234'])(
    'refuses invalid legacy plate %s',
    (input) => {
      expect(() => canonicalIntakePlate(input)).toThrow();
      expect(tryCanonicalPlate(input)).toBeNull();
    },
  );
});
