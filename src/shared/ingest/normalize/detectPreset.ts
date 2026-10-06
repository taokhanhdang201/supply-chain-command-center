// Generic preset detection (Addendum AD-4), shared by numbers and dates: pool the text cells of all columns of one
// value kind, find the presets under which EVERY usable value fits, and decide. Ambiguity and mixed formats block (the
// caller shows a select with nothing preselected). Deterministic: Map iteration in first-occurrence order, exact
// integer comparisons.

import { blankKind } from './text';
import { DATE_PRESETS, normalizeDate, type DatePreset } from './dates';
import { NUMBER_PRESETS, normalizeNumber, type NumberPreset } from './numbers';

export const PRESET_SAMPLE_MAX_VALUES = 100_000;
export const PRESET_MAX_DISTINCT = 50_000;
/** A column dominated by non-values (more than this share unfit) is never decided by a minority. */
export const PRESET_MAX_UNFIT_SHARE = 0.5;

/** What a normalizer says about one raw value under one preset. */
export type Normalized = { kind: 'ok'; value: string; touched: boolean; timeStripped?: boolean; marker?: string } | { kind: 'fail' };

export interface PresetStats {
  examined: number;
  unfit: number;
  distinct: number;
  /** Values (not distinct values) that carried a stripped time of day. */
  timestampsStripped: number;
  /** Values that carried a stripped USD marker. */
  markersStripped: number;
  /** True when more distinct values existed than were examined. */
  distinctTruncated: boolean;
}

export type PresetOutcome<P extends string> =
  | { kind: 'unique'; preset: P; needsNormalization: boolean; stats: PresetStats }
  | { kind: 'equivalent'; preset: P; among: P[]; needsNormalization: boolean; stats: PresetStats }
  | { kind: 'ambiguous'; candidates: P[]; stats: PresetStats }
  | { kind: 'mixed'; groups: Array<{ preset: P; examples: string[] }>; stats: PresetStats }
  | { kind: 'none'; stats: PresetStats };

export function detectPreset<P extends string>(
  cells: readonly string[],
  presets: readonly P[],
  normalize: (raw: string, preset: P) => Normalized
): PresetOutcome<P> {
  const stats: PresetStats = { examined: 0, unfit: 0, distinct: 0, timestampsStripped: 0, markersStripped: 0, distinctTruncated: false };
  const counts = new Map<string, number>();
  let seen = 0;
  for (const raw of cells) {
    if (seen >= PRESET_SAMPLE_MAX_VALUES) break;
    if (blankKind(raw) !== null) continue;
    seen++;
    const key = raw.trim();
    const known = counts.get(key);
    if (known !== undefined) counts.set(key, known + 1);
    else if (counts.size < PRESET_MAX_DISTINCT) counts.set(key, 1);
    else stats.distinctTruncated = true;
  }
  stats.distinct = counts.size;
  if (counts.size === 0) return { kind: 'none', stats };

  interface Entry {
    value: string;
    count: number;
    results: Map<P, Normalized>;
    fits: P[];
  }
  const entries: Entry[] = [];
  for (const [value, count] of counts) {
    const results = new Map<P, Normalized>();
    const fits: P[] = [];
    for (const p of presets) {
      const r = normalize(value, p);
      results.set(p, r);
      if (r.kind === 'ok') fits.push(p);
    }
    stats.examined += count;
    if (fits.length === 0) stats.unfit += count;
    entries.push({ value, count, results, fits });
  }
  const fit = entries.filter((e) => e.fits.length > 0);
  // unfit / examined > share  <=>  unfit * 2 > examined (exact)
  if (fit.length === 0 || stats.unfit * 2 > stats.examined) return { kind: 'none', stats };

  const common = presets.filter((p) => fit.every((e) => e.fits.includes(p)));
  if (common.length === 0) {
    const groups: Array<{ preset: P; examples: string[] }> = [];
    for (const p of presets) {
      const examples = fit.filter((e) => e.fits.includes(p)).slice(0, 3).map((e) => e.value);
      if (examples.length > 0) groups.push({ preset: p, examples });
    }
    return { kind: 'mixed', groups, stats };
  }

  const touchedUnder = (p: P): boolean => fit.some((e) => (e.results.get(p) as Extract<Normalized, { kind: 'ok' }>).touched);
  const chosenFor = (p: P): void => {
    for (const e of fit) {
      const r = e.results.get(p) as Extract<Normalized, { kind: 'ok' }>;
      if (r.timeStripped === true) stats.timestampsStripped += e.count;
      if (r.marker !== undefined) stats.markersStripped += e.count;
    }
  };

  if (common.length === 1) {
    const preset = common[0] as P;
    chosenFor(preset);
    return { kind: 'unique', preset, needsNormalization: touchedUnder(preset), stats };
  }
  const identical = fit.every((e) => {
    const first = (e.results.get(common[0] as P) as Extract<Normalized, { kind: 'ok' }>).value;
    return common.every((p) => (e.results.get(p) as Extract<Normalized, { kind: 'ok' }>).value === first);
  });
  if (identical) {
    const preset = common[0] as P;
    chosenFor(preset);
    return { kind: 'equivalent', preset, among: common, needsNormalization: touchedUnder(preset), stats };
  }
  return { kind: 'ambiguous', candidates: common, stats };
}

/** Number detection over pooled text cells (money accepted so `$` fits; any known currency is stripped for detection only). */
export function detectNumberPreset(cells: readonly string[]): PresetOutcome<NumberPreset> {
  return detectPreset(
    cells,
    NUMBER_PRESETS,
    (raw, preset): Normalized => {
      const r = normalizeNumber(raw, preset, { money: true, optional: true, anyCurrency: true });
      if (!r.ok) return { kind: 'fail' };
      const trimmed = raw.trim();
      const out: Normalized = { kind: 'ok', value: r.value, touched: r.value !== trimmed || r.marker !== undefined };
      if (r.marker !== undefined) out.marker = r.marker;
      return out;
    },
  );
}

/** Date detection over pooled text cells. */
export function detectDatePreset(cells: readonly string[]): PresetOutcome<DatePreset> {
  return detectPreset(
    cells,
    DATE_PRESETS,
    (raw, preset): Normalized => {
      const r = normalizeDate(raw, preset, { optional: true });
      if (!r.ok) return { kind: 'fail' };
      return { kind: 'ok', value: r.value, touched: r.value !== raw.trim(), timeStripped: r.timeStripped };
    },
  );
}
