/**
 * Limitless has served market prices both as 0–100 cents (early 2026) and
 * 0–1 decimals (current), and expirationTimestamp both in seconds and
 * milliseconds. Normalize defensively based on magnitude.
 */

export function priceDecimal(p: number): number {
  return p > 1 ? p / 100 : p;
}

export function priceCents(p: number): number {
  return p > 1 ? p : p * 100;
}

export function tsMillis(t: number): number {
  return t > 1e12 ? t : t * 1000;
}
