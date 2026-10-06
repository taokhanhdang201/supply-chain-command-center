// Criterion 47 through the REAL pipeline and canonical builder: at least 500 random canonical datasets rendered in a
// random sample of delimiter x number preset x date preset x encoding (shuffled columns, alias headers in the five
// languages) re-ingest to exactly the canonical CSV of the original rows, which the unchanged V1 importers accept.

import { describe, expect, it } from 'vitest';
import { defaultDict } from '../../../src/shared/ingest/mapping/dictionary';
import type { LanguageCode } from '../../../src/shared/ingest/mapping/dictionary';
import { CANONICAL_FIELDS, inventoryRows, makeFixture, shipmentRows, type Encoding, type Kind, type RenderSpec } from '../../fixtures/ingest/corpus45';
import { importInventoryCsv } from '../../../src/shared/csv/importInventory';
import { importShipmentsCsv } from '../../../src/shared/csv/importShipments';
import { prng } from '../../ingest-kit/corpus';
import { inputOf, settle } from '../../ingest-kit/pipelineHarness';
import type { DateStyle, NumberStyle } from '../../fixtures/ingest/gen';

const LANGS: LanguageCode[] = ['en', 'vi', 'es', 'de', 'fr'];
const DELIMS = [',', ';', '\t', '|'];
const NUMBER_STYLES: NumberStyle[] = ['plain', 'us', 'eu', 'fr'];
const DATE_STYLES: DateStyle[] = ['iso', 'mdy', 'dmy', 'dot', 'ymd'];
const DATE_PRESET = { iso: 'iso', mdy: 'mdy_slash', dmy: 'dmy_slash', dot: 'dmy_dot', ymd: 'ymd_slash' } as const;

const pick = <T,>(rand: () => number, items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;
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
    out[field] = pick(rand, pool).example;
  }
  return out;
}

describe('round trip through the canonical builder (criterion 47)', () => {
  it('500 random datasets re-ingest to the canonical CSV of the original rows', async () => {
    const rand = prng(47_000_001);
    const total = 500;
    let needed = 0;
    let ambiguous = 0;
    const wrong: string[] = [];
    const seen = { delim: new Set<string>(), number: new Set<string>(), date: new Set<string>(), encoding: new Set<string>(), language: new Set<string>(), kind: new Set<string>() };
    for (let n = 0; n < total; n++) {
      const kind: Kind = rand() < 0.5 ? 'inventory' : 'shipments';
      const language = pick(rand, LANGS);
      const delimiter = pick(rand, DELIMS);
      const numberStyle = pick(rand, NUMBER_STYLES);
      const dateStyle = pick(rand, DATE_STYLES);
      const encoding: Encoding = pick(rand, language === 'vi' ? (['utf8', 'utf8bom', 'utf16le'] as const) : (['utf8', 'utf8bom', 'utf16le', 'cp1252'] as const));
      const logical = (kind === 'inventory' ? inventoryRows : shipmentRows)(6 + Math.floor(rand() * 14));
      const spec: RenderSpec = {
        headers: headersFor(kind, language, rand),
        order: shuffle(rand, CANONICAL_FIELDS[kind]),
        delimiter,
        numberStyle,
        dateStyle,
        statusWords: language,
        encoding,
        eol: rand() < 0.5 ? '\n' : '\r\n'
      };
      const f = makeFixture(`rt-${n}.csv`, kind, logical, spec);
      for (const [set, v] of [[seen.delim, delimiter], [seen.number, numberStyle], [seen.date, dateStyle], [seen.encoding, encoding], [seen.language, language], [seen.kind, kind]] as const) set.add(v);
      const base = { options: new Map(Object.entries(f.options)) };
      try {
        let r = await settle(inputOf(f), { base });
        if (r.ok && !r.value.preview.canConfirm) {
          const codes = r.value.preview.blockers.map((b) => b.code);
          if (codes.includes('choose-number-format') || codes.includes('choose-date-format')) {
            ambiguous++;
            // the user answers the format question: the true format must be offered
            r = await settle(inputOf(f), { base, numberPreset: numberStyle, datePreset: DATE_PRESET[dateStyle] });
          }
        }
        needed++;
        if (!r.ok) {
          wrong.push(`#${n} ${kind} ${language} ${JSON.stringify(delimiter)} ${numberStyle}/${dateStyle}/${encoding}: ${r.error.message}`);
          continue;
        }
        const a = r.value;
        if (!a.preview.canConfirm || a.canonical?.csv !== f.golden) {
          wrong.push(`#${n} ${kind} ${language} ${JSON.stringify(delimiter)} ${numberStyle}/${dateStyle}/${encoding}: ${a.preview.canConfirm ? 'csv differs from golden' : a.preview.blockers.map((b) => b.message).join(' | ')}`);
          continue;
        }
        const v1 = kind === 'inventory' ? importInventoryCsv(a.canonical.csv) : importShipmentsCsv(a.canonical.csv);
        if (!v1.ok || v1.rows.length !== logical.length) wrong.push(`#${n}: V1 rejected or lost rows`);
      } catch (e) {
        wrong.push(`#${n}: threw ${(e as Error).message}`);
      }
    }
    expect(wrong.slice(0, 10)).toEqual([]);
    expect(needed).toBe(total);
    expect(seen.delim.size).toBe(4);
    expect(seen.number.size).toBe(4);
    expect(seen.date.size).toBe(5);
    expect(seen.encoding.size).toBe(4);
    expect(seen.language.size).toBe(5);
    expect(seen.kind.size).toBe(2);
    expect(ambiguous).toBeLessThan(total * 0.3);
  }, 180_000);
});
