// Criterion 48, deeper than the detector/adapter fuzz: 6,000 mutated, structure-edited and random inputs through the WHOLE
// pipeline (detect, probe, read, structure, map, normalize, canonical CSV, dry run, preview), with random small limits so
// the limit branches are hit too. Per input: it never throws, finishes within budget, an error is a catalogue error with a
// clean message, and whenever the pipeline says "Confirm would be enabled" the unchanged V1 importer accepts the canonical
// CSV with exactly the promised row count (a differential property, not just "does not crash"). The run must also
// produce a real variety of outcomes, so the fuzz cannot pass by only exercising early refusals. Deterministic.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import { analyzeFile, type PipelineInput } from '../../../src/shared/ingest/pipeline';
import { importInventoryCsv } from '../../../src/shared/csv/importInventory';
import { importShipmentsCsv } from '../../../src/shared/csv/importShipments';
import { concat, cp1252, gzip, mutate, prng, randomBytes, utf16le, utf8, SAMPLE_COMMA_CSV } from '../../ingest-kit/corpus';
import { AMBIGUITY_FIXTURES, FIXTURES } from '../../fixtures/ingest/corpus45';

const registry = createDefaultRegistry();
const read = (p: string): string => readFileSync(p, 'utf8');

const SEEDS: Array<{ bytes: Uint8Array; name: string }> = [
  ...FIXTURES.map((f) => ({ bytes: f.bytes, name: f.hints.fileName })),
  ...AMBIGUITY_FIXTURES.map((f) => ({ bytes: f.bytes, name: f.hints.fileName })),
  { bytes: utf8(read('public/templates/inventory-template.csv')), name: 'inventory-template.csv' },
  { bytes: utf8(read('public/templates/shipments-template.csv')), name: 'shipments-template.csv' },
  { bytes: utf8(SAMPLE_COMMA_CSV), name: 'sample.csv' },
  { bytes: gzip(utf8(read('public/templates/inventory-template.csv'))), name: 'inv.csv.gz' },
  { bytes: utf16le(read('public/templates/shipments-template.csv'), true), name: 'ship16.csv' },
  { bytes: cp1252('sku,product_name,category,warehouse,quantity,reorder_point,unit_cost\nA-1,Café,Home,WH-DFW,3,1,9.5\n'), name: 'cafe.csv' }
];

const HOSTILE = ['=1+1', "=cmd|'/C calc'!A0", '@SUM(1)', '+1', '-1', '__proto__', 'constructor', 'toString', '<img src=x onerror=alert(1)>', '\u0000', '\u0001', '"', '""', ',', ';', '\t', '9'.repeat(400), 'x'.repeat(3000), '1,234.56', '1.234,56', '31/12/2026', '2026-13-45', '€5', ''];

/** Edits the TEXT of a seed (so well-formed files stay mostly well formed and reach the deep stages). */
function editText(rand: () => number, bytes: Uint8Array): Uint8Array {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return mutate(rand, bytes);
  const edits = 1 + Math.floor(rand() * 3);
  for (let e = 0; e < edits; e++) {
    const kind = Math.floor(rand() * 6);
    const i = Math.floor(rand() * lines.length);
    const line = lines[i] as string;
    const sep = /;/.test(line) ? ';' : /\t/.test(line) ? '\t' : /\|/.test(line) ? '|' : ',';
    const cells = line.split(sep);
    const c = Math.floor(rand() * Math.max(1, cells.length));
    if (kind === 0) cells[c] = HOSTILE[Math.floor(rand() * HOSTILE.length)] as string;
    else if (kind === 1) lines.splice(i, 1);
    else if (kind === 2) lines.splice(i, 0, line);
    else if (kind === 3) cells.splice(c, 1);
    else if (kind === 4) cells.splice(c, 0, HOSTILE[Math.floor(rand() * HOSTILE.length)] as string);
    else lines.splice(Math.floor(rand() * lines.length), 0, HOSTILE[Math.floor(rand() * HOSTILE.length)] as string);
    if (kind === 0 || kind === 3 || kind === 4) lines[i] = cells.join(sep);
  }
  return utf8(lines.join('\n'));
}

function limitsFor(rand: () => number): PipelineInput['limitConfig'] {
  const r = rand();
  if (r < 0.7) return {};
  if (r < 0.8) return { maxImportRows: 1 + Math.floor(rand() * 8) };
  if (r < 0.9) return { payloadBytes: 200 + Math.floor(rand() * 4000) };
  return { maxColumns: 3 + Math.floor(rand() * 8), maxScanRows: 5 + Math.floor(rand() * 20) };
}

interface Case {
  bytes: Uint8Array;
  name: string;
  limits: PipelineInput['limitConfig'];
}

function cases(count: number, seed: number): Case[] {
  const rand = prng(seed);
  const out: Case[] = [];
  for (let i = 0; i < count; i++) {
    const s = SEEDS[Math.floor(rand() * SEEDS.length)] as (typeof SEEDS)[number];
    const k = rand();
    let bytes: Uint8Array;
    if (k < 0.45) bytes = editText(rand, s.bytes);
    else if (k < 0.8) bytes = mutate(rand, s.bytes);
    else if (k < 0.9) bytes = concat(s.bytes.subarray(0, Math.floor(rand() * s.bytes.length)), randomBytes(rand, Math.floor(rand() * 40)));
    else bytes = randomBytes(rand, Math.floor(rand() * 400));
    out.push({ bytes, name: rand() < 0.5 ? s.name : ['x.csv', 'x.txt', 'x.xlsx', 'data', 'x.gz'][Math.floor(rand() * 5)] as string, limits: limitsFor(rand) });
  }
  return out;
}

async function drive(c: Case) {
  return analyzeFile({ bytes: c.bytes, fileName: c.name, limitConfig: c.limits }, { registry, clock: () => performance.now() });
}

function fingerprint(r: Awaited<ReturnType<typeof drive>>): string {
  if (!r.ok) return `E:${r.error.code}:${r.error.message}`;
  const p = r.value.preview;
  return `O:${r.value.kind}:${p.canConfirm}:${p.blockers.map((b) => b.code).join(',')}:${r.value.canonical?.csv ?? ''}:${p.validation.totalErrors}`;
}

describe('whole-pipeline fuzz (criterion 48)', () => {
  it('6,000 inputs: never throws, in budget, clean errors, V1 accepts every confirmable canonical CSV, varied outcomes, deterministic', async () => {
    const all = cases(6000, 20260930);
    const started = performance.now();
    let slowest = 0;
    const codes = new Map<string, number>();
    let confirmable = 0;
    let blocked = 0;
    let datasets = { inventory: 0, shipments: 0 };
    const prints: string[] = [];
    for (const c of all) {
      const t0 = performance.now();
      let r: Awaited<ReturnType<typeof drive>>;
      try {
        r = await drive(c);
      } catch (e) {
        throw new Error(`threw on ${c.name} (${c.bytes.length} bytes): ${(e as Error).message}`);
      }
      slowest = Math.max(slowest, performance.now() - t0);
      prints.push(fingerprint(r));
      if (!r.ok) {
        codes.set(r.error.code, (codes.get(r.error.code) ?? 0) + 1);
        // an error is a catalogue error: a plain sentence, no control characters, never an echo of the input
        expect(r.error.message.length).toBeGreaterThan(5);
        expect(r.error.message.length).toBeLessThan(700);
        expect(r.error.message).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
        continue;
      }
      const a = r.value;
      if (a.preview.canConfirm) {
        confirmable++;
        expect(a.canonical).not.toBeNull();
        expect(a.kind).not.toBeNull();
        const csv = (a.canonical as NonNullable<typeof a.canonical>).csv;
        const limits = { maxRows: c.limits?.maxImportRows ?? 20_000, maxColumns: 50 };
        const v1 = a.kind === 'inventory' ? importInventoryCsv(csv, limits) : importShipmentsCsv(csv, limits);
        expect(v1.ok, `V1 must accept what the pipeline lets through (${c.name})`).toBe(true);
        if (v1.ok) expect(v1.rows.length).toBe((a.canonical as NonNullable<typeof a.canonical>).rowCount);
        datasets[a.kind as 'inventory' | 'shipments']++;
      } else {
        blocked++;
        expect(a.preview.blockers.length).toBeGreaterThan(0);
        expect(a.preview.confirmBlockedReason).not.toBeNull();
      }
    }
    expect(performance.now() - started).toBeLessThan(120_000);
    expect(slowest).toBeLessThan(5000);
    // the fuzz is not superficial: many different outcomes were reached
    expect(codes.size).toBeGreaterThanOrEqual(6);
    expect(confirmable).toBeGreaterThan(150);
    expect(blocked).toBeGreaterThan(300);
    expect(datasets.inventory).toBeGreaterThan(20);
    expect(datasets.shipments).toBeGreaterThan(20);
    // deterministic: the same inputs give byte-identical outcomes
    const again: string[] = [];
    for (const c of all.slice(0, 400)) again.push(fingerprint(await drive(c)));
    expect(again).toEqual(prints.slice(0, 400));
    expect(new Set(prints).size).toBeGreaterThan(400);
  }, 240_000);

  it('the same cases generated twice are identical (the fuzz itself is deterministic)', () => {
    const a = cases(200, 5);
    const b = cases(200, 5);
    expect(a.map((c) => [Array.from(c.bytes.subarray(0, 64)), c.name, c.limits])).toEqual(b.map((c) => [Array.from(c.bytes.subarray(0, 64)), c.name, c.limits]));
  });
});
