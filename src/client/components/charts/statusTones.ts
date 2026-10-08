// The tone of each shipment status wherever a status is drawn: its badge on Shipments, its mark in the Dashboard's recent
// activity and its part of the Analytics status bar (DESIGN.md "Shipment status"; #/_design shows it). The server's statuses
// stay as they are; only their tone is chosen here. DESIGN.md §3: pending and in transit are normal or in progress (neutral),
// a cancelled shipment has ended with nothing left to do (neutral), a delivered one is done (good). Late is a flag, not a status.
import type { ShipmentStatus } from '../../../shared/types';

/** Narrower than BadgeTone and ChartTone, so a badge and a chart both take it. */
export const STATUS_TONE: Readonly<Record<ShipmentStatus, 'neutral' | 'good'>> = {
  pending: 'neutral',
  in_transit: 'neutral',
  delivered: 'good',
  cancelled: 'neutral'
};
