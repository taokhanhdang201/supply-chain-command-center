// unused: no module imports STATUS_CHART_TONE any more; kept until the owner decides to delete it.
// Semantic chart colours for shipment status (donut segments): pending slate, in transit blue, delivered green,
// cancelled muted. The Dashboard and Analytics donuts shared it, so the same status read the same colour.
import type { ShipmentStatus } from '../../../shared/types';
import type { ChartTone } from './StackedBarChart';

export const STATUS_CHART_TONE: Record<ShipmentStatus, ChartTone> = {
  pending: 'neutral',
  in_transit: 'info',
  delivered: 'good',
  cancelled: 'muted'
};
