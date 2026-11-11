// Helpers for typing round scores. Kept free of React so they can be unit-tested.

export const MAX_SCORE_DIGITS = 4; // matches the server limit of ±1000

/**
 * Keeps digits and at most one leading minus sign. Phone numeric keypads often lack a
 * minus key, so the sign is also toggled with a button; typing "-" still works on desktops.
 */
export function sanitizeScore(raw: string): string {
  const negative = raw.startsWith('-');
  const digits = raw.replace(/\D/g, '').slice(0, MAX_SCORE_DIGITS);
  return (negative ? '-' : '') + digits;
}

/** Flips the sign of the typed value. An empty field becomes "-" so the user can type the number next. */
export function toggleSign(raw: string): string {
  if (raw.startsWith('-')) return raw.slice(1);
  return raw === '' ? '-' : `-${raw}`;
}

/** Parses a typed score, or null if it isn't a usable whole number. */
export function parseScore(raw: string): number | null {
  if (!/^-?\d+$/.test(raw)) return null;
  return Number(raw);
}
