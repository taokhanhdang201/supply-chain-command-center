// Business-rule thresholds. Every magic number used by domain logic is defined here (plan §4.0).

export const DELAY_CRITICAL_DAYS = 7;
export const RECENT_LATE_WINDOW_DAYS = 14;
export const COST_ANOMALY_Z_THRESHOLD = 3.5;
/** A shipment is only flagged when it is also at least this many times its peer baseline (median): a high z-score
 * alone is not enough, because a very tight peer group (small natural spread) makes even a few percent of excess
 * look statistically extreme without being unusual in practice. */
export const COST_ANOMALY_MIN_RATIO = 1.5;
export const COST_MIN_PEER_GROUP = 8;
export const COST_MIN_DISTANCE_MILES = 50;
export const COST_CRITICAL_MULTIPLIER = 3;
export const MAD_SCALE = 0.6745;
export const MEAN_AD_SCALE = 1.253314;
export const STOCKOUT_SAFETY_BUFFER_DAYS = 7;
export const DEFAULT_LEAD_TIME_DAYS = 14;
export const DAYS_PER_YEAR = 365;
export const MAX_IMPORT_ROWS = 20000;
export const MAX_IMPORT_COLUMNS = 50;
export const MAX_ERRORS_RETURNED = 500;
/** Cap on the `X-SCC-Column-Map` request header (50 columns of <=32 chars would already exceed the useful range). */
export const MAX_COLUMN_MAP_LENGTH = 1024;
export const MAPPING_PREVIEW_ROWS = 5;
export const DEFAULT_MAX_UPLOAD_BYTES = 2_097_152;
export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export const ROUTE_DELAY_CRITICAL_SHARE = 0.2;
export const ROUTE_DELAY_WARNING_SHARE = 0.1;
