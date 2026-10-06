// TESTER (Agent 3): an independent legacy differential check (criterion 43, SA-6), with a generator of my own.
// 200 files: canonical or V1.5-alias headers, shuffled columns, quoted commas/quotes, padded values, status spellings,
// BOM, CRLF/LF, blank lines, missing optional columns, unknown extra columns, and 15 defect classes. For each file the
// V1 outcome (direct import, or the V1.5 suggestion + confirmed map exactly as the app does) is compared with the
// pipeline: accepted -> pipeline confirmable and rows IDENTICAL (warnings compared and reported separately);
// rejected at row level -> never confirmable and, when validation ran, IDENTICAL error lists (line, column, code, message).

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importInventoryCsv } from '../../../src/shared/csv/importInventory';
import { importShipmentsCsv } from '../../../src/shared/csv/importShipments';
import { INVENTORY_COLUMNS, SHIPMENT_COLUMNS } from '../../../src/shared/csv/schemas';
import { INVENTORY_ALIASES, SHIPMENT_ALIASES } from '../../../src/shared/mapping/aliases';
import { analyzeImportFile, toColumnMap, validateMapping, type ColumnMap } from '../../../src/shared/mapping/columnMapping';
import type { ImportIssue, ImportKind } from '../../../src/shared/types';
import { analyzeFile, type Analysis, type Decisions } from '../../../src/shared/ingest/pipeline';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import type { Result } from '../../../src/shared/ingest/types';

const registry = createDefaultRegistry();
const FIELDS: Record<ImportKind, string[]> = { inventory: INVENTORY_COLUMNS.map((c) => c.name), shipments: SHIPMENT_COLUMNS.map((c) => c.name) };
const REQUIRED: Record<ImportKind, string[]> = { inventory: INVENTORY_COLUMNS.filter((c) => c.requiredColumn).map((c) => c.name), shipments: SHIPMENT_COLUMNS.filter((c) => c.requiredColumn).map((c) => c.name) };
const ALIAS = { inventory: new Map(INVENTORY_ALIASES), shipments: new Map(SHIPMENT_ALIASES) };

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const DEFECTS = ['none', 'none', 'none', 'none', 'none', 'abc_number', 'feb30', 'qty_decimal', 'dup_key', 'long_name', 'bad_wh', 'blank_req', 'space_id', 'neg', 'three_dec', 'lead0', 'lead366', 'year2101', 'bad_status', 'short_row'] as const;
type Defect = (typeof DEFECTS)[number];

function value(kind: ImportKind, f: string, i: number, r: () => number): string {
  const pad = r() < 0.15 ? ' ' : '';
  const v = ((): string => {
    switch (f) {
      case 'sku': return `T${['ELC', 'HW', 'PK'][i % 3]}-${4000 + i}`;
      case 'product_name': return ['Tape, clear 48mm', 'Box "Large" 60x40', 'Gloves', 'Shelf bracket', 'Label roll 4x6'][Math.floor(r() * 5)] as string;
      case 'category': return ['Packaging', 'Hardware', 'Safety'][Math.floor(r() * 3)] as string;
      case 'warehouse': return ['WH-DFW', 'WH-ATL', 'WH-ORD', 'WH-LAX', 'WH-EWR'][i % 5] as string;
      case 'quantity': return String(Math.floor(r() * 5000));
      case 'reorder_point': return String(Math.floor(r() * 300));
      case 'unit_cost': return `${Math.floor(r() * 900)}.${String(Math.floor(r() * 100)).padStart(2, '0')}`;
      case 'avg_daily_usage': return r() < 0.2 ? '' : `${Math.floor(r() * 50)}.${Math.floor(r() * 10)}`;
      case 'lead_time_days': return r() < 0.2 ? '' : String(1 + Math.floor(r() * 90));
      case 'shipment_id': return `TS-${70000 + i}`;
      case 'origin': return ['Dallas, TX', 'WH-ATL', 'Chicago', 'Reno, NV'][Math.floor(r() * 4)] as string;
      case 'destination': return ['Houston', 'WH-EWR', 'Miami, FL', 'Boise'][Math.floor(r() * 4)] as string;
      case 'carrier': return ['Northstar Freight', 'Summit Express'][Math.floor(r() * 2)] as string;
      case 'status': return ['pending', 'in_transit', 'delivered', 'cancelled', 'In Transit', 'DELIVERED', 'in-transit'][Math.floor(r() * 7)] as string;
      case 'ship_date': return `2026-04-${String(1 + (i % 20)).padStart(2, '0')}`;
      case 'estimated_delivery': return r() < 0.1 ? '' : `2026-04-${String(5 + (i % 20)).padStart(2, '0')}`;
      case 'actual_delivery': return r() < 0.5 ? '' : `2026-04-${String(6 + (i % 20)).padStart(2, '0')}`;
      case 'shipping_cost': return `${Math.floor(r() * 3000)}.${String(Math.floor(r() * 100)).padStart(2, '0')}`;
      default: return 'x';
    }
  })();
  void kind;
  return v === '' ? v : `${pad}${v}${pad}`;
}

interface Gen { kind: ImportKind; text: string; defect: Defect }
function generate(n: number, r: () => number): Gen {
  const kind: ImportKind = r() < 0.5 ? 'inventory' : 'shipments';
  const defect = DEFECTS[Math.floor(r() * DEFECTS.length)] as Defect;
  const alias = r() < 0.35;
  let fields = FIELDS[kind].filter((f) => REQUIRED[kind].includes(f) || r() < 0.5);
  fields = fields.map((f) => [f, r()] as const).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  const headers = fields.map((f) => {
    const pool = ALIAS[kind].get(f) ?? [];
    const h = alias && pool.length > 0 && r() < 0.7 ? (pool[Math.floor(r() * pool.length)] as string) : f;
    return r() < 0.2 ? h.toUpperCase() : h;
  });
  const extra = r() < 0.3 ? ['Remarks'] : [];
  const n0 = 3 + Math.floor(r() * 12);
  const rows = Array.from({ length: n0 }, (_, i) => [...fields.map((f) => value(kind, f, i + n * 100, r)), ...extra.map(() => 'note')]);
  const t = 1 + Math.floor(r() * (n0 - 1));
  const set = (f: string, v: string): void => { const c = fields.indexOf(f); if (c >= 0) (rows[t] as string[])[c] = v; };
  const money = kind === 'inventory' ? 'unit_cost' : 'shipping_cost';
  switch (defect) {
    case 'abc_number': set(money, '12,5'); break;
    case 'feb30': set(kind === 'shipments' ? 'ship_date' : 'quantity', kind === 'shipments' ? '2026-02-30' : '1e3'); break;
    case 'qty_decimal': set('quantity', '2.5'); set('shipping_cost', '$12.00'); break;
    case 'dup_key': { const id = kind === 'inventory' ? 'sku' : 'shipment_id'; const c = fields.indexOf(id); const w = fields.indexOf('warehouse'); (rows[t] as string[])[c] = (rows[0] as string[])[c] as string; if (w >= 0) (rows[t] as string[])[w] = (rows[0] as string[])[w] as string; break; }
    case 'long_name': set(kind === 'inventory' ? 'product_name' : 'carrier', 'N'.repeat(130)); break;
    case 'bad_wh': set('warehouse', 'Memphis DC'); set('status', 'arrived'); break;
    case 'blank_req': set(kind === 'inventory' ? 'category' : 'origin', ''); break;
    case 'space_id': set(kind === 'inventory' ? 'sku' : 'shipment_id', 'AB CD'); break;
    case 'neg': set(money, '-1.00'); break;
    case 'three_dec': set(money, '1.005'); break;
    case 'lead0': set('lead_time_days', '0'); set('estimated_delivery', '04/05/2026'); break;
    case 'lead366': set('lead_time_days', '366'); set('actual_delivery', '2026-13-01'); break;
    case 'year2101': set(kind === 'shipments' ? 'ship_date' : 'reorder_point', kind === 'shipments' ? '2101-01-01' : '10000001'); break;
    case 'bad_status': set('status', 'lost'); set('reorder_point', 'n/a'); break;
    case 'short_row': (rows[t] as string[]).length = Math.max(1, (rows[t] as string[]).length - 2); break;
    default: break;
  }
  const quote = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [[...headers, ...extra], ...rows].map((row) => row.map(quote).join(','));
  if (r() < 0.2) lines.splice(2, 0, ''); // a blank line inside the data
  const eol = r() < 0.4 ? '\r\n' : '\n';
  const bom = r() < 0.15 ? '﻿' : '';
  return { kind, defect, text: bom + lines.join(eol) + (r() < 0.8 ? eol : '') };
}

function v1(kind: ImportKind, text: string, map?: ColumnMap) {
  return kind === 'inventory' ? importInventoryCsv(text, undefined, map) : importShipmentsCsv(text, undefined, map);
}
type Legacy = { o: 'accepted'; rows: unknown[]; warnings: string[] } | { o: 'rejected'; errors: ImportIssue[] } | { o: 'blocked' };
function legacy(kind: ImportKind, text: string): Legacy {
  const a = analyzeImportFile(kind, text);
  let map: ColumnMap | undefined;
  if (a.mode === 'map') {
    const assignments = a.suggestion.columns.map((c) => c.assignment);
    if (!validateMapping(kind, assignments).valid) return { o: 'blocked' };
    map = toColumnMap(assignments);
  }
  const res = v1(kind, text, map);
  return res.ok ? { o: 'accepted', rows: res.rows, warnings: res.warnings } : { o: 'rejected', errors: res.errors };
}

async function pipeline(kind: ImportKind, text: string): Promise<Result<Analysis>> {
  let decisions: Decisions = { kind };
  let last: Result<Analysis> | null = null;
  for (let i = 0; i < 4; i++) {
    last = await analyzeFile({ bytes: new TextEncoder().encode(text), fileName: 'd.csv', decisions }, { registry });
    if (!last.ok || last.value.preview.canConfirm) return last;
    const p = last.value.preview;
    decisions = { ...decisions, acknowledgedColumns: p.columns.filter((c) => c.state === 'check').map((c) => c.index), acknowledgedChoices: p.choices.filter((c) => c.status === 'needs-confirmation').map((c) => c.key) };
  }
  return last as Result<Analysis>;
}

describe('TESTER independent differential (V1 vs pipeline)', () => {
  it('200 own-generator files: identical rows for V1-accepted files, identical error lists for V1-rejected files', async () => {
    const r = rng(20261001);
    const s = { files: 0, accepted: 0, confirmed: 0, rowsEqual: 0, warningsEqual: 0, warningDiffs: [] as string[], rejected: 0, rejectedNeverConfirm: 0, compared: 0, comparedEqual: 0, blocked: 0, blockedConfirmable: 0, designedRepairs: 0, mismatches: [] as string[], defects: {} as Record<string, number> };
    for (let n = 0; n < 200; n++) {
      const g = generate(n, r);
      s.files++;
      s.defects[g.defect] = (s.defects[g.defect] ?? 0) + 1;
      const l = legacy(g.kind, g.text);
      const p = await pipeline(g.kind, g.text);
      if (l.o === 'accepted') {
        s.accepted++;
        if (!p.ok || !p.value.preview.canConfirm) { s.mismatches.push(`#${n} ${g.defect}: V1 accepts, pipeline not confirmable: ${p.ok ? p.value.preview.blockers.map((b) => b.code).join(',') : p.error.code}`); continue; }
        s.confirmed++;
        const via = v1(g.kind, p.value.canonical?.csv ?? '');
        if (via.ok && JSON.stringify(via.rows) === JSON.stringify(l.rows)) s.rowsEqual++;
        else s.mismatches.push(`#${n} ${g.defect}: rows differ`);
        const pw = p.value.preview.validation.warnings;
        if (JSON.stringify(pw) === JSON.stringify(l.warnings)) s.warningsEqual++;
        else if (s.warningDiffs.length < 400) s.warningDiffs.push(`V1=${JSON.stringify(l.warnings)} | pipeline=${JSON.stringify(pw)}`);
      } else if (l.o === 'blocked') {
        s.blocked++;
        if (p.ok && p.value.preview.canConfirm) s.blockedConfirmable++;
      } else if (g.kind === 'shipments' && g.defect === 'qty_decimal') {
        // shipments have no quantity: this defect only writes "$12.00" into shipping_cost, which the pipeline is DESIGNED
        // to repair (AD-2 step 4, USD marker stripped) while V1 rejects it. Counted separately, checked for the repair.
        s.designedRepairs++;
        const repaired = p.ok && p.value.preview.canConfirm && v1(g.kind, p.value.canonical?.csv ?? '').ok && (p.value.canonical?.csv ?? '').includes(',12.00');
        if (!repaired) s.mismatches.push(`#${n}: the USD marker was not repaired`);
      } else {
        s.rejected++;
        if (!(p.ok && p.value.preview.canConfirm)) s.rejectedNeverConfirm++;
        else s.mismatches.push(`#${n} ${g.defect}: V1 rejects (${l.errors[0]?.code}) but the pipeline is confirmable`);
        const header = l.errors.every((e) => e.line === 1 || e.line === null);
        if (p.ok && p.value.preview.validation.ran && !header) {
          s.compared++;
          const got = p.value.preview.validation.issues.map((i) => ({ line: i.source?.kind === 'line' ? i.source.line : null, column: i.issue.column, code: i.issue.code, message: i.message }));
          const want = l.errors.map((e) => ({ line: e.line, column: e.column, code: e.code, message: e.message }));
          if (JSON.stringify(got) === JSON.stringify(want)) s.comparedEqual++;
          else s.mismatches.push(`#${n} ${g.defect}: error lists differ V1=${JSON.stringify(want.slice(0, 2))} pipeline=${JSON.stringify(got.slice(0, 2))}`);
        }
      }
    }
    const distinctWarningDiffs = [...new Set(s.warningDiffs)];
    writeFileSync(join(tmpdir(), 'scc-tester-differential.json'), JSON.stringify({ ...s, warningDiffs: distinctWarningDiffs.slice(0, 40) }, null, 1));
    expect(s.files).toBe(200);
    expect(s.accepted).toBeGreaterThan(50);
    expect(s.rejected).toBeGreaterThan(30);
    expect(s.mismatches).toEqual([]);
    expect(s.rejectedNeverConfirm).toBe(s.rejected);
    // FINDING (recorded, criterion 43 "identical warnings"): the pipeline's V1 warnings differ from the direct V1 import
    // only by the "Column X not present" and "Ignored unknown/unmapped column(s)" warnings (the canonical CSV carries the
    // optional columns as present-but-empty and drops extra columns; the preview states both differently).
    for (const d of distinctWarningDiffs) {
      const [v1Part, pPart] = d.split(' | pipeline=');
      const v1w = JSON.parse((v1Part as string).slice(3)) as string[];
      const pw = JSON.parse(pPart as string) as string[];
      expect(pw.every((w) => v1w.includes(w)), d).toBe(true);
      expect(v1w.filter((w) => !pw.includes(w)).every((w) => /not present|Ignored (unknown|unmapped) column/.test(w)), d).toBe(true);
    }
  }, 300000);
});
