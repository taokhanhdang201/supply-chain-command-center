// TESTER (Agent 3): an independent T-DUMMY (SA-1, criteria 23-24) with an adapter of my own design that yields RECORDS
// (not tables), registered from this test only, through the whole real pipeline and the real endpoint. Plus the
// concrete mapping behaviours of criterion 13 and the unwired registry helper `setDisabled`.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import { analyzeFile } from '../../../src/shared/ingest/pipeline';
import { acceptAttribute, ingestError, supportedFormatsText, unsupportedTypeMessage } from '../../../src/shared/ingest/messages';
import { NO_VOTE, type FormatAdapter, type RecordNode } from '../../../src/shared/ingest/types';
import { createApiHandler } from '../../../src/server/api';
import { createAppServer } from '../../../src/server/app';
import { createDataStore } from '../../../src/server/store';
import { createSampleDataset } from '../../../src/shared/sample/generateSampleData';
import { proposeMapping } from '../../../src/shared/ingest/mapping/report';
import { profileColumn } from '../../../src/shared/ingest/structure/profile';

const MAGIC = '%%BLOCKS v1\n';
const magicBytes = [...new TextEncoder().encode(MAGIC)];

/** "Block" format: a magic line, then records of `Key: value` lines separated by blank lines. */
const blockAdapter: FormatAdapter = {
  descriptor: {
    id: 'tester-blocks',
    version: '0.1.0',
    family: 'Tester block records',
    status: 'experimental',
    hints: { extensions: ['.blk'], mimeTypes: ['text/x-blocks'] },
    signatures: [{ offset: 0, bytes: magicBytes }],
    contentSniff: false,
    yields: ['records'],
    multiTable: false,
    hierarchical: true,
    typedCells: false,
    streaming: 'none',
    sourceRefKind: ['path'],
    wrappable: true,
    resourceHints: { needsWorker: false },
    messages: {}
  },
  detect(head) {
    return magicBytes.every((b, i) => head[i] === b) ? { confidence: 1, evidenceClass: 'magic', evidence: ['block header line'] } : NO_VOTE;
  },
  async probe(src) {
    return { ok: true, value: { tables: [{ name: 'Blocks', hidden: false }], choices: [], evidence: [`${src.size} bytes of blocks`], notices: [], facts: {} } };
  },
  async read(src, _sel, opts, ctx) {
    if (ctx.signal.aborted) return { ok: false, error: ingestError('CANCELLED', 'read') };
    const text = new TextDecoder('utf-8', { fatal: false }).decode(src.read(0, src.size)).slice(MAGIC.length);
    const blocks = text.split(/\n\s*\n/).filter((b) => b.trim() !== '');
    const records: RecordNode[] = blocks.slice(0, opts.maxRows).map((b, index) => ({
      path: `$.block[${index}]`,
      index,
      entries: b.split('\n').filter((l) => l.includes(':')).map((l): [string, string] => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()])
    }));
    return { ok: true, value: { kind: 'records', records, name: 'Blocks' } };
  }
};

const rows = [
  ['SHP-300001', 'Hamburg', 'Bremen', 'Nordfracht', 'Zugestellt', '02.03.2026', '05.03.2026', '04.03.2026', '812,40'],
  ['SHP-300002', 'Berlin', 'Leipzig', 'Nordfracht', 'Unterwegs', '03.03.2026', '06.03.2026', '', '410,00'],
  ['SHP-300003', 'Köln', 'Bonn', 'Rheinlog', 'Storniert', '04.03.2026', '07.03.2026', '', '95,10']
];
const keys = ['Sendungsnummer', 'Abgangsort', 'Zielort', 'Spediteur', 'Status', 'Versanddatum', 'Liefertermin', 'Zustelldatum', 'Frachtkosten'];
const file = new TextEncoder().encode(MAGIC + rows.map((r) => r.map((v, i) => `${keys[i]}: ${v}`).join('\n')).join('\n\n') + '\n');

function hashTree(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(p).update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex');
}

describe('TESTER T-DUMMY: my own records adapter, registered from the test only', () => {
  it('changes the generated texts only after registration', () => {
    const r = createDefaultRegistry();
    const before = [supportedFormatsText(r), acceptAttribute(r), unsupportedTypeMessage(r, null)];
    r.register(blockAdapter);
    const after = [supportedFormatsText(r), acceptAttribute(r), unsupportedTypeMessage(r, null)];
    expect(after[0]).toContain('Tester block records (.blk)');
    expect(after[1]).toContain('.blk');
    expect(after[2]).toContain('Tester block records (.blk)');
    for (let i = 0; i < 3; i++) expect(after[i]).not.toBe(before[i]);
  });

  it('is detected, flattened, mapped (German keys), normalized, previewed with path references, and imported through the real endpoint; src/ untouched', async () => {
    const srcHash = hashTree(resolve(process.cwd(), 'src'));
    const plain = await analyzeFile({ bytes: file, fileName: 'x.blk' }, { registry: createDefaultRegistry() });
    expect(plain.ok && plain.value.preview.file.adapterId).not.toBe('tester-blocks');

    const registry = createDefaultRegistry();
    registry.register(blockAdapter);
    const first = await analyzeFile({ bytes: file, fileName: 'loads.blk', decisions: { kind: 'shipments' } }, { registry });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // FINDING (recorded): the key "Status" is the exact canonical name, but "Zugestellt" (the usual German carrier word for
    // delivered) is not in the status vocabulary, so the values look unlike statuses and the column drops to CHOOSE.
    const statusIdx = first.value.preview.columns.findIndex((c) => c.header === 'Status');
    expect(first.value.preview.columns[statusIdx]?.state).toBe('choose');
    const decisions = { kind: 'shipments' as const, assignments: new Map<number, string | null>([[statusIdx, 'status']]) };
    let r = await analyzeFile({ bytes: file, fileName: 'loads.blk', decisions }, { registry });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.preview.file.adapterId).toBe('tester-blocks');
    expect(r.value.preview.file.evidence).toContain('block header line');
    // answer what the preview asks, like a user: acknowledge CHECK columns, map open status words
    const open = (r.value.preview.valueMaps.status ?? []).filter((e) => e.state === 'choose').map((e) => e.source);
    const statusChoices = new Map(open.map((s) => [s, s === 'Zugestellt' ? 'delivered' : s === 'Unterwegs' ? 'in_transit' : 'cancelled']));
    r = await analyzeFile({ bytes: file, fileName: 'loads.blk', decisions: { ...decisions, statusChoices, acknowledgedColumns: r.value.preview.columns.filter((c) => c.state === 'check').map((c) => c.index) } }, { registry });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.value.preview;
    const fields = p.columns.map((c) => c.field);
    for (const f of ['shipment_id', 'origin', 'destination', 'carrier', 'status', 'ship_date', 'estimated_delivery', 'shipping_cost']) expect(fields, f).toContain(f);
    expect(p.sample.rows[0]?.source).toMatch(/block\[0\]/);
    expect(p.canConfirm, p.blockers.map((b) => b.message).join(' | ')).toBe(true);
    const csv = r.value.canonical?.csv ?? '';
    expect(csv.split('\n')[1]).toMatch(/^SHP-300001,Hamburg,Bremen,Nordfracht,delivered,2026-03-02,2026-03-05,/);
    expect(csv).toContain(',812.40');

    const config = { port: 0, host: '127.0.0.1', seed: 42, todayOverride: '2026-06-15', maxUploadBytes: 2_097_152, mode: 'test' as const };
    const make = () => createSampleDataset(42, '2026-06-15', '2026-06-15T00:00:00.000Z');
    const store = createDataStore(make());
    const server = createAppServer({ config, api: createApiHandler({ config, store, getToday: () => '2026-06-15', createSampleDataset: make }) });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const res = await fetch(`${url}/api/import/shipments`, { method: 'POST', headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': '1', 'X-SCC-Filename': 'loads.blk' }, body: csv });
      expect(res.status).toBe(200);
      expect(store.getDataset().shipments.map((s) => s.shipmentId)).toEqual(['SHP-300001', 'SHP-300002', 'SHP-300003']);
      expect(store.getDataset().sources.shipments.label).toBe('loads.blk');
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
    expect(hashTree(resolve(process.cwd(), 'src'))).toBe(srcHash);
  });

  it('setDisabled (implemented, unwired) turns my adapter into "not enabled" without code changes', async () => {
    const registry = createDefaultRegistry();
    registry.register(blockAdapter);
    registry.setDisabled(['tester-blocks']);
    const r = await analyzeFile({ bytes: file, fileName: 'loads.blk' }, { registry });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('not enabled');
  });
});

describe('TESTER criterion 13: concrete mapping behaviours, independently', () => {
  const ids = ['SHP-1', 'SHP-2', 'SHP-3', 'SHP-4'].map((v) => ({ v: v.replace('-', '-90000'), t: 'text' as const }));
  const st = ['delivered', 'in_transit', 'pending', 'delivered'].map((v) => ({ v, t: 'text' as const }));
  const map = (headers: string[], cols: Array<Array<{ v: string; t: 'text' }>>) => proposeMapping('shipments', headers, headers.map((h, i) => profileColumn(h, cols[i] ?? [])));

  it('Consignment Reference is MATCHED to shipment_id', () => {
    const p = map(['Consignment Reference'], [ids]);
    expect([p.columns[0]?.state, p.columns[0]?.field]).toEqual(['matched', 'shipment_id']);
  });
  it('Tracking Number is CHECK or MATCHED to shipment_id, with evidence', () => {
    const c = map(['Tracking Number'], [ids]).columns[0];
    expect(['check', 'matched']).toContain(c?.state);
    expect(c?.field).toBe('shipment_id');
    expect(c?.evidence.length).toBeGreaterThan(0);
  });
  it('Order No. alone is CHECK (never MATCHED) with an "order" warning', () => {
    const c = map(['Order No.'], [ids]).columns[0];
    expect(c?.state).toBe('check');
    expect(c?.warnings.join(' ').toLowerCase()).toContain('order');
  });
  it('Order No. together with Tracking Number: both CHOOSE (competing)', () => {
    const p = map(['Order No.', 'Tracking Number'], [ids, ids]);
    expect(p.columns.map((c) => c.state)).toEqual(['choose', 'choose']);
    expect(p.columns.map((c) => c.reason)).toEqual(['competing', 'competing']);
  });
  it('Date, Cost, Location stay CHOOSE with the V1.5 candidate lists', () => {
    const dates = ['2026-03-02', '2026-03-03'].map((v) => ({ v, t: 'text' as const }));
    const p = map(['Date', 'Cost', 'Location'], [dates, [{ v: '10.00', t: 'text' }], [{ v: 'Dallas', t: 'text' }]]);
    expect(p.columns.map((c) => c.state)).toEqual(['choose', 'choose', 'choose']);
    expect(p.columns[0]?.candidates.map((x) => x.field)).toEqual(['ship_date', 'estimated_delivery', 'actual_delivery']);
    expect(p.columns[1]?.candidates.map((x) => x.field)).toEqual(['shipping_cost']);
    expect(p.columns[2]?.candidates.map((x) => x.field)).toEqual(['origin', 'destination']);
  });
  it('a meaningless header over status words gets at most a profile-only CHECK; a junk column is not imported', () => {
    const p = map(['Col7', 'Notes'], [st, [{ v: 'call first', t: 'text' }, { v: 'fragile', t: 'text' }]]);
    expect(['check', 'choose', 'ignored']).toContain(p.columns[0]?.state);
    expect(p.columns[0]?.state).not.toBe('matched');
    expect(p.columns[1]?.state).toBe('ignored');
  });
});
