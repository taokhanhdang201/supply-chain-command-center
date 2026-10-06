// Collision-free placement of the location codes on the route map. Instead of hand-tuned per-location offsets
// (which broke whenever two locations were close: WH-EWR sat on top of BOS), each label tries a ring of candidate
// positions around its marker and takes the first that overlaps no marker and no label already placed.

export interface MapPoint {
  code: string;
  x: number;
  y: number;
}

export interface LabelPlacement {
  dx: number;
  dy: number;
  anchor: 'start' | 'middle' | 'end';
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Per-character width as a fraction of the font size. Location codes are UPPERCASE, which is wider than the 0.6
 * used for mixed-case axis text, so this is deliberately conservative (measured in Chromium). */
const CHAR_WIDTH = 0.72;

/** Room below the baseline (descenders and the text's line box), as a fraction of the font size. */
const DESCENT = 0.3;

const overlapArea = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** Places every label; the result is keyed by point code. Earlier points get first pick of position, so order
 * points by priority. `gap` is the clearance kept around markers and other labels. Text width is estimated at
 * 0.72 * fontSize per character (uppercase codes). With `dropColliding`, a label that fits nowhere without overlapping is left out of
 * the result (lower-priority labels go first, since they are placed last) instead of being drawn on top of
 * something. */
export function placeMapLabels(
  points: readonly MapPoint[],
  fontSize: number,
  markerSize: number,
  gap = 3,
  dropColliding = false
): Map<string, LabelPlacement> {
  const half = markerSize / 2 + gap;
  const markers: Box[] = points.map((p) => ({ x0: p.x - half, x1: p.x + half, y0: p.y - half, y1: p.y + half }));
  const placedBoxes: Box[] = [];
  const result = new Map<string, LabelPlacement>();
  const near = markerSize / 2 + gap + 2;

  for (const p of points) {
    const w = p.code.length * fontSize * CHAR_WIDTH;
    // Candidate offsets: below, above, right, left, then the four diagonals; baseline `y` is the text's bottom.
    const candidates: LabelPlacement[] = [
      { dx: 0, dy: near + fontSize, anchor: 'middle' },
      { dx: 0, dy: -near, anchor: 'middle' },
      { dx: near, dy: fontSize / 3, anchor: 'start' },
      { dx: -near, dy: fontSize / 3, anchor: 'end' },
      { dx: near, dy: near + fontSize, anchor: 'start' },
      { dx: -near, dy: near + fontSize, anchor: 'end' },
      { dx: near, dy: -near, anchor: 'start' },
      { dx: -near, dy: -near, anchor: 'end' }
    ];
    let best = candidates[0] as LabelPlacement;
    let bestCost = Infinity;
    for (const c of candidates) {
      const x0 = c.anchor === 'start' ? p.x + c.dx : c.anchor === 'end' ? p.x + c.dx - w : p.x + c.dx - w / 2;
      const box: Box = { x0, x1: x0 + w, y0: p.y + c.dy - fontSize, y1: p.y + c.dy + fontSize * DESCENT };
      const cost = [...markers, ...placedBoxes].reduce((sum, other) => sum + overlapArea(box, other), 0);
      if (cost < bestCost) {
        best = c;
        bestCost = cost;
        if (cost === 0) {
          placedBoxes.push(box);
          break;
        }
      }
    }
    if (bestCost > 0 && dropColliding) continue;
    if (bestCost > 0) {
      const x0 = best.anchor === 'start' ? p.x + best.dx : best.anchor === 'end' ? p.x + best.dx - w : p.x + best.dx - w / 2;
      placedBoxes.push({ x0, x1: x0 + w, y0: p.y + best.dy - fontSize, y1: p.y + best.dy + fontSize * DESCENT });
    }
    result.set(p.code, best);
  }
  return result;
}
