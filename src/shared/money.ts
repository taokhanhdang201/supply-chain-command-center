// Money is always represented as integer cents to avoid floating-point rounding errors.

export type MoneyParse = { ok: true; cents: number } | { ok: false; code: 'INVALID_NUMBER' | 'TOO_MANY_DECIMALS' };

const DECIMAL_FORMAT = /^-?\d+(\.\d+)?$/;

/**
 * Parses a plain decimal string (optionally negative) into integer cents using string splitting, never
 * floating-point multiplication, so values like "0.29" convert to exactly 29 cents.
 */
export function parseDecimalToCents(input: string): MoneyParse {
  if (!DECIMAL_FORMAT.test(input)) return { ok: false, code: 'INVALID_NUMBER' };
  const negative = input.startsWith('-');
  const unsigned = negative ? input.slice(1) : input;
  const [intPart, fracPart = ''] = unsigned.split('.');
  if (fracPart.length > 2) return { ok: false, code: 'TOO_MANY_DECIMALS' };
  const cents = Number(intPart) * 100 + Number(fracPart.padEnd(2, '0'));
  return { ok: true, cents: negative ? -cents : cents };
}

/** Converts integer cents to a dollar float (for computations that require it, never for display formatting). */
export function centsToDollars(cents: number): number {
  return cents / 100;
}
