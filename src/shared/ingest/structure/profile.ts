// Column profiling (ke-hoach 4.3): per column, the shape histogram and rates that let the mapper confirm or overrule a
// header, plus one recognizer per canonical field that turns a profile into a fit P in [0, 1] (null = no values, no
// evidence). Typed cells (number/date) count as such; text cells are classified by their syntax under ANY number or date
// preset, so a column of "1.250,50" or "15/03/2026" still profiles as numeric/date. Pure and deterministic.

import type { RawCell } from '../types';
import type { ImportKind } from '../../types';
import { compatibleNumberPresets, normalizeNumber } from '../normalize/numbers';
import { compatibleDatePresets } from '../normalize/dates';
import { blankKind } from '../normalize/text';
import { classifyStatus, classifyWarehouse } from '../mapping/valueMaps';
import { LOCATIONS } from '../../reference/locations';
import { resolveLocation } from '../../domain/shipments';
import type { FieldInfo } from '../canonical/schemaRegistry';

/** Values examined per column (a 20,000-row file is profiled completely). */
export const PROFILE_MAX_VALUES = 50_000;
export const PROFILE_TOP_VALUES = 5;

const ID_LIKE = /^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/;

export interface ColumnProfile {
  header: string;
  total: number;
  nonBlank: number;
  blankRate: number;
  distinct: number;
  /** distinct / nonBlank */
  uniqueRate: number;
  idLikeRate: number;
  integerRate: number;
  /** numeric values with a fractional part (under some preset) */
  decimalRate: number;
  numericRate: number;
  dateRate: number;
  isoDateRate: number;
  /** values with letters and no number/date shape */
  textRate: number;
  avgLength: number;
  statusLikeRate: number;
  /** distinct values that are status-like, as a share of distinct non-blank values */
  statusDistinctShare: number;
  warehouseRate: number;
  locationRate: number;
  /** share of numeric values within 1..365 (lead time evidence) */
  leadRangeRate: number;
  top: Array<[value: string, count: number]>;
}

function emptyProfile(header: string, total: number): ColumnProfile {
  return {
    header,
    total,
    nonBlank: 0,
    blankRate: total === 0 ? 0 : 1,
    distinct: 0,
    uniqueRate: 0,
    idLikeRate: 0,
    integerRate: 0,
    decimalRate: 0,
    numericRate: 0,
    dateRate: 0,
    isoDateRate: 0,
    textRate: 0,
    avgLength: 0,
    statusLikeRate: 0,
    statusDistinctShare: 0,
    warehouseRate: 0,
    locationRate: 0,
    leadRangeRate: 0,
    top: []
  };
}

interface ValueClass {
  numeric: boolean;
  integer: boolean;
  date: boolean;
  iso: boolean;
  lead: boolean;
}

const NUM_CTX = { money: true, optional: true, anyCurrency: true } as const;

function classify(cell: RawCell, cache: Map<string, ValueClass>): ValueClass {
  const key = `${cell.t}|${cell.v}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let out: ValueClass;
  if (cell.t === 'number') {
    const n = Number(cell.v);
    out = { numeric: true, integer: /^-?\d+$/.test(cell.v), date: false, iso: false, lead: n >= 1 && n <= 365 };
  } else if (cell.t === 'date') {
    out = { numeric: false, integer: false, date: true, iso: /^\d{4}-\d{2}-\d{2}/.test(cell.v), lead: false };
  } else {
    const v = cell.v.trim();
    const presets = compatibleNumberPresets(v, NUM_CTX);
    const dates = compatibleDatePresets(v);
    if (dates.length > 0) {
      out = { numeric: false, integer: false, date: true, iso: dates.includes('iso'), lead: false };
    } else if (presets.length > 0) {
      const first = normalizeNumber(v, presets[0] as 'plain', NUM_CTX);
      const plain = first.ok ? first.value : '';
      const numericValue = Number(plain);
      const integerUnder = presets.some((p) => {
        const r = normalizeNumber(v, p, NUM_CTX);
        return r.ok && /^-?\d+$/.test(r.value);
      });
      out = { numeric: true, integer: integerUnder, date: false, iso: false, lead: numericValue >= 1 && numericValue <= 365 };
    } else {
      out = { numeric: false, integer: false, date: false, iso: false, lead: false };
    }
  }
  cache.set(key, out);
  return out;
}

export function profileColumn(header: string, cells: readonly RawCell[]): ColumnProfile {
  const limit = Math.min(cells.length, PROFILE_MAX_VALUES);
  if (limit === 0) return emptyProfile(header, 0);
  const counts = new Map<string, number>();
  const cache = new Map<string, ValueClass>();
  const classes = { numeric: 0, integer: 0, date: 0, iso: 0, id: 0, lead: 0, status: 0, warehouse: 0, location: 0, text: 0 };
  let nonBlank = 0;
  let lengthSum = 0;
  const distinctStatusLike = new Set<string>();
  for (let i = 0; i < limit; i++) {
    const cell = cells[i] as RawCell;
    if (blankKind(cell.v) !== null) continue;
    const v = cell.v.trim();
    nonBlank++;
    lengthSum += v.length;
    counts.set(v, (counts.get(v) ?? 0) + 1);
    const c = classify(cell, cache);
    if (c.numeric) classes.numeric++;
    if (c.integer) classes.integer++;
    if (c.date) classes.date++;
    if (c.iso) classes.iso++;
    if (c.lead) classes.lead++;
    if (!c.numeric && !c.date && /\p{L}/u.test(v)) classes.text++;
    if (ID_LIKE.test(v)) classes.id++;
    if (classifyStatus(v).statusLike) {
      classes.status++;
      distinctStatusLike.add(v);
    }
    if (classifyWarehouse(v).code !== null) classes.warehouse++;
    if (resolveLocation(v, LOCATIONS) !== null || classifyWarehouse(v).code !== null) classes.location++;
  }
  if (nonBlank === 0) return emptyProfile(header, limit);
  const rate = (n: number): number => n / nonBlank;
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, PROFILE_TOP_VALUES);
  return {
    header,
    total: limit,
    nonBlank,
    blankRate: (limit - nonBlank) / limit,
    distinct: counts.size,
    uniqueRate: counts.size / nonBlank,
    idLikeRate: rate(classes.id),
    integerRate: rate(classes.integer),
    decimalRate: rate(classes.numeric - classes.integer),
    numericRate: rate(classes.numeric),
    dateRate: rate(classes.date),
    isoDateRate: rate(classes.iso),
    textRate: rate(classes.text),
    avgLength: lengthSum / nonBlank,
    statusLikeRate: rate(classes.status),
    statusDistinctShare: distinctStatusLike.size / counts.size,
    warehouseRate: rate(classes.warehouse),
    locationRate: rate(classes.location),
    leadRangeRate: rate(classes.lead),
    top
  };
}

// ---- recognizers: profile -> P for a field -------------------------------------------------------------------------------

/** A column whose values do not fit the field at all must not be saved by its header. */
export const P_FLOOR = 0;

/** Returns P in [0,1], or null when the column has no values (no evidence either way). */
export function fitFor(field: FieldInfo, p: ColumnProfile): number | null {
  if (p.nonBlank === 0) return null;
  switch (field.valueKind) {
    case 'id': {
      // ids: id-shaped and, for the shipment id, unique; a shape consistent column scores higher
      const shape = p.idLikeRate;
      if (field.name === 'shipment_id') return p.uniqueRate >= 0.98 ? 0.5 * shape + 0.5 * p.uniqueRate : Math.min(0.5, 0.5 * shape + 0.5 * p.uniqueRate);
      return shape;
    }
    case 'integer': {
      const base = p.integerRate;
      if (field.name === 'lead_time_days') return 0.5 * base + 0.5 * p.leadRangeRate;
      return base;
    }
    case 'decimal':
    case 'money':
      return p.numericRate;
    case 'date':
      return p.dateRate;
    case 'status':
      // >= 80% of the distinct values in the status vocabulary and few distinct values
      return p.statusDistinctShare >= 0.8 && p.distinct <= 12 ? p.statusLikeRate : p.statusDistinctShare * 0.4;
    case 'warehouse':
      // known warehouses raise the fit; a company's own site codes are still plausible (the value mapping decides)
      return p.distinct <= 50 && p.textRate + p.idLikeRate > 0 ? 0.6 + 0.4 * p.warehouseRate : 0.4 * p.warehouseRate + 0.2;
    case 'location':
      // free text: known locations raise the fit, unknown company sites are still plausible text
      return p.numericRate > 0.5 || p.dateRate > 0.5 ? 0.1 : 0.8 + 0.2 * p.locationRate;
    case 'text': {
      if (p.numericRate > 0.5 || p.dateRate > 0.5) return 0.15;
      if (field.name === 'category' || field.name === 'carrier') {
        // short text with a limited number of distinct values
        const limited = p.distinct <= Math.max(12, p.nonBlank * 0.3);
        return (p.textRate >= 0.8 ? 0.85 : 0.5) * (limited ? 1 : 0.7) + (p.statusLikeRate > 0.8 ? -0.3 : 0);
      }
      return p.textRate >= 0.8 ? 0.85 : 0.5;
    }
  }
}

/** Kind-independent summary used for profile-only suggestions. */
export function looksLike(p: ColumnProfile): { status: boolean; warehouse: boolean; location: boolean; date: boolean } {
  return {
    status: p.nonBlank > 0 && p.statusDistinctShare >= 0.8 && p.distinct <= 12 && p.statusLikeRate >= 0.8,
    warehouse: p.nonBlank > 0 && p.warehouseRate >= 0.8 && p.distinct <= 12,
    location: p.nonBlank > 0 && p.locationRate >= 0.8,
    date: p.nonBlank > 0 && p.dateRate >= 0.9
  };
}

export type { ImportKind };
