/** Manual when the published code is a manual gearbox, including clutchless iMT. AMT is automatic. */
export function transmissionKind(gearboxCode: string): 'manual' | 'automatic' {
  const code = gearboxCode.toUpperCase();
  if (code.includes('AMT')) return 'automatic';
  if (code.endsWith('MT')) return 'manual';
  return 'automatic';
}
