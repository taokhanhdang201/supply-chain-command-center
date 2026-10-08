// The Nodes chapter: each warehouse as one identical bay of a single rack system. Every bay has the same width and
// height; the only thing that differs is the fill level, which is the existing utilization figure (units / capacity,
// the same number Analytics shows). Under each bay, in this order only: code, percent, inventory value. Capacity and
// units stay in the accessible name and the tooltip. Each bay is one link to that warehouse's filtered Inventory.

import type { CSSProperties } from 'react';
import type { WarehouseUtilization } from '../../../shared/types';
import { formatNumber, formatPercent } from '../../../shared/format';
import { buildHash } from '../../router';
import { displayMoneySummary } from '../../lib/displayMoney';

export interface WarehouseRacksProps {
  warehouses: readonly WarehouseUtilization[];
}

/** A row of identical warehouse bays; the fill height is the utilization (capped at the bay, flagged when over). */
export function WarehouseRacks({ warehouses }: WarehouseRacksProps) {
  return (
    <ul className="racks">
      {warehouses.map((w) => {
        const fill = w.utilization === null ? 0 : Math.min(1, Math.max(0, w.utilization));
        const over = w.utilization !== null && w.utilization > 1;
        const unknown = w.utilization === null;
        return (
          <li key={w.code} className="racks__item">
            <a
              className={`rack${over ? ' rack--over' : ''}${unknown ? ' rack--unknown' : ''}`}
              href={buildHash('inventory', { warehouse: w.code })}
              aria-label={`${w.name}: ${formatPercent(w.utilization)} of capacity used, ${displayMoneySummary(w.valueCents)} inventory value. View its inventory`}
              title={`${w.name}: ${formatNumber(w.units)} of ${formatNumber(w.capacityUnits)} units`}
            >
              <span className="rack__frame" aria-hidden="true">
                <span className="rack__fill" style={{ ['--fill' as string]: `${Math.round(fill * 10000) / 100}%` } as CSSProperties} />
              </span>
              <span className="rack__code" aria-hidden="true">
                {w.code}
              </span>
              <span className="rack__pct" aria-hidden="true">
                {formatPercent(w.utilization)}
              </span>
              <span className="rack__value" aria-hidden="true">
                {displayMoneySummary(w.valueCents)}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
