// Number presets (Addendum AD-2): plain 1250.50, us 1,250.50, eu 1.250,50, fr 1 250,50. `normalizeNumber` turns a
// text cell into V1's plain syntax (^-?\d+(\.\d+)?$) or rejects it; the V1 parsers then validate the result. Typed
// number cells are never passed through here. Pure and deterministic.

import { SPACE_LIKE, blankKind, isAsciiDigit, trimJs } from './text';

export type NumberPreset = 'plain' | 'us' | 'eu' | 'fr';
export const NUMBER_PRESETS: readonly NumberPreset[] = ['plain', 'us', 'eu', 'fr'];
export const DEFAULT_NUMBER_PRESET: NumberPreset = 'plain';

export const NUMBER_PRESET_EXAMPLE: Record<NumberPreset, string> = {
  plain: '1234.56',
  us: '1,234.56',
  eu: '1.234,56',
  fr: '1 234,56'
};

export const NUMBER_PRESET_LABEL: Record<NumberPreset, string> = {
  plain: 'Plain (1234.56)',
  us: 'Comma thousands, dot decimal (1,234.56)',
  eu: 'Dot thousands, decimal comma (1.234,56)',
  fr: 'Space thousands, decimal comma (1 234,56)'
};

export interface NumberCtx {
  /** true for unit_cost and shipping_cost only: a USD marker is accepted and stripped. */
  money: boolean;
  /** true for avg_daily_usage and lead_time_days: a placeholder reads as blank. */
  optional: boolean;
  /** Internal (detection, column-level currency check): accept any known currency marker and report it. */
  anyCurrency?: boolean;
}

export type NumberResult =
  | { ok: true; value: string; blank?: 'blank' | 'placeholder'; marker?: string }
  | { ok: false; reason: 'syntax' | 'currency'; marker?: string };

/** Known currency symbols and ISO codes (AD-2 step 4); compared case-insensitively. */
export const CURRENCY_TOKENS: ReadonlySet<string> = new Set([
  '€', '£', '¥', '₫', '₹', '₩', '₽', '฿', '₺', '₪', '₱',
  'eur', 'gbp', 'jpy', 'vnd', 'inr', 'cny', 'krw', 'cad', 'aud', 'chf', 'mxn', 'brl', 'sek', 'nok', 'dkk', 'pln', 'czk', 'huf',
  'try', 'aed', 'sgd', 'hkd', 'nzd', 'zar', 'thb', 'idr', 'myr', 'php'
]);

const GRAMMAR: Record<NumberPreset, RegExp> = {
  plain: /^-?\d+(\.\d+)?$/,
  us: /^-?(\d+|[1-9]\d{0,2}(,\d{3})+)(\.\d+)?$/,
  eu: /^-?(\d+|[1-9]\d{0,2}(\.\d{3})+)(,\d+)?$/,
  fr: /^-?(\d+|[1-9]\d{0,2}([   ]\d{3})+)(,\d+)?$/
};

function isTokenChar(ch: string): boolean {
  return !isAsciiDigit(ch) && ch !== '.' && ch !== ',' && ch !== '-' && !/\s/.test(ch);
}

interface Edge {
  token: string;
  rest: string;
}

/** Splits at most one edge token (start or end) off `body`; null when there is none; 'many' when there are two. */
function splitEdgeToken(body: string): Edge | null | 'many' {
  let start = 0;
  while (start < body.length && isTokenChar(body[start] as string)) start++;
  let end = body.length;
  while (end > start && isTokenChar(body[end - 1] as string)) end--;
  const hasStart = start > 0;
  const hasEnd = end < body.length;
  if (hasStart && hasEnd) return 'many';
  if (!hasStart && !hasEnd) return null;
  if (hasStart) {
    let rest = body.slice(start);
    if (rest.length > 0 && SPACE_LIKE.includes(rest[0] as string)) rest = rest.slice(1);
    return { token: body.slice(0, start), rest };
  }
  let rest = body.slice(0, end);
  if (rest.length > 0 && SPACE_LIKE.includes(rest[rest.length - 1] as string)) rest = rest.slice(0, -1);
  return { token: body.slice(end), rest };
}

function convert(candidate: string, preset: NumberPreset): string | null {
  if (!GRAMMAR[preset].test(candidate)) return null;
  switch (preset) {
    case 'plain':
      return candidate;
    case 'us':
      return candidate.replace(/,/g, '');
    case 'eu':
      return candidate.replace(/\./g, '').replace(',', '.');
    case 'fr': {
      const groups = candidate.match(/[   ]/g) ?? [];
      if (groups.some((g) => g !== groups[0])) return null;
      return candidate.replace(/[   ]/g, '').replace(',', '.');
    }
  }
}

/** Normalizes one text cell under `preset` (see the module comment and AD-2 for the rules). */
export function normalizeNumber(raw: string, preset: NumberPreset, ctx: NumberCtx): NumberResult {
  const s = trimJs(raw);
  const blank = blankKind(s);
  if (blank === 'blank') return { ok: true, value: '', blank };
  if (blank === 'placeholder') return ctx.optional ? { ok: true, value: '', blank } : { ok: false, reason: 'syntax' };

  let candidate = s;
  let marker: string | undefined;
  const negative = s.startsWith('-');
  const edge = splitEdgeToken(negative ? s.slice(1) : s);
  if (edge === 'many') return { ok: false, reason: 'syntax' };
  if (edge !== null) {
    if (!ctx.money) return { ok: false, reason: 'syntax' };
    const token = edge.token;
    const lower = token.toLowerCase();
    if (edge.rest === '' || !/\d/.test(edge.rest) || edge.rest.startsWith('-')) return { ok: false, reason: 'syntax' };
    if (lower === '$' || lower === 'usd') {
      marker = 'USD';
    } else if (CURRENCY_TOKENS.has(lower)) {
      const shown = /^[a-z]+$/i.test(token) ? token.toUpperCase() : token;
      if (ctx.anyCurrency !== true) return { ok: false, reason: 'currency', marker: shown };
      marker = shown;
    } else {
      return { ok: false, reason: 'syntax' };
    }
    candidate = (negative ? '-' : '') + edge.rest;
  }
  const value = convert(candidate, preset);
  if (value === null) return { ok: false, reason: 'syntax' };
  return marker === undefined ? { ok: true, value } : { ok: true, value, marker };
}

/** The presets under which `raw` normalizes (AD-2 "compat"), in preset order. */
export function compatibleNumberPresets(raw: string, ctx: NumberCtx): NumberPreset[] {
  return NUMBER_PRESETS.filter((p) => normalizeNumber(raw, p, ctx).ok);
}

// ---- column-level currency check (7.4, criterion 10) -------------------------------------------------------------------------

export interface CurrencyScan {
  /** Values carrying a USD marker ($ or USD). */
  usd: number;
  /** Values carrying another known currency marker, per marker in first-occurrence order. */
  foreign: Array<[marker: string, count: number]>;
}

/** Counts the currency markers of a money column's text cells (any preset; only the marker matters here). */
export function scanCurrency(cells: readonly string[]): CurrencyScan {
  const scan: CurrencyScan = { usd: 0, foreign: [] };
  const foreign = new Map<string, number>();
  const ctx: NumberCtx = { money: true, optional: true, anyCurrency: true };
  for (const raw of cells) {
    for (const preset of NUMBER_PRESETS) {
      const r = normalizeNumber(raw, preset, ctx);
      if (!r.ok) continue;
      if (r.marker === 'USD') scan.usd++;
      else if (r.marker !== undefined) foreign.set(r.marker, (foreign.get(r.marker) ?? 0) + 1);
      break;
    }
  }
  scan.foreign = [...foreign.entries()];
  return scan;
}

export type CurrencyDecision = { kind: 'ok' } | { kind: 'foreign'; markers: string[] } | { kind: 'mixed'; markers: string[] };

/**
 * USD, "$" or no marker proceeds. Any other currency (in the values or in the header, for example "Freight (EUR)"), or several
 * currencies in one column, refuses the column: no exchange rate is ever applied or invented.
 */
export function decideCurrency(scan: CurrencyScan, headerMarkers: readonly string[] = []): CurrencyDecision {
  const foreign = new Set<string>(scan.foreign.map(([m]) => m));
  for (const h of headerMarkers) {
    const upper = /^[a-z]+$/i.test(h) ? h.toUpperCase() : h;
    if (upper !== 'USD' && upper !== '$' && CURRENCY_TOKENS.has(upper.toLowerCase())) foreign.add(upper);
  }
  const markers = [...foreign];
  if (markers.length === 0) return { kind: 'ok' };
  const kinds = markers.length + (scan.usd > 0 || headerMarkers.some((h) => h.toUpperCase() === 'USD' || h === '$') ? 1 : 0);
  return kinds > 1 ? { kind: 'mixed', markers } : { kind: 'foreign', markers };
}
