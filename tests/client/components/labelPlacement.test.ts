import { describe, it, expect } from 'vitest';
import { placeMapLabels, type MapPoint } from '../../../src/client/components/routes/labelPlacement';
import { LOCATIONS } from '../../../src/shared/reference/locations';
import { projectToMap } from '../../../src/shared/geo';

const FONT = 12;
const MARKER = 10;

function boxOf(p: MapPoint, pl: { dx: number; dy: number; anchor: string }) {
  const w = p.code.length * FONT * 0.6;
  const x0 = pl.anchor === 'start' ? p.x + pl.dx : pl.anchor === 'end' ? p.x + pl.dx - w : p.x + pl.dx - w / 2;
  return { x0, x1: x0 + w, y0: p.y + pl.dy - FONT, y1: p.y + pl.dy };
}
const hit = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe('placeMapLabels (R-10)', () => {
  const points: MapPoint[] = LOCATIONS.map((l) => ({ code: l.code, ...projectToMap(l.lat, l.lon) }));

  it('places every location of the real map with no label over another label or over any marker', () => {
    const placed = placeMapLabels(points, FONT, MARKER);
    expect(placed.size).toBe(points.length);
    const boxes = points.map((p) => ({ p, box: boxOf(p, placed.get(p.code) as never) }));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(hit((boxes[i] as (typeof boxes)[0]).box, (boxes[j] as (typeof boxes)[0]).box)).toBe(false);
      }
      for (const other of points) {
        const m = { x0: other.x - MARKER / 2, x1: other.x + MARKER / 2, y0: other.y - MARKER / 2, y1: other.y + MARKER / 2 };
        expect(hit((boxes[i] as (typeof boxes)[0]).box, m)).toBe(false);
      }
    }
  });

  it('keeps WH-EWR and BOS apart specifically', () => {
    const placed = placeMapLabels(points, FONT, MARKER);
    const ewr = points.find((p) => p.code === 'WH-EWR') as MapPoint;
    const bos = points.find((p) => p.code === 'BOS') as MapPoint;
    expect(hit(boxOf(ewr, placed.get('WH-EWR') as never), boxOf(bos, placed.get('BOS') as never))).toBe(false);
  });

  it('is deterministic and puts an isolated point below its marker', () => {
    const one = placeMapLabels([{ code: 'AAA', x: 100, y: 100 }], FONT, MARKER);
    expect(one.get('AAA')).toMatchObject({ dx: 0, anchor: 'middle' });
    expect((one.get('AAA') as { dy: number }).dy).toBeGreaterThan(0);
    expect(placeMapLabels(points, FONT, MARKER)).toEqual(placeMapLabels(points, FONT, MARKER));
  });

  it('with dropColliding, labels that fit nowhere are omitted instead of overlapping (large font, crowded map)', () => {
    const big = 90;
    const placed = placeMapLabels(points, big, MARKER, 3, true);
    expect(placed.size).toBeLessThan(points.length);
    const kept = points.filter((p) => placed.has(p.code));
    const w = (p: MapPoint) => p.code.length * big * 0.72;
    const box = (p: MapPoint) => {
      const pl = placed.get(p.code) as { dx: number; dy: number; anchor: string };
      const x0 = pl.anchor === 'start' ? p.x + pl.dx : pl.anchor === 'end' ? p.x + pl.dx - w(p) : p.x + pl.dx - w(p) / 2;
      return { x0, x1: x0 + w(p), y0: p.y + pl.dy - big, y1: p.y + pl.dy };
    };
    for (let i = 0; i < kept.length; i += 1) {
      for (let j = i + 1; j < kept.length; j += 1) expect(hit(box(kept[i] as MapPoint), box(kept[j] as MapPoint))).toBe(false);
    }
  });

  it('keeps earlier (higher-priority) points and drops later ones when a spot is over-crowded', () => {
    // Ten markers stacked on one spot: there are only eight slots around it, so the last ones cannot be placed.
    const stack: MapPoint[] = Array.from({ length: 10 }, (_, i) => ({ code: `P${i}`, x: 100, y: 100 }));
    const placed = placeMapLabels(stack, 14, MARKER, 3, true);
    expect(placed.has('P0')).toBe(true);
    expect(placed.has('P9')).toBe(false);
    expect(placed.size).toBeLessThan(10);
  });
});
