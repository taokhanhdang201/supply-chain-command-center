// One-to-one assignment and the MATCHED / CHECK / CHOOSE states (ke-hoach 5.1, 5.2). A column feeds at most one field
// and a field at most one column: the assignment is solved as a maximum-weight matching over at most 9 fields per
// dataset (exact, by dynamic programming over field subsets). Ties never resolve by column order: two columns competing
// for a field (within COMPETING_WINDOW) both become CHOOSE, and so does a column that fits two fields equally well.
// Ambiguity is never resolved silently. Pure and deterministic.

import type { ImportKind } from '../../types';
import { fieldsOf } from '../canonical/schemaRegistry';
import type { NormalizedHeader } from './normalizeHeader';
import { CHECK_MIN_CONFIDENCE, CHOOSE_FLOOR, COMPETING_WINDOW, EPS, MATCH_MIN_CONFIDENCE, MATCH_MIN_MARGIN, type PairScore } from './score';

export type ColumnState = 'matched' | 'check' | 'choose' | 'ignored';
export type ColumnReason = 'assigned' | 'ambiguous-header' | 'competing' | 'two-fields' | 'low-confidence' | 'no-evidence' | 'field-taken';

export interface Candidate {
  field: string;
  confidence: number | null;
}

export interface ColumnResult {
  index: number;
  header: string;
  state: ColumnState;
  reason: ColumnReason;
  field: string | null;
  confidence: number | null;
  candidates: Candidate[];
  evidence: string[];
  warnings: string[];
  /** Indexes of the columns competing with this one for the same field. */
  competingWith: number[];
}

export interface ColumnInput {
  index: number;
  header: string;
  normalized: NormalizedHeader;
  scores: PairScore[];
  /** Candidate fields of an ambiguous header (dictionary), or null. */
  ambiguous: readonly string[] | null;
}

function rankedOf(scores: readonly PairScore[], order: Map<string, number>): PairScore[] {
  return scores.filter((s) => s.c > 0).sort((a, b) => b.c - a.c || (order.get(a.field) as number) - (order.get(b.field) as number));
}

const closeTo = (top: number, other: number): boolean => top - other < COMPETING_WINDOW - EPS;

export function assignColumns(kind: ImportKind, inputs: readonly ColumnInput[]): ColumnResult[] {
  const fields = fieldsOf(kind).map((f) => f.name);
  const order = new Map(fields.map((f, i) => [f, i]));
  const results = new Map<number, ColumnResult>();
  const base = (input: ColumnInput): ColumnResult => ({
    index: input.index,
    header: input.header,
    state: 'ignored',
    reason: 'no-evidence',
    field: null,
    confidence: null,
    candidates: [],
    evidence: [],
    warnings: [],
    competingWith: []
  });
  const scoreOf = (input: ColumnInput, field: string): PairScore | undefined => input.scores.find((s) => s.field === field);

  // Fields claimed by an exactly-named column (V1.5 semantics): an ambiguous header never offers them.
  const exactClaimed = new Set<string>();
  for (const input of inputs) for (const s of input.scores) if (s.hKind === 'exact') exactClaimed.add(s.field);

  // 1. Ambiguous headers: CHOOSE with the candidates of the table, never auto-assigned.
  const free: ColumnInput[] = [];
  for (const input of inputs) {
    if (input.ambiguous !== null) {
      const candidates = input.ambiguous.filter((f) => !exactClaimed.has(f));
      const r = base(input);
      if (candidates.length > 0) {
        r.state = 'choose';
        r.reason = 'ambiguous-header';
        r.candidates = candidates.map((field) => ({ field, confidence: null }));
        r.evidence = [`header "${input.header.trim()}" has more than one possible meaning: ${candidates.join(', ')}`];
      } else {
        r.evidence = [`header "${input.header.trim()}" could only mean fields that other columns already provide`];
      }
      results.set(input.index, r);
    } else {
      free.push(input);
    }
  }

  const ranked = new Map<number, PairScore[]>(free.map((i) => [i.index, rankedOf(i.scores, order)]));
  const fixed = new Set<number>();
  const blocked = new Set<string>();

  // 2. No usable evidence at all.
  for (const input of free) {
    const r = ranked.get(input.index) as PairScore[];
    if (r.length === 0 || (r[0] as PairScore).c < CHOOSE_FLOOR) {
      const res = base(input);
      const label = input.header.trim() === '' ? '(blank)' : `"${input.header.trim()}"`;
      res.evidence = [`nothing in the header ${label} or in its values points clearly to an SCC field, so this column will not be imported`, ...(r.length > 0 ? (r[0] as PairScore).evidence : [])];
      results.set(input.index, res);
      fixed.add(input.index);
    }
  }

  // 3. One column fitting two fields equally well.
  for (const input of free) {
    if (fixed.has(input.index)) continue;
    const r = ranked.get(input.index) as PairScore[];
    const best = r[0] as PairScore;
    const second = r[1];
    if (best.c >= CHECK_MIN_CONFIDENCE && second !== undefined && second.c >= CHECK_MIN_CONFIDENCE && closeTo(best.c, second.c)) {
      const within = r.filter((s) => s.c >= CHECK_MIN_CONFIDENCE && closeTo(best.c, s.c));
      const res = base(input);
      res.state = 'choose';
      res.reason = 'two-fields';
      res.candidates = within.map((s) => ({ field: s.field, confidence: s.c }));
      res.evidence = [`this column fits ${within.map((s) => s.field).join(' and ')} about equally well`, ...within.flatMap((s) => s.evidence)];
      results.set(input.index, res);
      fixed.add(input.index);
    }
  }

  // 4. Two columns competing for one field: both become CHOOSE.
  for (const field of fields) {
    const contenders = free
      .filter((i) => !fixed.has(i.index) && (ranked.get(i.index) as PairScore[])[0]?.field === field && ((ranked.get(i.index) as PairScore[])[0] as PairScore).c >= CHECK_MIN_CONFIDENCE)
      .map((i) => ({ input: i, c: ((ranked.get(i.index) as PairScore[])[0] as PairScore).c }))
      .sort((a, b) => b.c - a.c || a.input.index - b.input.index);
    const top = contenders[0];
    if (top === undefined) continue;
    // The same header text twice is a duplicate (as in V1): it blocks whatever the values say.
    const key = top.input.normalized.key;
    const dupes = key === '' ? [] : free.filter((i) => !fixed.has(i.index) && i.normalized.key === key && (scoreOf(i, field)?.h ?? 0) > 0).map((i) => ({ input: i, c: (scoreOf(i, field) as PairScore).c }));
    const within = [...contenders.filter((x) => closeTo(top.c, x.c))];
    for (const d of dupes) if (!within.some((w) => w.input.index === d.input.index)) within.push(d);
    within.sort((a, b) => a.input.index - b.input.index);
    if (within.length < 2) continue;
    blocked.add(field);
    for (const x of within) {
      const res = base(x.input);
      const mine = scoreOf(x.input, field) as PairScore;
      res.state = 'choose';
      res.reason = 'competing';
      res.candidates = [{ field, confidence: x.c }];
      res.competingWith = within.filter((y) => y.input.index !== x.input.index).map((y) => y.input.index);
      const others = within.filter((y) => y.input.index !== x.input.index).map((y) => `"${y.input.header.trim()}" (${y.c.toFixed(2)})`).join(', ');
      res.evidence = [`Competing for ${field}: "${x.input.header.trim()}" (${x.c.toFixed(2)}) vs ${others}`, ...mine.evidence];
      res.warnings = mine.warnings;
      results.set(x.input.index, res);
      fixed.add(x.input.index);
    }
  }

  // 5. Maximum-weight one-to-one matching of the remaining columns to the remaining fields.
  const matchable = free.filter((i) => !fixed.has(i.index) && ((ranked.get(i.index) as PairScore[])[0] as PairScore).c >= CHECK_MIN_CONFIDENCE);
  const freeFields = fields.filter((f) => !blocked.has(f));
  const assignment = solveMatching(matchable, freeFields, scoreOf);

  for (const input of matchable) {
    const field = assignment.get(input.index);
    const r = ranked.get(input.index) as PairScore[];
    if (field === undefined) {
      // Its best field went to a better column: not imported, with the reason.
      const res = base(input);
      res.reason = 'field-taken';
      const best = r[0] as PairScore;
      res.evidence = [`also looked like ${best.field} (${best.c.toFixed(2)}), but another column fits ${best.field} better`, ...best.evidence];
      results.set(input.index, res);
      fixed.add(input.index);
      continue;
    }
    const mine = scoreOf(input, field) as PairScore;
    const nextField = r.filter((s) => s.field !== field)[0];
    const columnMargin = nextField === undefined ? mine.c : mine.c - nextField.c;
    const otherColumns = free.filter((o) => o.index !== input.index).map((o) => scoreOf(o, field)?.c ?? 0);
    const fieldMargin = mine.c - Math.max(0, ...otherColumns);
    const clean = mine.warnings.length === 0 && !mine.profileOnly;
    const isMatched = mine.c >= MATCH_MIN_CONFIDENCE && columnMargin >= MATCH_MIN_MARGIN - EPS && fieldMargin >= MATCH_MIN_MARGIN - EPS && clean;
    const res = base(input);
    res.state = isMatched ? 'matched' : 'check';
    res.reason = 'assigned';
    res.field = field;
    res.confidence = mine.c;
    res.candidates = [{ field, confidence: mine.c }];
    res.evidence = mine.evidence;
    res.warnings = mine.warnings;
    results.set(input.index, res);
    fixed.add(input.index);
  }

  // 6. Some evidence but not enough: CHOOSE (nothing preselected) with the best candidates.
  for (const input of free) {
    if (fixed.has(input.index)) continue;
    const r = ranked.get(input.index) as PairScore[];
    const res = base(input);
    const cands = r.filter((s) => s.c >= CHOOSE_FLOOR).slice(0, 3);
    res.state = 'choose';
    res.reason = 'low-confidence';
    res.candidates = cands.map((s) => ({ field: s.field, confidence: s.c }));
    res.evidence = cands.flatMap((s) => s.evidence);
    res.warnings = (cands[0] as PairScore).warnings;
    results.set(input.index, res);
  }

  return inputs.map((i) => results.get(i.index) as ColumnResult);
}

/** Exact maximum-weight matching (columns to fields), each used at most once; ties keep the first solution found. */
function solveMatching(columns: readonly ColumnInput[], fields: readonly string[], scoreOf: (input: ColumnInput, field: string) => PairScore | undefined): Map<number, string> {
  const n = fields.length;
  const states = 1 << n;
  // best[mask] = best total weight using exactly the fields in mask, with its choices.
  let best: Array<{ weight: number; picks: Array<[number, string]> } | null> = new Array(states).fill(null);
  best[0] = { weight: 0, picks: [] };
  for (const col of columns) {
    const next = best.slice();
    for (let mask = 0; mask < states; mask++) {
      const cur = best[mask];
      if (cur === null || cur === undefined) continue;
      for (let f = 0; f < n; f++) {
        if (mask & (1 << f)) continue;
        const pair = scoreOf(col, fields[f] as string);
        if (pair === undefined || pair.c < CHECK_MIN_CONFIDENCE) continue;
        const target = mask | (1 << f);
        const weight = cur.weight + pair.c;
        const existing = next[target];
        if (existing === null || existing === undefined || weight > existing.weight + EPS) {
          next[target] = { weight, picks: [...cur.picks, [col.index, fields[f] as string]] };
        }
      }
    }
    best = next;
  }
  let top: { weight: number; picks: Array<[number, string]> } = { weight: 0, picks: [] };
  for (const cand of best) if (cand !== null && cand.weight > top.weight + EPS) top = cand;
  return new Map(top.picks);
}
