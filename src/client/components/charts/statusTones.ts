// Semantic chart colours for shipment status (donut segments): pending slate, in transit blue, delivered green,
// cancelled muted. Shared by the Dashboard and Analytics so the same status always reads the same colour.
import type { ShipmentStatus } from '../../../shared/types';
import type { ChartTone } from './StackedBarChart';

export const STATUS_CHART_TONE: Record<ShipmentStatus, ChartTone> = {
  pending: 'neutral',
  in_transit: 'info',
  delivered: 'good',
  cancelled: 'muted'
};
