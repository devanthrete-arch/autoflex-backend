/** INR amount as a two-decimal string, whatever the driver returned for `numeric`. */
export function inr(value: string | number | null | undefined): string {
  return Number(value ?? 0).toFixed(2);
}

/** Whole paise, so sums never pick up floating-point drift. */
export function toPaise(value: string | number | null | undefined): number {
  return Math.round(Number(value ?? 0) * 100);
}

export function fromPaise(paise: number): string {
  return (paise / 100).toFixed(2);
}

/** `quantity × unit price`, rounded to the paisa. */
export function lineAmount(
  quantity: string | number,
  unitPrice: string | number,
): string {
  return fromPaise(Math.round(Number(quantity) * toPaise(unitPrice)));
}
