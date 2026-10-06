// The Atlas: the network drawn as the spatial foundation of the Dashboard. Warehouses, cities and lanes come from the
// snapshot; lane tone uses the same rule as the Routes map and lane width grows with shipment count; each dot is one
// existing in-transit shipment placed at its scheduled progress. It is quiet on purpose: a land outline, grey lanes,
// dashed red only for what is late, and five warehouse codes. Warehouse nodes link to their filtered Inventory; the non-visual equivalent of the drawing is
// its accessible description, the ledger further down the page and the Routes page.

import { useRef } from 'react';
import type { Location } from '../../../shared/types';
import type { RouteSummary } from '../../../shared/domain/analytics';
import { formatCentsCompact, formatPercent } from '../../../shared/format';
import { projectToMap } from '../../../shared/geo';
import { US_OUTLINE } from '../../../shared/reference/usOutline';
import { ROUTE_DELAY_CRITICAL_SHARE } from '../../../shared/constants';
import { buildHash } from '../../router';
import { placeMapLabels } from '../routes/labelPlacement';
import { useElementSize } from '../../hooks/useAtlasHooks';
import { laneTone, lanePath, type TransitDot } from './atlasGeometry';

export interface AtlasSceneProps {
  /** Lanes to draw; unmapped and same-endpoint routes are skipped here (the Routes page lists them). */
  routes: readonly RouteSummary[];
  locations: readonly Location[];
  warehouseValueCents: ReadonlyMap<string, number>;
  dots: readonly TransitDot[];
  /** The most delayed lane: named in the accessible description and in that lane's tooltip (nothing is drawn for it). */
  focusRouteKey: string | null;
  /** False under reduced motion: everything renders in its final state. */
  animate: boolean;
}

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 600;
/** Every drawn size below is in on-screen pixels; `u()` converts it to viewBox units for the current scale. */
const LABEL_PX = 14;
const HIT_PX = 32;

/** On-screen lane width: 1px to 5px by shipment count. The square root keeps mid-traffic lanes visibly apart. */
export function laneWidthPx(count: number, maxCount: number): number {
  return 1 + 4 * Math.sqrt(Math.max(0, count) / Math.max(1, maxCount));
}

/** Draws the network. The svg is drawn 1:1 in CSS px (so its text is exactly 14px); the map itself is one scaled group
 * letterboxed to the right edge and vertical centre of the box, and the warehouse nodes and codes sit on top in px. */
export function AtlasScene({ routes, locations, warehouseValueCents, dots, focusRouteKey, animate }: AtlasSceneProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(boxRef, { width: VIEW_WIDTH, height: VIEW_HEIGHT });
  // On-screen scale of the map (viewBox units to px) and where the letterboxed map starts.
  const scale = Math.min(size.width / VIEW_WIDTH, size.height / VIEW_HEIGHT) || 1;
  const offsetX = size.width - VIEW_WIDTH * scale;
  const offsetY = (size.height - VIEW_HEIGHT * scale) / 2;
  const u = (px: number): number => px / scale;
  const toPx = (p: { x: number; y: number }): { x: number; y: number } => ({ x: offsetX + p.x * scale, y: offsetY + p.y * scale });

  const byCode = new Map(locations.map((l) => [l.code, l]));
  const drawable = routes.filter((r) => r.mapped && r.originCode !== r.destinationCode && byCode.has(r.originCode as string) && byCode.has(r.destinationCode as string));
  const maxCount = Math.max(1, ...drawable.map((r) => r.count));
  const toneOrder = { neutral: 0, warning: 1, critical: 2 } as const;
  const lanes = [...drawable].sort((a, b) => toneOrder[laneTone(a.delayedShare)] - toneOrder[laneTone(b.delayedShare)] || a.count - b.count);

  const warehouses = locations.filter((l) => l.kind === 'warehouse');
  const cities = locations.filter((l) => l.kind === 'city');
  const maxValue = Math.max(1, ...warehouses.map((w) => warehouseValueCents.get(w.code) ?? 0));
  const nodeSide = (value: number): number => 7 + 8 * Math.sqrt(value / maxValue);

  // Only the five warehouse codes are labelled; a code that fits nowhere without touching a marker or another code is left out.
  const placements = placeMapLabels(
    warehouses.map((l) => ({ code: l.code, ...toPx(projectToMap(l.lat, l.lon)) })),
    LABEL_PX,
    16,
    3,
    true
  );

  const outline = US_OUTLINE.map(([lon, lat]) => {
    const { x, y } = projectToMap(lat, lon);
    return `${x},${y}`;
  }).join(' ');

  const overdueDots = dots.filter((d) => d.overdue).length;
  const criticalLanes = drawable.filter((r) => laneTone(r.delayedShare) === 'critical').length;
  const focusLane = focusRouteKey === null ? undefined : drawable.find((r) => r.routeKey === focusRouteKey);
  const focusSentence = focusLane === undefined ? '' : `${focusLane.label}: ${focusLane.delayedCount} of ${focusLane.count} shipments delayed (${formatPercent(focusLane.delayedShare, 0)})`;
  const description =
    `Schematic network: ${warehouses.length} warehouses, ${cities.length} cities, ${drawable.length} lanes with shipments. ` +
    `${dots.length} shipments in transit are placed along their lanes; ${overdueDots} are past their estimated delivery. ` +
    `${criticalLanes} lanes are ${formatPercent(ROUTE_DELAY_CRITICAL_SHARE, 0)} or more delayed.` +
    (focusLane === undefined ? '' : ` Most delayed lane, ${focusSentence}.`) +
    ' Not to scale.';

  return (
    <div className={`atlas${animate ? ' atlas--animate' : ''}`}>
      <div className="atlas__box" ref={boxRef}>
        <svg
          className="atlas__svg"
          viewBox={`0 0 ${size.width} ${size.height}`}
          preserveAspectRatio="xMinYMin meet"
          role="group"
          aria-label={`Network atlas. ${description}`}
        >
          <g aria-hidden="true" transform={`translate(${offsetX} ${offsetY}) scale(${scale})`}>
            <polygon points={outline} className="atlas__land" strokeWidth={u(1)} />

            <g className="atlas__lanes">
              {lanes.map((route) => {
                const from = byCode.get(route.originCode as string) as Location;
                const to = byCode.get(route.destinationCode as string) as Location;
                const p1 = projectToMap(from.lat, from.lon);
                const p2 = projectToMap(to.lat, to.lon);
                const tone = laneTone(route.delayedShare);
                const width = laneWidthPx(route.count, maxCount);
                // Late lanes are dashed as well as red (never colour alone). The dash scales with the stroke so a thick lane
                // does not turn into a row of dots; without pathLength the pattern is in real length units.
                const dashed = tone === 'critical';
                return (
                  <path
                    key={route.routeKey}
                    d={lanePath(p1, p2)}
                    fill="none"
                    pathLength={dashed ? undefined : 1}
                    strokeWidth={u(width)}
                    style={dashed ? { strokeDasharray: `${u(3 * width)} ${u(2 * width)}` } : undefined}
                    className={`atlas__lane atlas__lane--${tone}`}
                  >
                    {route.routeKey === focusRouteKey && <title>{focusSentence}</title>}
                  </path>
                );
              })}
            </g>

            <g className="atlas__dots">
              {dots.map((dot) => (
                <g
                  key={dot.shipmentId}
                  className={`atlas__dot${dot.overdue ? ' atlas__dot--overdue' : ''}`}
                  transform={animate ? undefined : `translate(${dot.x} ${dot.y})`}
                >
                  <circle r={u(3)} className="atlas__dot-core" />
                  {animate && <animateMotion path={dot.segmentPath} dur="1.4s" begin="0.3s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.7 0.2 1" />}
                  <title>{`${dot.shipmentId} · ${dot.label} · in transit${dot.overdue ? ', past its estimated delivery' : ''}`}</title>
                </g>
              ))}
            </g>

            <g className="atlas__cities">
              {cities.map((loc) => {
                const { x, y } = projectToMap(loc.lat, loc.lon);
                return (
                  <circle key={loc.code} cx={x} cy={y} r={u(2.4)} className="atlas__city">
                    <title>{`${loc.code} · ${loc.name}`}</title>
                  </circle>
                );
              })}
            </g>
          </g>

          <g className="atlas__warehouses">
            {warehouses.map((loc) => {
              const { x, y } = toPx(projectToMap(loc.lat, loc.lon));
              const value = warehouseValueCents.get(loc.code) ?? 0;
              const side = nodeSide(value);
              const hit = Math.max(side + 10, HIT_PX);
              const offset = placements.get(loc.code);
              return (
                <a key={loc.code} href={buildHash('inventory', { warehouse: loc.code })} className="atlas__warehouse" aria-label={`${loc.name}, ${formatCentsCompact(value)} in inventory. View its inventory`}>
                  <title>{`${loc.name} · ${formatCentsCompact(value)} in inventory`}</title>
                  <rect x={x - hit / 2} y={y - hit / 2} width={hit} height={hit} className="atlas__warehouse-hit" />
                  <rect x={x - side / 2} y={y - side / 2} width={side} height={side} strokeWidth={2} className="atlas__warehouse-node" />
                  {offset !== undefined && (
                    <text x={x + offset.dx} y={y + offset.dy} textAnchor={offset.anchor} fontSize={LABEL_PX} strokeWidth={4} className="atlas__label" aria-hidden="true">
                      {loc.code}
                    </text>
                  )}
                </a>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}

/** The one caption under the map. It replaces the old key: width is traffic, dashed red means late (the same red as the
 * delayed figure). */
export function AtlasCaption() {
  return (
    <p className="atlas-caption">{`Thicker lanes carry more shipments. Dashed red lanes are ${formatPercent(ROUTE_DELAY_CRITICAL_SHARE, 0)}+ delayed. Dots are shipments in transit, red when overdue.`}</p>
  );
}
