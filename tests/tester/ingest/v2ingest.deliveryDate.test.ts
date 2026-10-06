// TESTER (Agent 3): the documented V1.5-compatibility deviation "Delivery Date" -> actual_delivery (STRONG).
// Risk: in many companies "Delivery Date" is the PLANNED date. This test records what the pipeline does with such a
// file (future dates on in-transit / pending rows), whether the decision carries evidence, and whether the user can
// correct it (assignment override) with the canonical CSV following the correction.

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeFile } from '../../../src/shared/ingest/pipeline';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';

const HEADER = 'Shipment ID,Origin,Destination,Carrier,Status,Ship Date,Delivery Date,Shipping Cost';
const ROWS = [
  'SHP-700001,Dallas,Houston,Northstar Freight,in_transit,2026-03-02,2026-03-09,812.40',
  'SHP-700002,Atlanta,Chicago,Summit Express,pending,2026-03-03,2026-03-11,410.00',
  'SHP-700003,Newark,Atlanta,Prairie Lines,in_transit,2026-03-04,2026-03-08,95.10',
  'SHP-700004,Dallas,Phoenix,Northstar Freight,pending,2026-03-05,2026-03-12,300.00'
];
const bytes = new TextEncoder().encode([HEADER, ...ROWS].join('\n') + '\n');
const env = { registry: createDefaultRegistry() };

describe('TESTER: "Delivery Date" deviation (V1.5 compatibility)', () => {
  it('is MATCHED to actual_delivery with evidence, even when the values are planned (future) dates on undelivered rows', async () => {
    const res = await analyzeFile({ bytes, fileName: 'planned.csv', decisions: { kind: 'shipments' } }, env);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const col = res.value.preview.columns.find((c) => c.header === 'Delivery Date');
    expect(col?.state).toBe('matched');
    expect(col?.field).toBe('actual_delivery');
    expect(col?.evidence.length ?? 0).toBeGreaterThan(0);
    // The file has no estimated_delivery column: it is imported as unknown, actual_delivery receives the planned dates.
    const eta = res.value.preview.fields.find((f) => f.field === 'estimated_delivery');
    expect(eta?.unknown).toBe(true);
    const csv = res.value.canonical?.csv ?? '';
    expect(csv.split(/\r?\n/)[1]).toBe('SHP-700001,Dallas,Houston,Northstar Freight,in_transit,2026-03-02,,2026-03-09,812.40');
    // record whether V1 accepts actual_delivery on undelivered rows (it is the authoritative validator)
    expect(res.value.preview.validation.ran).toBe(true);
    // RISK RECORDED (finding, not a gate): planned dates on undelivered rows are accepted as actual deliveries with no
    // CHECK, no warning and Confirm enabled; only the "Why?" evidence and the user's own review protect the data.
    expect(res.value.preview.validation.ok).toBe(true);
    expect(res.value.preview.canConfirm).toBe(true);
    writeFileSync(join(tmpdir(), 'scc-tester-deliverydate.json'), JSON.stringify({ ok: res.value.preview.validation.ok, warnings: res.value.preview.validation.warnings, canConfirm: res.value.preview.canConfirm, blockers: res.value.preview.blockers.map((b) => b.code) }));
  });

  it('lets the user correct it to estimated_delivery and the canonical CSV follows the correction', async () => {
    const first = await analyzeFile({ bytes, fileName: 'planned.csv', decisions: { kind: 'shipments' } }, env);
    if (!first.ok) throw new Error('unexpected');
    const idx = first.value.preview.columns.findIndex((c) => c.header === 'Delivery Date');
    const res = await analyzeFile({ bytes, fileName: 'planned.csv', decisions: { kind: 'shipments', assignments: new Map([[idx, 'estimated_delivery']]) } }, env);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const col = res.value.preview.columns[idx];
    expect(col?.field).toBe('estimated_delivery');
    expect(col?.chosenByUser).toBe(true);
    expect(res.value.preview.fields.find((f) => f.field === 'actual_delivery')?.unknown).toBe(true);
    expect((res.value.canonical?.csv ?? '').split(/\r?\n/)[1]).toBe('SHP-700001,Dallas,Houston,Northstar Freight,in_transit,2026-03-02,2026-03-09,,812.40');
    expect(res.value.preview.canConfirm).toBe(true);
  });
});
