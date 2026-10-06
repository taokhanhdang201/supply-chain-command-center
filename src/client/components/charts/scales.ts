// Small, dependency-free scale helpers shared by every chart (plan §8.5). No DOM measuring: charts are pure
// SVG driven entirely by their `viewBox`, so these only ever deal with numbers.

/** Maps a value from `domain` to `range` linearly. A zero-width domain maps everything to the range midpoint. */
export function linearScale(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  if (d1 === d0) {
    const mid = (r0 + r1) / 2;
    return () => mid;
  }
  return (v: number) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
}

/** Returns "nice" round tick values from 0 up to (at least) `max`, in roughly `count` steps. `max <= 0` → `[0]`. */
export function niceTicks(max: number, count = 5): number[] {
  if (max <= 0) return [0];
  const rawStep = max / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  const niceResidual = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  const step = niceResidual * magnitude;
  const n = Math.ceil(max / step);
  const ticks: number[] = [];
  // Multiply by the tick index instead of repeatedly adding `step`, so floating-point drift can't accumulate
  // across many ticks. Clean up any remaining binary floating-point noise (e.g. 0.1 + 0.2-style error) by
  // round-tripping through a fixed number of significant digits (`toPrecision`, not a fixed decimal-place
  // count) -- unlike a fixed `1e6` divisor, this scales with the value's own magnitude, so it can't round a
  // very small step/max down to 0 (BUG-3).
  for (let i = 0; i <= n; i++) {
    const v = i * step;
    ticks.push(v === 0 ? 0 : Number(v.toPrecision(12)));
  }
  return ticks;
}

/** Estimated rendered width of `text` at `fontSize`, using the same `0.6 * fontSize` per-character heuristic as
 * `truncateAxisLabel`, so every estimate in the charts agrees. */
export function labelWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.6;
}

/** How many ticks apart the *labelled* ticks must be so that labels never touch: every `stride`-th tick gets a
 * label, the rest keep only their gridline. `extent` is the room one label needs along the axis (its width for a
 * horizontal axis, its line height for a vertical one) and `spacing` the px between adjacent ticks. This is how
 * numeric tick labels are guarded (BUG-8): a chopped number ("$2,000…") reads as a different number, so numeric
 * labels are never truncated -- ticks are thinned instead. */
export function tickStride(spacing: number, extent: number, padding = 6): number {
  if (spacing <= 0) return 1;
  return Math.max(1, Math.ceil((extent + padding) / spacing));
}

/** Width in px a value axis needs for its widest label (used to size the left/right margins so numeric labels
 * always fit whole). */
export function widestLabel(labels: readonly string[], fontSize: number): number {
  return labels.reduce((max, l) => Math.max(max, labelWidth(l, fontSize)), 0);
}

/** Plans the labels of an evenly spaced category axis (`spacing` px between category centers): every label whole
 * when they fit; otherwise truncated, but never below a readable ~5 characters -- past that, every 2nd/3rd/... label
 * is shown instead (`null` for hidden ones, whose full text stays in tooltips and the data table). Two different
 * labels never show the same text. First/last labels are anchored inward, so they get budgets accordingly. */
export function planCategoryLabels(
  labels: readonly string[],
  spacing: number,
  fontSize: number
): Array<{ text: string; truncated: boolean } | null> {
  const readable = Math.min(widestLabel(labels, fontSize), 5 * 0.6 * fontSize);
  const stride = tickStride(spacing, readable, 6);
  const shownIdx = labels.map((_, i) => i).filter((i) => i % stride === 0);
  const shown = shownIdx.map((i) => labels[i] as string);
  const planned = uniqueAxisLabels(shown, categoryLabelBudgets(shown, spacing * stride, fontSize), fontSize);
  const result: Array<{ text: string; truncated: boolean } | null> = labels.map(() => null);
  shownIdx.forEach((labelIndex, k) => {
    const p = planned[k] as { text: string; truncated: boolean };
    // A label that could only be told apart by an ordinal suffix has no room to be readable: leave it out.
    result[labelIndex] = /…\(\d+\)$/.test(p.text) ? null : p;
  });
  return result;
}

/** Greedy row placement for centered tick labels along a horizontal axis. Each label goes in the first of up to
 * `maxRows` rows where it clears the previous label already in that row by `padding`; a label that fits in no row
 * is skipped (its gridline stays). Returns the row per tick, or null when skipped. Numeric labels are never cut:
 * when they are wide they stagger over rows, and only if that still can't fit are some left out. */
export function placeTickLabels(xs: readonly number[], widths: readonly number[], maxRows: number, padding = 6): Array<number | null> {
  const rowEnd: number[] = Array.from({ length: maxRows }, () => -Infinity);
  return xs.map((x, i) => {
    const half = (widths[i] as number) / 2;
    for (let r = 0; r < maxRows; r += 1) {
      if (x - half >= (rowEnd[r] as number) + padding) {
        rowEnd[r] = x + half;
        return r;
      }
    }
    return null;
  });
}

/** Truncates from the middle, keeping the start and the end ("Dallas-Fo…ashville, TN"), for category labels whose
 * distinguishing part is at the end. */
export function truncateMiddle(label: string, maxWidth: number, fontSize: number): string {
  const maxChars = Math.max(3, Math.floor(maxWidth / (fontSize * 0.6)));
  if (label.length <= maxChars) return label;
  const keep = maxChars - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${label.slice(0, head)}…${tail > 0 ? label.slice(label.length - tail) : ''}`;
}

/** Display text for every category label on one axis such that no two DIFFERENT labels ever render identically
 * (BUG-9). Labels that fit stay whole; the rest are end-truncated, and if that makes any two collide they switch
 * to middle-truncation (keeping the distinguishing tail), and as a last resort get a "(n)" ordinal. The full text
 * always remains available via `<title>`, `aria-label` and the data table. */
export function uniqueAxisLabels(
  labels: readonly string[],
  maxWidth: number | readonly number[],
  fontSize: number
): Array<{ text: string; truncated: boolean }> {
  const budget = (i: number): number => (typeof maxWidth === 'number' ? maxWidth : (maxWidth[i] as number));
  const ends = labels.map((l, i) => truncateAxisLabel(l, budget(i), fontSize));
  const collides = (texts: string[]): boolean => new Set(texts).size < new Set(labels).size;
  if (!collides(ends.map((e) => e.text))) return ends;
  const middles = labels.map((l, i) => truncateMiddle(l, budget(i), fontSize));
  const result = middles.map((text, i) => ({ text, truncated: text !== labels[i] }));
  if (!collides(middles)) return result;
  const seen = new Map<string, number>();
  return result.map((r, i) => {
    const full = labels[i] as string;
    if (!r.truncated) return r;
    const n = (seen.get(r.text) ?? 0) + 1;
    seen.set(r.text, n);
    return n === 1 ? r : { text: `${r.text.slice(0, Math.max(1, r.text.length - 4))}…(${n})`, truncated: full !== r.text };
  });
}

/** Per-label width budgets for an evenly spaced category axis whose first/last labels are anchored `start`/`end`
 * (so they extend only inward) and whose others are centered. An interior label may use a full spacing; an edge
 * label only has to clear *half* of its neighbour, so it gets `spacing - neighbourWidth / 2 - padding`, with the
 * neighbour's width being what it will actually occupy (its natural width, capped at its own budget). */
export function categoryLabelBudgets(labels: readonly string[], spacing: number, fontSize: number, padding = 6): number[] {
  const n = labels.length;
  const interior = Math.max(0, spacing - padding);
  return labels.map((_, i) => {
    if (n < 2 || (i !== 0 && i !== n - 1)) return interior;
    const neighbour = labels[i === 0 ? 1 : n - 2] as string;
    const neighbourWidth = Math.min(labelWidth(neighbour, fontSize), interior);
    return Math.max(0, spacing - neighbourWidth / 2 - padding);
  });
}

/** Truncates a category/axis label to roughly fit `maxWidth` px at `fontSize`, appending an ellipsis when it
 * doesn't fit. Uses the same `0.6 * fontSize` per-character width heuristic as `BarChart.tsx`'s own
 * `truncateLabel`, so estimates stay consistent across every chart. The full text is never lost -- callers pass
 * it through a `<title>` tooltip when truncated is `true`. */
export function truncateAxisLabel(label: string, maxWidth: number, fontSize: number): { text: string; truncated: boolean } {
  const maxChars = Math.max(3, Math.floor(maxWidth / (fontSize * 0.6)));
  if (label.length <= maxChars) return { text: label, truncated: false };
  return { text: `${label.slice(0, maxChars - 1)}…`, truncated: true };
}
