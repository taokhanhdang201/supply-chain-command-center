// A schematic SVG map of shipment routes (plan §8.6), using the fixed equirectangular projection from
// `shared/geo.ts` and a coarse US outline; no API key, works offline. Draws only routes with both endpoints
// resolved to a distinct reference location — unmapped and same-origin-destination routes are listed elsewhere
// by the caller, never drawn here. The route list beside the map is the accessible equivalent of the paths:
// every drawable route is also a `<button>` with the same information a sighted user reads from the map.

import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Location } from '../../../shared/types';
import type { RouteSummary } from '../../../shared/domain/analytics';
import { formatCents, formatPercent } from '../../../shared/format';
import { RouteLabel } from '../ui/RouteLabel';
import { projectToMap } from '../../../shared/geo';
import { US_OUTLINE } from '../../../shared/reference/usOutline';
import { placeMapLabels } from './labelPlacement';
import { ROUTE_DELAY_CRITICAL_SHARE, ROUTE_DELAY_WARNING_SHARE } from '../../../shared/constants';
import { laneTone } from '../atlas/atlasGeometry';

export interface RouteMapProps {
  routes: readonly RouteSummary[];
  locations: readonly Location[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 600;
const MARKER_SIZE = 10;
/** Smallest label size (px on screen) the map aims for; the SVG is scaled to fit its card, so the font in viewBox
 * units is counter-scaled to keep this size when the map is shown narrower than the viewBox. */
const MIN_LABEL_PX = 11.5;
const MIN_LABEL_FONT_UNITS = 12;

// Lane tones match the page's figures: gray when on track, amber (solid) from 10% delayed, and dashed red (never
// colour alone) from 20%. The tone thresholds are the Dashboard atlas's.
const toneForRoute = (route: RouteSummary) => laneTone(route.delayedShare);

const ROUTE_STROKE = { neutral: 'var(--route)', warning: 'var(--warning)', critical: 'var(--critical)' } as const;

/** On phones the list flows with the page instead of scrolling inside it, so a long list shows its first lanes. */
const PHONE_LIST_LIMIT = 10;

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const perpX = -dy / length;
  const perpY = dx / length;
  const offset = 0.15 * length;
  const cx = (x1 + x2) / 2 + perpX * offset;
  const cy = (y1 + y2) / 2 + perpY * offset;
  return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
}

function handleActivationKey(e: KeyboardEvent<HTMLButtonElement>, run: () => void): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    run();
  }
}

/** A schematic route map (SVG, no API key) plus its accessible equivalent: a list of route buttons. */
export function RouteMap({ routes, locations, selectedKey, onSelect }: RouteMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [renderedWidth, setRenderedWidth] = useState(VIEW_WIDTH);
  const [showAllLanes, setShowAllLanes] = useState(false);
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setRenderedWidth(w);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // On-screen size = font units * renderedWidth / VIEW_WIDTH, so counter-scale to keep labels legible.
  const labelFontSize = Math.max(MIN_LABEL_FONT_UNITS, (MIN_LABEL_PX * VIEW_WIDTH) / renderedWidth);
  const drawable = routes.filter((r) => r.mapped && r.originCode !== r.destinationCode);
  const maxCount = Math.max(1, ...drawable.map((r) => r.count));
  const hasSelection = selectedKey !== null;
  const selectedRoute = drawable.find((r) => r.routeKey === selectedKey);
  // Paint order only: the selected route is drawn last so it sits on top (the list keeps its own order).
  const paintOrder = selectedRoute === undefined ? drawable : [...drawable.filter((r) => r !== selectedRoute), selectedRoute];

  // Warehouses first so they get first pick of label position; the rest follow.
  const labelPlacements = placeMapLabels(
    [...locations]
      .sort((a, b) => Number(b.kind === 'warehouse') - Number(a.kind === 'warehouse'))
      .map((l) => ({ code: l.code, ...projectToMap(l.lat, l.lon) })),
    labelFontSize,
    MARKER_SIZE,
    3,
    true
  );

  const outlinePoints = US_OUTLINE.map(([lon, lat]) => {
    const { x, y } = projectToMap(lat, lon);
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="route-map">
      <div className="route-map__grid">
        <svg
          ref={svgRef}
          className="route-map__svg"
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          width="100%"
          role="img"
          aria-labelledby="route-map-title"
          aria-describedby="route-map-desc"
        >
          <title id="route-map-title">Schematic route map</title>
          <desc id="route-map-desc">{`Schematic map of ${drawable.length} route${drawable.length === 1 ? '' : 's'}, projected on a coarse US outline. Not to scale.`}</desc>
          <polygon points={outlinePoints} className="route-map__outline" />
          {paintOrder.map((route) => {
            const origin = locations.find((l) => l.code === route.originCode);
            const destination = locations.find((l) => l.code === route.destinationCode);
            if (!origin || !destination) return null;
            const p1 = projectToMap(origin.lat, origin.lon);
            const p2 = projectToMap(destination.lat, destination.lon);
            const isSelected = selectedKey === route.routeKey;
            const opacity = !hasSelection || isSelected ? 1 : 0.25;
            const strokeWidth = 1.5 + 4.5 * (route.count / maxCount);
            const d = bezierPath(p1.x, p1.y, p2.x, p2.y);
            const drawnWidth = isSelected ? strokeWidth + 1.5 : strokeWidth;
            const tone = toneForRoute(route);
            return (
              <g key={route.routeKey}>
                {isSelected && <path d={d} fill="none" strokeWidth={drawnWidth + 7} className="route-map__halo" />}
                <path
                  d={d}
                  fill="none"
                  stroke={ROUTE_STROKE[tone]}
                  // The dash scales with the stroke, as on the Dashboard, so a thick late lane still reads as dashed.
                  strokeDasharray={tone === 'critical' ? `${3 * drawnWidth} ${2 * drawnWidth}` : undefined}
                  strokeWidth={drawnWidth}
                  opacity={opacity}
                  tabIndex={-1}
                  className="route-map__path"
                  onClick={() => onSelect(route.routeKey)}
                />
              </g>
            );
          })}
          {locations.map((loc) => {
            const { x, y } = projectToMap(loc.lat, loc.lon);
            const offset = labelPlacements.get(loc.code);
            const isEndpoint = selectedRoute !== undefined && (loc.code === selectedRoute.originCode || loc.code === selectedRoute.destinationCode);
            return (
              <g
                key={loc.code}
                className={`route-map__marker route-map__marker--${loc.kind}${isEndpoint ? ' is-endpoint' : ''}${hasSelection && !isEndpoint ? ' is-dimmed' : ''}`}
              >
                <title>{loc.name}</title>
                {loc.kind === 'warehouse' ? (
                  <rect x={x - MARKER_SIZE / 2} y={y - MARKER_SIZE / 2} width={MARKER_SIZE} height={MARKER_SIZE} className="route-map__marker-shape" />
                ) : (
                  <circle cx={x} cy={y} r={MARKER_SIZE / 2.5} className="route-map__marker-shape" />
                )}
                {offset !== undefined && (
                  <text
                    x={x + offset.dx}
                    y={y + offset.dy}
                    textAnchor={offset.anchor}
                    fontSize={labelFontSize}
                    strokeWidth={labelFontSize / 4}
                    className="route-map__marker-label"
                  >
                    {loc.code}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        <div className="route-map__lanes">
          <ul className="route-map__list">
            {drawable.map((route, index) => {
              const isSelected = selectedKey === route.routeKey;
              // Past the first ten, a lane is hidden on phones only (CSS) until "Show all lanes"; the selected one never is.
              const isExtra = !showAllLanes && !isSelected && index >= PHONE_LIST_LIMIT;
              return (
                <li key={route.routeKey} className={isExtra ? 'route-map__list-item--extra' : undefined}>
                  <button
                    type="button"
                    className={`route-map__list-button route-map__list-button--${toneForRoute(route)}`}
                    aria-pressed={isSelected}
                    onClick={() => onSelect(route.routeKey)}
                    onKeyDown={(e) => handleActivationKey(e, () => onSelect(route.routeKey))}
                  >
                    <span className="route-map__list-label">
                      <RouteLabel label={route.label} />
                    </span>
                    <span className="route-map__list-detail">
                      {route.count} shipment{route.count === 1 ? '' : 's'} · avg {formatCents(route.avgCostCents)} · {formatPercent(route.delayedShare, 0)} delayed
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!showAllLanes && drawable.length > PHONE_LIST_LIMIT && (
            <button type="button" className="button route-map__show-all" onClick={() => setShowAllLanes(true)}>
              Show all lanes ({drawable.length})
            </button>
          )}
        </div>
      </div>

      <div className="route-map__key" aria-hidden="true">
        <span className="route-map__key-item">
          <span className="route-map__key-line route-map__key-line--neutral" />
          On track
        </span>
        <span className="route-map__key-item">
          <span className="route-map__key-line route-map__key-line--warning" />
          {formatPercent(ROUTE_DELAY_WARNING_SHARE, 0)}–{formatPercent(ROUTE_DELAY_CRITICAL_SHARE, 0)} delayed
        </span>
        <span className="route-map__key-item">
          <span className="route-map__key-line route-map__key-line--critical" />≥{formatPercent(ROUTE_DELAY_CRITICAL_SHARE, 0)} delayed
        </span>
        <span className="route-map__key-item">
          <span className="route-map__key-node route-map__key-node--warehouse" />
          Warehouse
        </span>
        <span className="route-map__key-item">
          <span className="route-map__key-node route-map__key-node--city" />
          City
        </span>
        <span className="route-map__key-item">
          <span className="route-map__key-line route-map__key-line--selected" />
          Selected
        </span>
      </div>

      <p className="route-map__legend">
        Line color: gray = on track, amber {formatPercent(ROUTE_DELAY_WARNING_SHARE, 0)}–{formatPercent(ROUTE_DELAY_CRITICAL_SHARE, 0)} delayed,
        dashed red ≥{formatPercent(ROUTE_DELAY_CRITICAL_SHARE, 0)} delayed. Line width is proportional to shipment count.
        Squares are warehouses, circles are cities. Schematic projection; not to scale.
      </p>
    </div>
  );
}
