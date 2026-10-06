// Rule R3 (Addendum AD-1): which separator splits the columns of a delimited text. For each candidate, parse the first
// records quote-aware and strictly, find the header record (the one with most recognized header names), measure how
// consistently the rows after it match the header width, then decide:
//   detected   positive header-recognition evidence (>= DELIM_MIN_RECOGNIZED names recognized)
//   check      structure only (consistent and at least DELIM_STRUCT_MIN_WIDTH columns): preselected, needs acknowledgment
//   ambiguous  a tie: the user chooses, nothing preselected
//   none       nothing usable: the user chooses, nothing preselected
//   single-column  no candidate gives two or more columns
// `recognize` is supplied by the pipeline (dictionary exact hits); without it nothing is ever "recognized" and the
// decision rests on structure alone. A `sep=` line is an ordinary banner row and never declares the separator.
// Pure and deterministic: no clock, no randomness, exact integer comparisons.

import { parseDelimited } from './parse';

export type Delim = ',' | ';' | '\t' | '|';

/** Iteration order only. It is never a tie-break. */
export const DELIM_CANDIDATES: readonly Delim[] = [',', ';', '\t', '|'];
export const DELIM_SAMPLE_RECORDS = 200;
export const DELIM_HEADER_ROWS = 30;
export const DELIM_MIN_RECOGNIZED = 3;
/** Consistency thresholds as integer ratios (percent): 80 and 90. */
export const DELIM_MIN_CONSISTENCY = 0.8;
export const DELIM_STRUCT_MIN_CONSISTENCY = 0.9;
export const DELIM_STRUCT_MIN_WIDTH = 3;

export const DELIMITER_LABELS: Record<Delim, string> = {
  ',': 'Comma ( , )',
  ';': 'Semicolon ( ; )',
  '\t': 'Tab',
  '|': 'Pipe ( | )'
};

/** Stable names used as option values of the separator choice. */
export const DELIMITER_NAMES: ReadonlyArray<readonly [name: string, char: Delim]> = [
  ['comma', ','],
  ['semicolon', ';'],
  ['tab', '\t'],
  ['pipe', '|']
];

export interface DelimiterScore {
  delimiter: Delim;
  parseOk: boolean;
  width: number;
  /** 0-based index of the header record among the sampled (non-blank) records. */
  headerRecordIndex: number;
  /** Physical 1-based line of the header record. */
  headerLine: number;
  recognized: number;
  /** Records after the header that match the header width (m of n). */
  m: number;
  n: number;
  consistency: number;
  eligible: boolean;
}

export type DelimiterDecision = (
  | { kind: 'detected'; delimiter: Delim; evidence: string[] }
  | { kind: 'check'; delimiter: Delim; evidence: string[] }
  | { kind: 'ambiguous'; candidates: Delim[]; evidence: string[] }
  | { kind: 'none'; evidence: string[] }
  | { kind: 'single-column'; evidence: string[] }
) & { scores: DelimiterScore[] };

function nameOf(d: Delim): string {
  return DELIMITER_NAMES.find(([, c]) => c === d)?.[0] ?? d;
}

function lastNonEmpty(fields: readonly string[]): number {
  let i = fields.length - 1;
  while (i >= 0 && (fields[i] as string).trim() === '') i--;
  return i;
}

function scoreCandidate(text: string, delimiter: Delim, recognize: ((cell: string) => boolean) | undefined): DelimiterScore {
  const failed: DelimiterScore = { delimiter, parseOk: false, width: 0, headerRecordIndex: 0, headerLine: 1, recognized: 0, m: 0, n: 0, consistency: 0, eligible: false };
  const parsed = parseDelimited(text, delimiter, { maxRows: DELIM_SAMPLE_RECORDS, maxColumns: 1000, maxCells: 1_000_000, strictQuotes: true });
  if (!parsed.ok) return failed;
  const { rows, lines } = parsed.value;
  if (rows.length === 0) return { ...failed, parseOk: true };

  // Header record: maximum recognized within the first DELIM_HEADER_ROWS records, ties to the earliest.
  let header = -1;
  let best = 0;
  if (recognize !== undefined) {
    const limit = Math.min(rows.length, DELIM_HEADER_ROWS);
    for (let i = 0; i < limit; i++) {
      let hits = 0;
      for (const cell of rows[i] as string[]) if (cell.trim() !== '' && recognize(cell.trim())) hits++;
      if (hits > best) {
        best = hits;
        header = i;
      }
    }
  }
  if (header === -1) {
    header = rows.findIndex((r) => r.filter((c) => c.trim() !== '').length >= 2);
    if (header === -1) header = 0;
  }
  const h = rows[header] as string[];
  const width = lastNonEmpty(h) + 1;
  let m = 0;
  let n = 0;
  for (let i = header + 1; i < rows.length; i++) {
    const r = rows[i] as string[];
    n++;
    if (r.length >= width && lastNonEmpty(r) < width) m++;
  }
  const consistency = n === 0 ? 1 : m / n;
  // m / n >= 0.8  <=>  m * 10 >= n * 8 (exact integers)
  const eligible = width >= 2 && (n === 0 || m * 10 >= n * 8);
  return { delimiter, parseOk: true, width, headerRecordIndex: header, headerLine: lines[header] ?? 1, recognized: best, m, n, consistency, eligible };
}

const atLeast = (s: DelimiterScore, num: number, den: number): boolean => s.n === 0 || s.m * den >= s.n * num;
/** Exact comparison of m/n ratios by cross-multiplication (a header-only file counts as 1/1). */
const compareConsistency = (a: DelimiterScore, b: DelimiterScore): number => {
  const [am, an] = a.n === 0 ? [1, 1] : [a.m, a.n];
  const [bm, bn] = b.n === 0 ? [1, 1] : [b.m, b.n];
  return am * bn - bm * an;
};

export function detectDelimiter(rawText: string, recognize?: (cell: string) => boolean): DelimiterDecision {
  const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  const scores = DELIM_CANDIDATES.map((d) => scoreCandidate(text, d, recognize));
  const P = scores.filter((s) => s.parseOk);
  if (P.length === 0) return { kind: 'none', evidence: ['the quoting of the text is inconsistent with every separator'], scores };
  if (P.every((s) => s.width <= 1)) return { kind: 'single-column', evidence: ['no separator gives two or more columns'], scores };

  const E = P.filter((s) => s.eligible);
  if (E.length === 0) return { kind: 'none', evidence: ['no separator splits the lines into consistent columns'], scores };

  const R = Math.max(...E.map((s) => s.recognized));
  const fmt = (s: DelimiterScore): string => `${s.width} columns, ${s.n === 0 ? 'header only, no data rows' : `${s.m} of ${s.n} rows match`}`;
  if (R >= DELIM_MIN_RECOGNIZED) {
    const W = E.filter((s) => s.recognized === R);
    const top = W.reduce((acc, s) => (compareConsistency(s, acc) > 0 ? s : acc), W[0] as DelimiterScore);
    const tied = W.filter((s) => compareConsistency(s, top) === 0);
    if (tied.length === 1) {
      const evidence = [`${R} header name(s) recognized with the ${nameOf(top.delimiter)} separator`, fmt(top)];
      return { kind: 'detected', delimiter: top.delimiter, evidence, scores };
    }
    return { kind: 'ambiguous', candidates: tied.map((s) => s.delimiter), evidence: [`${R} header name(s) recognized with each of ${tied.map((s) => nameOf(s.delimiter)).join(', ')}`], scores };
  }

  const S = E.filter((s) => atLeast(s, 9, 10) && s.width >= DELIM_STRUCT_MIN_WIDTH);
  if (S.length === 1) {
    const s = S[0] as DelimiterScore;
    return { kind: 'check', delimiter: s.delimiter, evidence: [`the ${nameOf(s.delimiter)} separator gives consistent columns (${fmt(s)})`], scores };
  }
  if (S.length > 1) return { kind: 'ambiguous', candidates: S.map((s) => s.delimiter), evidence: ['more than one separator gives consistent columns'], scores };
  return { kind: 'none', evidence: ['no separator gives enough consistent columns to be sure'], scores };
}

/**
 * Legacy-first routing gate (AD-1): LEGACY (the unchanged V1 code, comma) iff the bytes are strict UTF-8 and either the
 * decision is detected/check with a comma, single-column, or none without evidence for another separator.
 */
export function legacyGate(decision: DelimiterDecision, strictUtf8: boolean): 'legacy' | 'pipeline' {
  if (!strictUtf8) return 'pipeline';
  switch (decision.kind) {
    case 'detected':
    case 'check':
      return decision.delimiter === ',' ? 'legacy' : 'pipeline';
    case 'single-column':
      return 'legacy';
    case 'none':
      return decision.scores.some((s) => s.delimiter !== ',' && s.parseOk && s.width >= 2 && s.recognized >= DELIM_MIN_RECOGNIZED) ? 'pipeline' : 'legacy';
    case 'ambiguous':
      return 'pipeline';
  }
}
