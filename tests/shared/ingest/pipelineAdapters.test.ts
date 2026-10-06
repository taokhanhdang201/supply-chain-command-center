// Criteria 23 and 24 through the REAL pipeline: T-DUMMY (a toy adapter registered from the test only is detected, read,
// structured, mapped, previewed, validated and imported) and the three SA-3 fake adapters (multi-table typed-cell,
// nested-record, positioned-text) with goldens and source references translated back to each source's own coordinates.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import { canonicalCsv, shipmentRows, inventoryRows, type LogicalRow } from '../../fixtures/ingest/corpus45';
import { encodeMulti, encodePositioned, encodeRecords, encodeToy, encodeImagesOnly, fakeAdapters, toyAdapter, type FakeSheet } from '../../ingest-kit/fakeAdapters';
import { analyze, must, settle } from '../../ingest-kit/pipelineHarness';
import { postCsv, startServer, type TestServer } from '../../ingest-kit/serverHarness';
import { supportedFormatsText } from '../../../src/shared/ingest/messages';
import { importInventoryCsv } from '../../../src/shared/csv/importInventory';
import type { RawCell, RawTable, TextRun } from '../../../src/shared/ingest/types';
import type { TableInference } from '../../../src/shared/ingest/flatten/positioned';

const registryWithFakes = () => {
  const r = createDefaultRegistry();
  for (const a of fakeAdapters) r.register(a);
  return r;
};

const SHIP_HEADERS = ['Consignment Reference', 'Pickup From', 'Deliver To', 'Haulier', 'State', 'Dispatched On', 'ETA', 'Delivered On', 'Freight Charge'];
const SHIP_FIELDS = ['shipment_id', 'origin', 'destination', 'carrier', 'status', 'ship_date', 'estimated_delivery', 'actual_delivery', 'shipping_cost'];
const STATUS_WORD: Record<string, string> = { delivered: 'Delivered', in_transit: 'Dispatched', pending: 'Booked', cancelled: 'Cancelled' };
const rows = shipmentRows(6);
const goldenShipments = canonicalCsv('shipments', rows);
const wordRow = (r: LogicalRow): string[] => SHIP_FIELDS.map((f) => (f === 'status' ? (STATUS_WORD[r.status as string] as string) : (r[f] as string)));

function hashCore(): string {
  const root = resolve(process.cwd(), 'src/shared/ingest');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const n of readdirSync(dir).sort()) {
      const full = join(dir, n);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(root);
  const h = createHash('sha256');
  for (const f of files) h.update(f).update(readFileSync(f));
  return h.digest('hex');
}

describe('T-DUMMY: a toy-format adapter through the whole pipeline (criterion 23, SA-1)', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startServer();
  });
  afterAll(async () => {
    await server.close();
  });

  const invRows = inventoryRows(4);
  const keys = ['sku', 'product_name', 'category', 'warehouse', 'quantity', 'reorder_point', 'unit_cost'];
  const toyBytes = encodeToy(invRows.map((r) => keys.map((k): [string, string] => [k, r[k] as string])));

  it('is detected, parsed, structured, mapped, normalized, previewed, validated and imported without editing anything under src/', async () => {
    const before = hashCore();
    const registry = createDefaultRegistry();
    // before registration the toy text is just plain text to the generic text reader: not an inventory file
    const without = await analyze({ bytes: toyBytes, fileName: 'stock.toy' }, {}, registry);
    expect(without.ok && without.value.preview.file.adapterId).toBe('delimited-text');
    registry.register(toyAdapter);
    const a = must(await settle({ bytes: toyBytes, fileName: 'stock.toy' }, {}, {}, registry));
    expect(a.preview.file).toMatchObject({ adapterId: 'toy-kv', family: 'Toy key-value text' });
    expect(a.preview.file.evidence).toContain('toy format header line');
    expect(a.preview.structure?.headerRow).toBeDefined();
    expect(a.preview.columns.map((c) => [c.header, c.field, c.state])).toEqual(keys.map((k) => [k, k, 'matched']));
    expect(a.preview.dataset).toMatchObject({ kind: 'inventory' });
    expect(a.preview.validation).toMatchObject({ ran: true, ok: true });
    expect(a.preview.sample.rows[0]?.source).toBe('line 2');
    expect(a.preview.canConfirm).toBe(true);
    const golden = canonicalCsv('inventory', invRows.map((r) => ({ ...r, avg_daily_usage: '', lead_time_days: '' })));
    expect(a.canonical?.csv).toBe(golden);

    // the import through the unchanged endpoint replaces the dataset
    const res = await postCsv(server, 'inventory', a.canonical!.csv, a.canonical!.fileName);
    expect(res.status).toBe(200);
    const imported = importInventoryCsv(golden);
    expect(imported.ok).toBe(true);
    expect(server.store.getDataset().inventory).toEqual(imported.ok ? imported.rows : null);
    expect(server.store.getDataset().inventory).toHaveLength(4);
    expect(server.store.getDataset().sources.inventory).toMatchObject({ kind: 'import', label: 'stock.toy', rowCount: 4 });
    expect(hashCore()).toBe(before); // nothing in the core was edited or patched by the test
  });

  it('registering it changes the generated supported-format text (no message edited)', () => {
    const registry = createDefaultRegistry();
    const before = supportedFormatsText(registry);
    registry.register(toyAdapter);
    expect(supportedFormatsText(registry)).toContain('Toy key-value text (.toy)');
    expect(supportedFormatsText(registry)).not.toBe(before);
  });
});

describe('SA-3 fake adapter: multi-table typed-cell source (criterion 24)', () => {
  const sheet = (data: RawCell[][], over: Partial<FakeSheet> = {}): FakeSheet => ({
    name: 'Loads',
    rows: data.map((r) => r.map((c) => ({ v: c.v, t: c.t }))),
    ...over
  });
  const headerRow: RawCell[] = SHIP_HEADERS.map((v) => ({ v, t: 'text' as const }));
  const dataRows = (list: LogicalRow[]): RawCell[][] =>
    list.map((r) =>
      wordRow(r).map((v, i): RawCell => {
        const field = SHIP_FIELDS[i] as string;
        if (field === 'ship_date' || field === 'estimated_delivery' || (field === 'actual_delivery' && v !== '')) return { v, t: 'date' };
        if (field === 'shipping_cost') return { v, t: 'number' };
        return { v, t: 'text' };
      })
    );
  const book = (list: LogicalRow[]) => encodeMulti([sheet([headerRow, ...dataRows(list)], { merged: [[1, 0]] }), { name: 'Notes', hidden: true, rows: [[{ v: 'internal', t: 'text' }]] }]);

  it('reads the visible sheet with typed dates and numbers, skips the hidden one, and builds the golden CSV', async () => {
    const a = must(await settle({ bytes: book(rows), fileName: 'book.mtc' }, {}, {}, registryWithFakes()));
    expect(a.preview.file.adapterId).toBe('fake-multi');
    expect(a.preview.tables).toEqual([
      { name: 'Loads', hidden: false, rows: 7, selected: true },
      { name: 'Notes', hidden: true, rows: 1, selected: false }
    ]);
    expect(a.preview.blockers).toEqual([]); // the hidden sheet is not offered as a choice
    expect(a.canonical?.csv).toBe(goldenShipments);
    expect(a.preview.presets.date).toBeNull(); // typed date cells need no format
    expect(a.preview.structure?.headerRow).toBe("Sheet 'Loads', row 1");
    expect(a.preview.sample.rows[0]?.source).toBe("Sheet 'Loads', row 2");
  });

  it('translates validation issues to the sheet and cell of the user\'s workbook', async () => {
    const broken = rows.map((r, i) => (i === 3 ? { ...r, shipping_cost: '-5.00' } : r));
    const a = must(await settle({ bytes: book(broken), fileName: 'book.mtc' }, {}, {}, registryWithFakes()));
    expect(a.preview.canConfirm).toBe(false);
    const issue = a.preview.validation.issues[0]!;
    expect(issue.source).toEqual({ kind: 'cell', sheet: 'Loads', row: 5, col: 1 });
    expect(issue.where).toBe("Sheet 'Loads', row 5");
    expect(a.preview.sample.problemRows[0]?.source).toBe("Sheet 'Loads', row 5");
  });

  it('two visible sheets ask which one to import', async () => {
    const two = encodeMulti([sheet([headerRow, ...dataRows(rows)]), { ...sheet([headerRow, ...dataRows(rows)]), name: 'Loads 2' }]);
    const a = must(await analyze({ bytes: two, fileName: 'two.mtc' }, {}, registryWithFakes()));
    expect(a.preview.blockers.map((b) => b.code)).toContain('choose-table');
    expect(a.preview.tables.filter((t) => !t.hidden)).toHaveLength(2);
  });
});

describe('SA-3 fake adapter: nested-record source (criterion 24)', () => {
  const nested = (r: LogicalRow) => ({
    shipment_id: r.shipment_id,
    origin: { city: r.origin },
    destination: { city: r.destination },
    carrier: r.carrier,
    status: STATUS_WORD[r.status as string],
    ship_date: r.ship_date,
    estimated_delivery: r.estimated_delivery,
    actual_delivery: r.actual_delivery === '' ? null : r.actual_delivery,
    shipping_cost: r.shipping_cost,
    events: [{ code: 'A' }, { code: 'B' }]
  });

  it('flattens records into path columns (and child tables), maps them and builds the golden CSV', async () => {
    const a = must(await settle({ bytes: encodeRecords('shipments', rows.map(nested)), fileName: 'ship.rec' }, {}, {}, registryWithFakes()));
    expect(a.preview.file.adapterId).toBe('fake-records');
    expect(a.preview.tables.map((t) => t.name)).toEqual(['shipments', 'shipments.events']);
    expect(a.preview.columns.map((c) => c.header)).toEqual(['shipment_id', 'origin.city', 'destination.city', 'carrier', 'status', 'ship_date', 'estimated_delivery', 'actual_delivery', 'shipping_cost']);
    expect(a.preview.columns.map((c) => c.field)).toEqual(SHIP_FIELDS);
    expect(a.preview.blockers).toEqual([]);
    expect(a.canonical?.csv).toBe(goldenShipments);
  });

  it('translates issues to record paths', async () => {
    const bad = rows.map(nested);
    (bad[2] as { shipping_cost: string }).shipping_cost = '-9.00';
    const a = must(await settle({ bytes: encodeRecords('shipments', bad), fileName: 'ship.rec' }, {}, {}, registryWithFakes()));
    const issue = a.preview.validation.issues[0]!;
    expect(issue.source).toEqual({ kind: 'path', path: '$.shipments[2]', index: 2 });
    expect(issue.where).toBe('$.shipments[2] (record 3)');
  });
});

describe('SA-3 fake adapter: positioned-text source (criterion 24)', () => {
  const run = (text: string, x: number, y: number): TextRun => ({ text, x, y, w: text.length * 5, h: 8 });
  const pageOf = (list: LogicalRow[], startY = 10): TextRun[] => {
    const lines = [SHIP_HEADERS, ...list.map(wordRow)];
    return lines.flatMap((cells, r) => cells.map((c, k) => run(c, 10 + k * 60, startY + r * 12)));
  };
  /** The test-local table-inference step: group runs into lines by y, order by x, one page reference per row. */
  const inference: TableInference = ({ adapterId, name, pages }) =>
    pages.map((page, p) => {
      const byY = new Map<number, TextRun[]>();
      for (const r of page) byY.set(r.y, [...(byY.get(r.y) ?? []), r]);
      const lines = [...byY.entries()].sort((a, b) => a[0] - b[0]).map(([, rs]) => rs.sort((a, b) => a.x - b.x));
      const cells = lines.map((l) => l.map((r): RawCell => ({ v: r.text, t: 'text' })));
      const table: RawTable = {
        ref: { adapterId, name: `${name} ${p + 1}`, index: p },
        name: `${name} ${p + 1}`,
        hidden: false,
        rows: cells,
        rowCount: cells.length,
        colCount: Math.max(...cells.map((c) => c.length)),
        truncated: false,
        origin: (r, c) => ({ kind: 'page', page: p + 1, bbox: [lines[r]?.[c ?? 0]?.x ?? 0, lines[r]?.[0]?.y ?? 0, 0, 0] }),
        notes: []
      };
      return table;
    });

  it('turns text runs into a table with the registered inference step and builds the golden CSV', async () => {
    const a = must(await settle({ bytes: encodePositioned([pageOf(rows)]), fileName: 'ship.ptx' }, {}, { inference }, registryWithFakes()));
    expect(a.preview.file.adapterId).toBe('fake-positioned');
    expect(a.canonical?.csv).toBe(goldenShipments);
    expect(a.preview.sample.rows[0]?.source).toMatch(/^page 1, near \(/);
  });

  it('translates issues to the page and position', async () => {
    const bad = rows.map((r, i) => (i === 1 ? { ...r, shipping_cost: '-1.00' } : r));
    const a = must(await settle({ bytes: encodePositioned([pageOf(bad)]), fileName: 'ship.ptx' }, {}, { inference }, registryWithFakes()));
    expect(a.preview.validation.issues[0]?.source).toMatchObject({ kind: 'page', page: 1 });
    expect(a.preview.validation.issues[0]?.where).toMatch(/^page 1, near \(10, \d+\)$/);
  });

  it('without a registered inference step there is no table; an image-only source is refused with the generated text', async () => {
    const none = await analyze({ bytes: encodePositioned([pageOf(rows)]), fileName: 'ship.ptx' }, {}, registryWithFakes());
    expect(none).toMatchObject({ ok: false, error: { code: 'NO_TABLE' } });
    const images = await analyze({ bytes: encodeImagesOnly(3), fileName: 'scan.ptx' }, {}, registryWithFakes());
    expect(images).toMatchObject({ ok: false, error: { code: 'NO_READABLE_TEXT' } });
    expect(!images.ok && images.error.message).toContain('no readable text content');
  });
});
