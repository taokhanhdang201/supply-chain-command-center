// Criterion 47 (normalizer level; the canonical CSV bytes and the full pipeline are added in milestone M3): at least 500
// random canonical datasets are rendered in a random sample of delimiter x number preset x date preset x encoding, with
// shuffled columns and alias headers in the five languages, re-read through the real adapter, structure, mapper,
// preset detection and normalizers, and compared with the logical canonical rows.

import { describe, expect, it } from 'vitest';
import { defaultDict } from '../../../src/shared/ingest/mapping/dictionary';
import { CANONICAL_FIELDS, inventoryRows, makeFixture, shipmentRows, type Encoding, type Kind, type RenderSpec } from '../../fixtures/ingest/corpus45';
import { prng } from '../../ingest-kit/corpus';
import { runStages, sameNumber } from '../../ingest-kit/stagesHarness';
import type { DateStyle, NumberStyle } from '../../fixtures/ingest/gen';
import type { LanguageCode } from '../../../src/shared/ingest/mapping/dictionary';

const LANGS: LanguageCode[] = ['en', 'vi', 'es', 'de', 'fr'];
const STATUS_LANG: Record<LanguageCode, string> = { en: 'en', vi: 'vi', es: 'es', de: 'de', fr: 'fr' };
const DELIMS = [',', ';', '\t', '|'];
const NUMBER_STYLES: NumberStyle[] = ['plain', 'us', 'eu', 'fr'];
const DATE_STYLES: DateStyle[] = ['iso', 'mdy', 'dmy', 'dot', 'ymd'];
const DATE_PRESET: Record<DateStyle, string> = { iso: 'iso', mdy: 'mdy_slash', dmy: 'dmy_slash', dot: 'dmy_dot', ymd: 'ymd_slash' };

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)] as T;
}

function shuffle<T>(rand: () => number, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Strong, unambiguous example headers of each field in one language (the shape a person would type). */
function headersFor(kind: Kind, language: LanguageCode, rand: () => number): Record<string, string> {
  const dict = defaultDict();
  const out: Record<string, string> = {};
  for (const field of CANONICAL_FIELDS[kind]) {
    const strong = dict.recordsFor(kind, field).filter((r) => r.language === language && r.strength === 'strong' && !/^(de|to|from|par|du)$/.test(r.key));
    const pool = strong.length > 0 ? strong : dict.recordsFor(kind, field).filter((r) => r.strength === 'strong');
    out[field] = (pick(rand, pool)).example;
  }
  return out;
}

describe('round trip at normalizer level (criterion 47)', () => {
  it('500 random datasets: read, map, detect presets and normalize back to the canonical rows', async () => {
    const rand = prng(20260930);
    let fullyMapped = 0;
    let autoResolved = 0;
    const wrong: string[] = [];
    const seen = { delim: new Set<string>(), number: new Set<string>(), date: new Set<string>(), encoding: new Set<string>(), language: new Set<string>() };
    const total = 500;
    for (let n = 0; n < total; n++) {
      const kind: Kind = rand() < 0.5 ? 'inventory' : 'shipments';
      const language = pick(rand, LANGS);
      const delimiter = pick(rand, DELIMS);
      const numberStyle = pick(rand, NUMBER_STYLES);
      const dateStyle = pick(rand, DATE_STYLES);
      const representable = language !== 'vi';
      const encoding: Encoding = pick(rand, representable ? (['utf8', 'utf8bom', 'utf16le', 'cp1252'] as const) : (['utf8', 'utf8bom', 'utf16le'] as const));
      const rows = (kind === 'inventory' ? inventoryRows : shipmentRows)(6 + Math.floor(rand() * 10));
      const order = shuffle(rand, CANONICAL_FIELDS[kind]);
      const spec: RenderSpec = {
        headers: headersFor(kind, language, rand),
        order,
        delimiter,
        numberStyle,
        dateStyle,
        statusWords: STATUS_LANG[language],
        encoding,
        eol: rand() < 0.5 ? '\n' : '\r\n'
      };
      const fixture = makeFixture(`rt-${n}.csv`, kind, rows, spec);
      seen.delim.add(delimiter);
      seen.number.add(numberStyle);
      seen.date.add(dateStyle);
      seen.encoding.add(encoding);
      seen.language.add(language);
      try {
        const run = await runStages(fixture);
        const mappedAll = CANONICAL_FIELDS[kind].every((f) => run.mappedFields.has(f));
        if (mappedAll) fullyMapped++;
        // rows of the fields that were mapped must be exactly right whenever the presets were resolved automatically
        const numberOk = run.numberOutcome.kind === 'unique' || run.numberOutcome.kind === 'equivalent' || run.numberOutcome.kind === 'none';
        const dateOk = run.dateOutcome.kind === 'unique' || run.dateOutcome.kind === 'equivalent' || run.dateOutcome.kind === 'none';
        if (numberOk && dateOk) {
          autoResolved++;
          rows.forEach((want, i) => {
            for (const [field, value] of Object.entries(want)) {
              if (!run.mappedFields.has(field)) continue;
              const got = (run.rows[i] as Record<string, string>)[field] as string;
              if (!sameNumber(got, value)) wrong.push(`#${n} ${kind} ${language} ${JSON.stringify(delimiter)} ${numberStyle}/${dateStyle}/${encoding} row ${i} ${field}: got "${got}" want "${value}"`);
            }
          });
        } else {
          // the user would have to choose: the true preset must be among the candidates the UI offers
          if (run.dateOutcome.kind === 'ambiguous') expect(run.dateOutcome.candidates).toContain(DATE_PRESET[dateStyle]);
          if (run.numberOutcome.kind === 'ambiguous') expect(run.numberOutcome.candidates).toContain(numberStyle);
          expect(['ambiguous', 'mixed', 'unique', 'equivalent', 'none']).toContain(run.numberOutcome.kind);
        }
      } catch (e) {
        wrong.push(`#${n} ${kind} ${language} ${JSON.stringify(delimiter)} ${numberStyle}/${dateStyle}/${encoding}: ${(e as Error).message}`);
      }
    }
    expect(wrong.slice(0, 10)).toEqual([]);
    expect(seen.delim.size).toBe(4);
    expect(seen.number.size).toBe(4);
    expect(seen.date.size).toBe(5);
    expect(seen.encoding.size).toBe(4);
    expect(seen.language.size).toBe(5);
    expect(fullyMapped / total).toBeGreaterThanOrEqual(0.99);
    expect(autoResolved / total).toBeGreaterThanOrEqual(0.7);
  }, 120_000);
});
