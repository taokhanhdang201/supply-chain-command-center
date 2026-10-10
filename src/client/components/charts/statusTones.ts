// The tone of each shipment status wherever a status is drawn: its badge on Shipments, its mark in the Dashboard's recent
// activity and its part of the Analytics status bar (DESIGN.md "Shipment status"; #/_design shows it). The server's statuses
// stay as they are; only their tone is chosen here. DESIGN.md §3: pending and in transit are normal or in progress (neutral),
// a cancelled shipment has ended with nothing left to do (neutral), a delivered one is done (good). Late is a flag, not a status.
// Three statuses share the neutral tone, so the form of their mark tells them apart (DESIGN.md "Marks").
import type { ShipmentStatus } from '../../../shared/types';
import type { Mark } from '../ui/Badge';

/** Narrower than BadgeTone and ChartTone, so a badge and a chart both take it. */
export const STATUS_TONE: Readonly<Record<ShipmentStatus, 'neutral' | 'good'>> = {
  pending: 'neutral',
  in_transit: 'neutral',
  delivered: 'good',
  cancelled: 'neutral'
};

/** In transit is solid, pending (not moving yet) hatched, cancelled (ended) hollow; delivered is solid in its own tone. */
export const STATUS_MARK: Readonly<Record<ShipmentStatus, Mark>> = {
  pending: 'hatched',
  in_transit: 'solid',
  delivered: 'solid',
  cancelled: 'hollow'
};
