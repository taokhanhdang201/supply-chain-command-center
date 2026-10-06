// The `X-SCC-Column-Map` request header: one entry per source column, by position; a canonical field name, or empty
// for "do not import". Parsed with a whitelist (no JSON, no user-controlled object keys), size-capped, and checked
// against the kind's field set, so a hostile header can only ever be rejected, never interpreted.

import type { ImportKind } from '../types';
import type { ColumnMap } from '../csv/importCommon';
import { MAX_COLUMN_MAP_LENGTH, MAX_IMPORT_COLUMNS } from '../constants';
import { columnsForKind } from './columnMapping';

/** Header name, lowercase as Node exposes request headers. */
export const COLUMN_MAP_HEADER = 'x-scc-column-map';

/** Serializes a column map to the header value: field names joined by commas, `''` for an ignored column. */
export function serializeColumnMap(map: ColumnMap): string {
  return map.map((f) => f ?? '').join(',');
}

/** Parses and whitelist-validates a header value for the given kind. Never throws. */
export function parseColumnMapHeader(raw: string, kind: ImportKind): { ok: true; map: ColumnMap } | { ok: false } {
  if (raw.length > MAX_COLUMN_MAP_LENGTH) return { ok: false };
  const entries = raw.split(',');
  if (entries.length > MAX_IMPORT_COLUMNS) return { ok: false };
  const known = new Set(columnsForKind(kind).map((c) => c.name));
  const map: (string | null)[] = [];
  for (const entry of entries) {
    if (!/^[a-z_]{0,32}$/.test(entry)) return { ok: false };
    if (entry === '') {
      map.push(null);
    } else if (known.has(entry)) {
      map.push(entry);
    } else {
      return { ok: false };
    }
  }
  return { ok: true, map };
}
