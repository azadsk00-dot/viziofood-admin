// Money helpers — integer-cent math, mirroring the web's src/lib/money.ts
// contract. All aggregation happens in cents to avoid float drift.

export function toCents(value: number | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export function aud(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Percent of a cents basis, rounded to whole cents. */
export function percentOfCents(basisCents: number, percent: number): number {
  return Math.round((basisCents * percent) / 100);
}
