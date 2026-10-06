// Shared text helpers of the normalizers (Addendum AD-2 steps 1-3). Pure: no clock, no randomness.

/** Placeholder values that mean "no value" (compared case-insensitively after trimming). */
export const PLACEHOLDERS: ReadonlySet<string> = new Set(['n/a', 'na', 'n.a.', '#n/a', 'null', 'none', '-', '--', '–', '—']);

/** `String.prototype.trim` (includes NBSP, U+202F and U+FEFF), the same as V1's `readRaw`. */
export function trimJs(raw: string): string {
  return raw.trim();
}

export function isPlaceholder(raw: string): boolean {
  return PLACEHOLDERS.has(raw.trim().toLowerCase());
}

/** Separator characters allowed between a currency marker and the digits, and as French group separators. */
export const SPACE_LIKE: readonly string[] = [' ', ' ', ' '];

export function isAsciiDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/** What the normalizers report for a cell that carries no evidence. */
export type BlankKind = 'blank' | 'placeholder';

/** Classifies a trimmed-empty or placeholder value; null when the value is real content. */
export function blankKind(raw: string): BlankKind | null {
  const s = trimJs(raw);
  if (s === '') return 'blank';
  return PLACEHOLDERS.has(s.toLowerCase()) ? 'placeholder' : null;
}
