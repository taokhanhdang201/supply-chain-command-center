// Criterion 47, the full cross product: EVERY combination of delimiter (4) x number preset (4) x date preset (5) x encoding
// (4) is rendered for BOTH datasets (640 datasets; Vietnamese is not representable in Windows-1252, so those combinations
// use another language), with shuffled columns, line endings varied, and alias headers in the five languages. Each file is
// re-ingested through the real pipeline and compared ROW BY ROW and CELL BY CELL with the original canonical rows (parsed
// with the unchanged V1 CSV parser, independent of the golden text), and the unchanged V1 importers must read the same
// values. Whatever the user must answer (an ambiguous number or date format) is answered with the TRUE format, as a person
// would; answering is part of the property, and the share of files that needed it is bounded.

import { describe, expect, it } from 'vitest';
import { defaultDict } from '../../../src/shared/ingest/mapping/dictionary';
import type { LanguageCode } from '../../../src/shared/ingest/mapping/dictionary';
import type { InventoryRecord, ShipmentRecord } from '../../../src/shared/types';
import { parseCsv } from '../../../src/shared/csv/parseCsv';
import { importInventoryCsv } from '../../../src/shared/csv/importInventory';
import { importShipmentsCsv } from '../../../src/shared/csv/importShipments';
import { CANONICAL_FIELDS, inventoryRows, makeFixture, shipmentRows, type Encoding, type Kind, type RenderSpec } from '../../fixtures/ingest/corpus45';
import type { DateStyle, NumberStyle } from '../../fixtures/ingest/gen';
import { prng } from '../../ingest-kit/corpus';
import { inputOf, settle } from '../../ingest-kit/pipelineHarness';

const LANGS: LanguageCode[] = ['en', 'vi', 'es', 'de', 'fr'];
const DELIMS = [',', ';', '\t', '|'] as const;
const NUMBER_STYLES: NumberStyle[] = ['plain', 'us', 'eu', 'fr'];
const DATE_STYLES: DateStyle[] = ['iso', 'mdy', 'dmy', 'dot', 'ymd'];
const ENCODINGS: Encoding[] = ['utf8', 'utf8bom', 'utf16le', 'cp1252'];
const DATE_PRESET = { iso: 'iso', mdy: 'mdy_slash', dmy: 'dmy_slash', dot: 'dmy_dot', ymd: 'ymd_slash' } as const;

function shuffle<T>(rand: () => number, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function headersFor(kind: Kind, language: LanguageCode, rand: () => number): Record<string, string> {
  const dict = defaultDict();
  const out: Record<string, string> = {};
  for (const field of CANONICAL_FIELDS[kind]) {
    const strong = dict.recordsFor(kind, field).filter((r) => r.language === language && r.strength === 'strong' && !/^(de|to|from|par|du)$/.test(r.key));
    const pool = strong.length > 0 ? strong : dict.recordsFor(kind, field).filter((r) => r.strength === 'strong');
    out[field] = (pool[Math.floor(rand() * pool.length)] as (typeof pool)[number]).example;
  }
  return out;
}

describe('round trip: the full cross product (criterion 47)', () => {
  it('640 datasets (every delimiter x number preset x date preset x encoding, both datasets) re-ingest to the original rows, cell by cell', async () => {
    const rand = prng(47_640_001);
    let index = 0;
    let answered = 0;
    let datasets = 0;
    const wrong: string[] = [];
    const languagesSeen = new Set<string>();
    for (const delimiter of DELIMS) for (const numberStyle of NUMBER_STYLES) for (const dateStyle of DATE_STYLES) for (const encoding of ENCODINGS) for (const kind of ['inventory', 'shipments'] as Kind[]) {
      index++;
      const candidates = encoding === 'cp1252' ? LANGS.filter((l) => l !== 'vi') : LANGS;
      const language = candidates[index % candidates.length] as LanguageCode;
      languagesSeen.add(language);
      const logical = (kind === 'inventory' ? inventoryRows : shipmentRows)(5 + (index % 9));
      const spec: RenderSpec = {
        headers: headersFor(kind, language, rand),
        order: shuffle(rand, CANONICAL_FIELDS[kind]),
        delimiter,
        numberStyle,
        dateStyle,
        statusWords: language,
        encoding,
        eol: index % 2 === 0 ? '\n' : '\r\n'
      };
      const f = makeFixture(`x-${index}.csv`, kind, logical, spec);
      const label = `#${index} ${kind} ${language} ${JSON.stringify(delimiter)} ${numberStyle}/${dateStyle}/${encoding}`;
      const base = { options: new Map(Object.entries(f.options)) };
      let r = await settle(inputOf(f), { base });
      if (r.ok && !r.value.preview.canConfirm) {
        const codes = r.value.preview.blockers.map((b) => b.code);
        if (codes.includes('choose-number-format') || codes.includes('choose-date-format')) {
          answered++;
          r = await settle(inputOf(f), { base, numberPreset: numberStyle, datePreset: DATE_PRESET[dateStyle] });
        }
      }
      datasets++;
      if (!r.ok) {
        wrong.push(`${label}: ${r.error.message}`);
        continue;
      }
      const a = r.value;
      if (!a.preview.canConfirm || a.canonical === null || a.kind !== kind) {
        wrong.push(`${label}: not confirmable (${a.preview.blockers.map((b) => b.code).join(',')}) kind=${a.kind}`);
        continue;
      }
      // row by row, cell by cell, with the unchanged V1 parser
      const parsed = parseCsv(a.canonical.csv, { maxRows: 100_000, maxColumns: 50 });
      const fields = CANONICAL_FIELDS[kind];
      if (!parsed.ok) {
        wrong.push(`${label}: canonical CSV does not parse`);
        continue;
      }
      const records = parsed.records;
      if (records.length !== logical.length + 1) {
        wrong.push(`${label}: ${records.length - 1} rows instead of ${logical.length}`);
        continue;
      }
      if (JSON.stringify(records[0]?.fields.slice(0, fields.length)) !== JSON.stringify(fields)) wrong.push(`${label}: header order ${JSON.stringify(records[0]?.fields)}`);
      for (let row = 0; row < logical.length; row++) {
        for (let c = 0; c < fields.length; c++) {
          const got = records[row + 1]?.fields[c];
          const want = logical[row]?.[fields[c] as string] ?? '';
          if (got !== want) {
            wrong.push(`${label}: row ${row + 1} ${fields[c]} is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
            break;
          }
        }
      }
      // and the unchanged V1 importers read the same values
      const v1 = kind === 'inventory' ? importInventoryCsv(a.canonical.csv) : importShipmentsCsv(a.canonical.csv);
      if (!v1.ok || v1.rows.length !== logical.length) wrong.push(`${label}: V1 rejected or lost rows`);
      else if (kind === 'inventory') {
        (v1.rows as InventoryRecord[]).forEach((row, i) => {
          if (row.sku !== logical[i]?.sku || row.quantity !== Number(logical[i]?.quantity) || row.unitCostCents !== Math.round(Number(logical[i]?.unit_cost) * 100)) wrong.push(`${label}: V1 row ${i + 1} differs`);
        });
      } else {
        (v1.rows as ShipmentRecord[]).forEach((row, i) => {
          if (row.shipmentId !== logical[i]?.shipment_id || row.shippingCostCents !== Math.round(Number(logical[i]?.shipping_cost) * 100) || row.status !== logical[i]?.status) wrong.push(`${label}: V1 row ${i + 1} differs`);
        });
      }
    }
    expect(wrong.slice(0, 10)).toEqual([]);
    expect(datasets).toBe(4 * 4 * 5 * 4 * 2);
    expect(languagesSeen.size).toBe(5);
    expect(answered).toBeLessThan(datasets * 0.35);
  }, 240_000);
});
