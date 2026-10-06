// EXTENSION POINT ONLY. `Suggester` is a documented interface for a possible future, separately approved way of proposing
// mappings. It has NO implementation, is NOT imported by any production module and is NOT wired into the pipeline (a test
// scans for that). The mapper is, and stays, deterministic, explainable and free of models, network and randomness.
// Anything a suggester proposed would still be shown as an unconfirmed suggestion and validated by the unchanged V1 importers.

import type { ColumnProfile } from '../structure/profile';
import type { FieldInfo } from '../canonical/schemaRegistry';

export interface Suggestion {
  columnIndex: number;
  field: string;
  confidence: number;
  reason: string;
}

export interface Suggester {
  suggest(columns: readonly ColumnProfile[], schema: readonly FieldInfo[]): Suggestion[];
}
