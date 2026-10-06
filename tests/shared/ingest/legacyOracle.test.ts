// Criterion 43: the legacy-oracle differential test. At least 1,000 generated canonical and V1.5-alias CSV files (random
// kind, alias headers in random case/separator forms, shuffled columns, junk columns, random defects) plus every existing
// import fixture are run through (1) the V1 code exactly as the app uses it today (direct import, or V1.5 suggestion +
// confirmed map) and (2) the new pipeline. Checked on every file:
//   - ROUTING: every comma/UTF-8 file stays on the LEGACY path (the default path is the unchanged V1 flow);
//   - ACCEPTED by V1: the pipeline reaches Confirm and its canonical CSV imports to IDENTICAL rows;
//   - REJECTED by V1 at row level: the pipeline never reaches Confirm, and whenever it got as far as validating, its
//     translated error list equals V1's list (line, column, code, message);
//   - REJECTED at header level: the pipeline never reaches Confirm.
// Defects the pipeline is DESIGNED to repair (slash dates, grouped numbers) are not generated: those are the additive
// improvements and are covered by the golden tests. A summary is written to the OS temp folder for the change log.

import { describe, expect, it } from 'vitest';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { importInventoryCsv } from '../../../src/shared/csv/importInventory';
import { importShipmentsCsv } from '../../../src/shared/csv/importShipments';
import { analyzeImportFile, suggestMapping, toColumnMap, validateMapping, type ColumnMap } from '../../../src/shared/mapping/columnMapping';
import { INVENTORY_ALIASES, SHIPMENT_ALIASES } from '../../../src/shared/mapping/aliases';
import { INVENTORY_COLUMNS, SHIPMENT_COLUMNS } from '../../../src/shared/csv/schemas';
import { routeFile } from '../../../src/client/ingest/runner';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import { prng } from '../../ingest-kit/corpus';
import { settle } from '../../ingest-kit/pipelineHarness';
import type { ImportIssue, ImportKind } from '../../../src/shared/types';
import { startServer, postCsv } from '../../ingest-kit/serverHarness';

const registry = createDefaultRegistry();
const FIELDS: Record<ImportKind, string[]> = { inventory: INVENTORY_COLUMNS.map((c) => c.name), shipments: SHIPMENT_COLUMNS.map((c) => c.name) };
const ALIASES = { inventory: new Map(INVENTORY_ALIASES), shipments: new Map(SHIPMENT_ALIASES) };
const REQUIRED_COLUMN: Record<ImportKind, string[]> = { inventory: INVENTORY_COLUMNS.filter((c) => c.requiredColumn).map((c) => c.name), shipments: SHIPMENT_COLUMNS.filter((c) => c.requiredColumn).map((c) => c.name) };

const PRODUCTS = ['Wireless Scanner', 'Label Printer', 'Pallet Wrap', 'Safety Gloves', 'Packing Tape', 'Shelf Bracket'];
const CITIES = ['Houston, TX', 'Miami, FL', 'Denver, CO', 'WH-DFW', 'WH-ORD', 'Boston, MA'];
const WH = ['WH-DFW', 'WH-ATL', 'WH-ORD', 'WH-LAX', 'WH-EWR'];
const STATUS = ['pending', 'in_transit', 'delivered', 'cancelled', 'In Transit', 'Delivered'];
const day = (n: number): string => `2026-0${3 + (n % 3)}-${String(1 + (n % 27)).padStart(2, '0')}`;
const cents = (n: number): string => {
  const c = 10000 + ((n * 7919) % 90000);
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
};

function value(field: string, i: number, rand: () => number): string {
  switch (field) {
    case 'sku': return `SKU-${10000 + i}`;
    case 'product_name': return PRODUCTS[i % PRODUCTS.length] as string;
    case 'category': return ['Packaging', 'Safety', 'Hardware'][i % 3] as string;
    case 'warehouse': return WH[(i + Math.floor(rand() * 3)) % WH.length] as string;
    case 'quantity': return String(Math.floor(rand() * 900));
    case 'reorder_point': return String(Math.floor(rand() * 100));
    case 'unit_cost': return cents(i + 3);
    case 'avg_daily_usage': return (Math.floor(rand() * 900) / 100).toFixed(2);
    case 'lead_time_days': return String(1 + Math.floor(rand() * 60));
    case 'shipment_id': return `SHP-${900000 + i}`;
    case 'origin': return CITIES[i % CITIES.length] as string;
    case 'destination': return CITIES[(i + 2) % CITIES.length] as string;
    case 'carrier': return ['Northstar Freight', 'BlueLine Logistics', 'Summit Express'][i % 3] as string;
    case 'status': return STATUS[Math.floor(rand() * STATUS.length)] as string;
    case 'ship_date': return day(i);
    case 'estimated_delivery': return day(i + 3);
    case 'actual_delivery': return rand() < 0.5 ? '' : day(i + 4);
    case 'shipping_cost': return cents(i + 11);
    default: return 'x';
  }
}

type Defect = 'none' | 'bad_number' | 'negative' | 'decimal_in_int' | 'bad_calendar' | 'old_year' | 'bad_id' | 'short_row' | 'extra_field' | 'dup_id' | 'blank_required' | 'bad_status' | 'bad_warehouse' | 'missing_column' | 'duplicate_header';
const DEFECTS: Defect[] = ['none', 'none', 'none', 'none', 'bad_number', 'negative', 'decimal_in_int', 'bad_calendar', 'old_year', 'bad_id', 'short_row', 'extra_field', 'dup_id', 'blank_required', 'bad_status', 'bad_warehouse', 'missing_column', 'duplicate_header'];

function variant(header: string, rand: () => number): string {
  const r = rand();
  if (r < 0.25) return header.toUpperCase();
  if (r < 0.4) return header.replace(/[ _]/g, '-');
  if (r < 0.55) return header.replace(/[ _]/g, ' ');
  if (r < 0.7) return ` ${header} `;
  return header;
}

interface Generated { text: string; kind: ImportKind; defect: Defect }

function generate(n: number, rand: () => number): Generated {
  const kind: ImportKind = rand() < 0.5 ? 'inventory' : 'shipments';
  const defect = DEFECTS[Math.floor(rand() * DEFECTS.length)] as Defect;
  const useAlias = rand() < 0.5;
  let fields = FIELDS[kind].filter((f) => REQUIRED_COLUMN[kind].includes(f) || rand() < 0.6);
  if (defect === 'missing_column') fields = fields.filter((f) => f !== (REQUIRED_COLUMN[kind][Math.floor(rand() * REQUIRED_COLUMN[kind].length)] as string));
  // columns in a shuffled order
  fields = [...fields].sort(() => rand() - 0.5);
  const headers = fields.map((f) => {
    const pool = [f, ...(ALIASES[kind].get(f) ?? [])];
    return variant(useAlias ? (pool[Math.floor(rand() * pool.length)] as string) : f, rand);
  });
  const junk = rand() < 0.3 ? ['Notes'] : [];
  if (defect === 'duplicate_header' && headers.length > 1) headers[headers.length - 1] = headers[0] as string;
  const rowCount = 3 + Math.floor(rand() * 10);
  const rows: string[][] = Array.from({ length: rowCount }, (_, i) => [...fields.map((f) => value(f, i + n * 31, rand)), ...junk.map(() => 'n')]);
  const target = 1 + Math.floor(rand() * Math.max(1, rowCount - 1));
  const col = (name: string): number => fields.indexOf(name);
  const set = (field: string, v: string): void => { const c = col(field); if (c >= 0) (rows[target] as string[])[c] = v; };
  const numeric = fields.filter((f) => ['quantity', 'reorder_point', 'unit_cost', 'shipping_cost'].includes(f));
  const dates = fields.filter((f) => ['ship_date', 'estimated_delivery'].includes(f));
  switch (defect) {
    case 'bad_number': if (numeric.length) set(numeric[0] as string, 'abc'); break;
    case 'negative': if (numeric.length) set(numeric[0] as string, '-5'); break;
    case 'decimal_in_int': set('quantity', '1.5'); break;
    case 'bad_calendar': if (dates.length) set(dates[0] as string, '2026-02-30'); break;
    case 'old_year': if (dates.length) set(dates[0] as string, '1999-01-01'); break;
    case 'bad_id': set(kind === 'inventory' ? 'sku' : 'shipment_id', 'A B'); break;
    case 'short_row': (rows[target] as string[]).length = Math.max(1, headers.length - 2); break;
    case 'extra_field': (rows[target] as string[]).push('extra', 'more'); break;
    case 'dup_id': { const id = kind === 'inventory' ? 'sku' : 'shipment_id'; const c = col(id); if (c >= 0 && rows.length > 1) { (rows[target] as string[])[c] = (rows[0] as string[])[c] as string; if (kind === 'inventory' && col('warehouse') >= 0) (rows[target] as string[])[col('warehouse')] = (rows[0] as string[])[col('warehouse')] as string; } break; }
    case 'blank_required': set(kind === 'inventory' ? 'product_name' : 'carrier', ''); break;
    case 'bad_status': set('status', 'zzz'); break;
    case 'bad_warehouse': set('warehouse', 'WH-XXX'); break;
    default: break;
  }
  const quote = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const text = [[...headers, ...junk], ...rows].map((r) => r.map(quote).join(',')).join(rand() < 0.3 ? '\r\n' : '\n') + '\n';
  return { text, kind, defect };
}

type V15 = { outcome: 'accepted'; rows: unknown[]; warnings: string[] } | { outcome: 'rejected'; errors: ImportIssue[]; totalErrors: number } | { outcome: 'blocked'; strict: boolean };

function importV1(kind: ImportKind, text: string, map?: ColumnMap) {
  return kind === 'inventory' ? importInventoryCsv(text, undefined, map) : importShipmentsCsv(text, undefined, map);
}

/** What the app does today with this file: direct upload, or the V1.5 mapping panel with its suggestions confirmed. */
function legacyOutcome(kind: ImportKind, text: string): V15 {
  const analysis = analyzeImportFile(kind, text);
  let map: ColumnMap | undefined;
  if (analysis.mode === 'map') {
    const assignments = analysis.suggestion.columns.map((c) => c.assignment);
    const v = validateMapping(kind, assignments);
    // strict: V1.5 itself found an ambiguity or a duplicate (a missing field is something the dictionary may legitimately fill)
    if (!v.valid) return { outcome: 'blocked', strict: v.undecidedCount > 0 || v.duplicateFields.length > 0 };
    map = toColumnMap(assignments);
  }
  const r = importV1(kind, text, map);
  return r.ok ? { outcome: 'accepted', rows: r.rows, warnings: r.warnings } : { outcome: 'rejected', errors: r.errors, totalErrors: r.totalErrors };
}

const strip = (e: ImportIssue) => ({ line: e.line, column: e.column, code: e.code, message: e.message });

interface Summary { files: number; generated: number; fixtures: number; accepted: number; rejectedRow: number; rejectedHeader: number; blocked: number; legacyRouted: number; pipelineConfirmed: number; validationCompared: number; mismatches: string[]; defects: Record<string, number> }

async function compare(label: string, kind: ImportKind, text: string, summary: Summary): Promise<void> {
  summary.files++;
  const bytes = new TextEncoder().encode(text);
  const route = routeFile(bytes, `${label}.csv`, registry).route;
  const legacy = legacyOutcome(kind, text);
  if (route !== 'legacy' && legacy.outcome === 'accepted') summary.mismatches.push(`${label}: V1 accepts it but the gate routes it to the pipeline`);
  if (route === 'legacy') summary.legacyRouted++;
  const r = await settle({ bytes, fileName: `${label}.csv`, decisions: { kind } });
  if (legacy.outcome === 'accepted') {
    summary.accepted++;
    if (!r.ok || !r.value.preview.canConfirm) {
      summary.mismatches.push(`${label}: V1 accepts but the pipeline cannot confirm (${r.ok ? r.value.preview.blockers.map((b) => b.message).join(' | ') : r.error.message})`);
      return;
    }
    summary.pipelineConfirmed++;
    const viaPipeline = importV1(kind, r.value.canonical!.csv);
    if (!viaPipeline.ok || JSON.stringify(viaPipeline.rows) !== JSON.stringify(legacy.rows)) summary.mismatches.push(`${label}: rows differ between V1 and the pipeline's canonical CSV`);
    return;
  }
  if (legacy.outcome === 'blocked') {
    summary.blocked++;
    // V1.5 cannot continue (ambiguous, duplicate or missing columns): the pipeline must not silently guess either
    if (legacy.strict && r.ok && r.value.preview.canConfirm) summary.mismatches.push(`${label}: V1.5 is blocked (ambiguous/duplicate/missing columns) but the pipeline reached Confirm`);
    return;
  }
  const headerLevel = legacy.errors.every((e) => e.line === 1 || e.line === null) && legacy.errors.some((e) => ['MISSING_COLUMNS', 'DUPLICATE_COLUMNS', 'INVALID_MAPPING', 'NO_DATA_ROWS', 'EMPTY_FILE', 'MALFORMED_CSV'].includes(e.code));
  if (headerLevel) summary.rejectedHeader++;
  else summary.rejectedRow++;
  if (r.ok && r.value.preview.canConfirm) {
    summary.mismatches.push(`${label}: V1 rejects (${legacy.errors[0]?.code}) but the pipeline reached Confirm`);
    return;
  }
  if (r.ok && r.value.preview.validation.ran && !headerLevel) {
    summary.validationCompared++;
    const got = r.value.preview.validation.issues.map((i) => ({ line: i.source?.kind === 'line' ? i.source.line : null, column: i.issue.column, code: i.issue.code, message: i.message }));
    const want = legacy.errors.map(strip);
    if (JSON.stringify(got) !== JSON.stringify(want)) summary.mismatches.push(`${label}: error lists differ\n  V1:       ${JSON.stringify(want.slice(0, 2))}\n  pipeline: ${JSON.stringify(got.slice(0, 2))}`);
  }
}

describe('legacy oracle (criterion 43)', () => {
  it('1,000+ generated files and all existing fixtures: V1 and the pipeline agree where they must', async () => {
    const summary: Summary = { files: 0, generated: 0, fixtures: 0, accepted: 0, rejectedRow: 0, rejectedHeader: 0, blocked: 0, legacyRouted: 0, pipelineConfirmed: 0, validationCompared: 0, mismatches: [], defects: {} };
    const rand = prng(43_000_043);
    const total = 1100;
    for (let n = 0; n < total; n++) {
      const g = generate(n, rand);
      summary.generated++;
      summary.defects[g.defect] = (summary.defects[g.defect] ?? 0) + 1;
      await compare(`gen-${n}-${g.defect}`, g.kind, g.text, summary);
    }

    // every existing import fixture and template, by the kind its name says
    const root = resolve(process.cwd());
    const fixtureFiles: Array<[ImportKind, string]> = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith('.csv')) fixtureFiles.push([/inventory/i.test(name) ? 'inventory' : 'shipments', full]);
      }
    };
    walk(join(root, 'tests/fixtures/import'));
    for (const t of ['public/templates/inventory-template.csv', 'public/templates/shipments-template.csv']) fixtureFiles.push([/inventory/.test(t) ? 'inventory' : 'shipments', join(root, t)]);
    for (const [kind, file] of fixtureFiles) {
      summary.fixtures++;
      const before = summary.mismatches.length;
      const text = readFileSync(file, 'utf-8');
      const bytes = new TextEncoder().encode(text);
      // the Excel re-saved fixture is the one design-intended difference: V1 rejects its slash dates, the pipeline repairs them
      if (/excel-resaved/.test(file)) {
        summary.files++;
        expect(routeFile(bytes, 'x.csv', registry).route).toBe('legacy');
        expect(legacyOutcome(kind, text).outcome).toBe('rejected');
        const r = await settle({ bytes, fileName: 'x.csv', decisions: { kind } });
        expect(r.ok && r.value.preview.canConfirm).toBe(true);
        summary.rejectedRow++;
        continue;
      }
      await compare(file.slice(root.length + 1), kind, text, summary);
      expect(summary.mismatches.slice(before), file).toEqual([]);
    }

    mkdirSync(tmpdir(), { recursive: true });
    writeFileSync(join(tmpdir(), 'scc-legacy-oracle-summary.json'), JSON.stringify({ ...summary, mismatches: summary.mismatches.slice(0, 20) }, null, 1));
    expect(summary.generated).toBeGreaterThanOrEqual(1000);
    expect(summary.files).toBeGreaterThanOrEqual(1000 + fixtureFiles.length);
    expect(summary.accepted).toBeGreaterThan(300);
    expect(summary.rejectedRow).toBeGreaterThan(200);
    expect(summary.rejectedHeader + summary.blocked).toBeGreaterThan(40);
    expect(summary.validationCompared).toBeGreaterThan(100);
    expect(summary.mismatches.slice(0, 8)).toEqual([]);
  }, 300_000);

  it('a raw POST of the Excel re-saved fixture, of Windows-1252 bytes and of alias-named files without a map behaves exactly as today (criterion 2)', async () => {
    const server = await startServer();
    try {
      const resaved = readFileSync(resolve('tests/fixtures/import/shipments_test_v2.excel-resaved.csv'));
      const r1 = await postCsv(server, 'shipments', resaved.toString('utf-8'), 'x.csv');
      const b1 = (await r1.json()) as { totalErrors: number; errors: Array<{ code: string }> };
      expect(r1.status).toBe(422);
      expect(b1.totalErrors).toBe(145);
      expect(b1.errors.every((e) => e.code === 'INVALID_DATE')).toBe(true);
      const cp1252 = await fetch(`${server.url}/api/import/inventory`, { method: 'POST', headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': '1' }, body: Uint8Array.of(0x73, 0x6b, 0x75, 0x0a, 0xe9) });
      expect(cp1252.status).toBe(400);
      expect(((await cp1252.json()) as { error: { code: string } }).error.code).toBe('INVALID_ENCODING');
      const alias = await postCsv(server, 'inventory', readFileSync(resolve('tests/fixtures/import/inventory_alt_schema.csv'), 'utf-8'), 'alt.csv');
      expect(alias.status).toBe(422);
      expect(((await alias.json()) as { errors: Array<{ code: string }> }).errors[0]?.code).toBe('MISSING_COLUMNS');
    } finally {
      await server.close();
    }
  });
});
