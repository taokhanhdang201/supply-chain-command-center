// TESTER (Agent 3): five-language dictionaries (criteria 12, 50; decision 10) and the dictionary-guide recipe.
// UTF-8 integrity of the source files, review flags, an independent "no phrase for two fields after folding" check,
// determinism of the built dictionary, and the documented extension recipe exercised WITHOUT editing any source file.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { DICTIONARY_FILES, buildDictionary, validateDictionary, type DictionaryFile } from '../../../src/shared/ingest/mapping/dictionary';
import { proposeMapping } from '../../../src/shared/ingest/mapping/report';
import { profileColumn } from '../../../src/shared/ingest/structure/profile';
import { analyzeFile } from '../../../src/shared/ingest/pipeline';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';

const ROOT = resolve(process.cwd());
const DIR = join(ROOT, 'src/shared/ingest/mapping/dictionary');
const LANGS = ['en', 'vi', 'es', 'de', 'fr'] as const;

/** My own folding (independent of normalizeHeader): NFKD, strip marks, d-stroke, sharp s, o-slash, lowercase, words only. */
const fold = (s: string): string =>
  s.normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[đĐ]/g, 'd').replace(/ß/g, 'ss').replace(/[øØ]/g, 'o').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

describe('dictionary files: encoding and flags', () => {
  it('each file is valid UTF-8 with no U+FFFD and no mojibake sequences', () => {
    for (const lang of LANGS) {
      const bytes = readFileSync(join(DIR, `${lang}.ts`));
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); // throws on invalid UTF-8
      expect(text.includes('�'), lang).toBe(false);
      expect(text, lang).not.toMatch(/Ã[\u0080-¿]|Â[\u0080-¿]|á»|áº|Ä‘|Æ°|Æ¡|â€|Ã©|Ã¨|Ã¼|Ã¶/);
      expect(bytes[0] === 0xef && bytes[1] === 0xbb, `${lang} has no BOM`).toBe(false);
    }
  });

  it('five languages, each flagged "needs native review", and the validator is clean', () => {
    expect(DICTIONARY_FILES.map((f) => f.language)).toEqual([...LANGS]);
    for (const f of DICTIONARY_FILES) expect(f.reviewStatus, f.language).toBe('needs native review');
    expect(validateDictionary(DICTIONARY_FILES)).toEqual([]);
  });

  it('independent check: no phrase (any strength) points at two fields of the same dataset after diacritic folding; every phrase is NFC, lowercase and has an example', () => {
    const owner = new Map<string, Set<string>>();
    let phrases = 0;
    const perLang: Record<string, number> = {};
    for (const f of DICTIONARY_FILES) {
      for (const g of f.groups) {
        for (const s of ['strong', 'medium', 'weak'] as const) {
          for (const [phrase, example] of g[s] ?? []) {
            phrases++;
            perLang[f.language] = (perLang[f.language] ?? 0) + 1;
            expect(phrase, phrase).toBe(phrase.normalize('NFC').toLowerCase().trim());
            expect(example.trim().length, phrase).toBeGreaterThan(0);
            const id = `${g.kind}|${fold(phrase)}`;
            const set = owner.get(id) ?? new Set<string>();
            set.add(g.field);
            owner.set(id, set);
          }
        }
      }
    }
    const clashes = [...owner.entries()].filter(([, s]) => s.size > 1).map(([k, s]) => `${k} -> ${[...s].join('/')}`);
    writeFileSync(join(tmpdir(), 'scc-tester-dictionary.json'), JSON.stringify({ phrases, perLang, clashes }, null, 1));
    expect(clashes).toEqual([]);
    expect(phrases).toBeGreaterThan(500);
  });
});

describe('determinism and the extension recipe', () => {
  const headers = ['Load Ref', 'Linehaul $', 'Carrier', 'Status'];
  const cells = [
    ['L-1001', 'L-1002', 'L-1003'],
    ['812.40', '410.00', '95.10'],
    ['Northstar Freight', 'Summit Express', 'Prairie Lines'],
    ['delivered', 'in_transit', 'pending']
  ].map((col) => col.map((v) => ({ v, t: 'text' as const })));
  const profiles = headers.map((h, i) => profileColumn(h, cells[i] ?? []));

  it('the built dictionary does not depend on the order of the files or of their groups', () => {
    const a = buildDictionary(DICTIONARY_FILES);
    const shuffled: DictionaryFile[] = [...DICTIONARY_FILES].reverse().map((f) => ({ ...f, groups: [...f.groups].reverse(), ambiguous: [...f.ambiguous].reverse() }));
    const b = buildDictionary(shuffled);
    expect(JSON.stringify(b.records())).toBe(JSON.stringify(a.records()));
    expect(b.version).toBe(a.version);
  });

  it('dictionary-guide recipe: adding ONE phrase as data changes the mapping, with evidence; an unsafe addition is rejected by the validator', () => {
    const before = proposeMapping('shipments', headers, profiles);
    const col = (p: typeof before) => p.columns[1];
    expect(col(before)?.field === 'shipping_cost' && col(before)?.state === 'matched').toBe(false);

    const en = DICTIONARY_FILES.find((f) => f.language === 'en') as DictionaryFile;
    const added: DictionaryFile = { ...en, groups: [...en.groups, { kind: 'shipments', field: 'shipping_cost', strong: [['linehaul', 'Linehaul $']] }] };
    const files = DICTIONARY_FILES.map((f) => (f.language === 'en' ? added : f));
    expect(validateDictionary(files)).toEqual([]);
    const after = proposeMapping('shipments', headers, profiles, buildDictionary(files));
    expect(col(after)?.field).toBe('shipping_cost');
    expect(['matched', 'check']).toContain(col(after)?.state);
    expect((col(after)?.evidence ?? []).join(' ')).toMatch(/linehaul/i);

    // unsafe: the same phrase STRONG for a second field (also with different accents) must be rejected
    const clash: DictionaryFile = { ...added, groups: [...added.groups, { kind: 'shipments', field: 'carrier', strong: [['linéhaul', 'Linéhaul']] }] };
    expect(validateDictionary(DICTIONARY_FILES.map((f) => (f.language === 'en' ? clash : f))).join(' ')).toMatch(/linéhaul/);
    // and a non-normalized phrase is rejected
    const upper: DictionaryFile = { ...en, groups: [...en.groups, { kind: 'shipments', field: 'shipping_cost', strong: [['Linehaul', 'Linehaul']] }] };
    expect(validateDictionary(DICTIONARY_FILES.map((f) => (f.language === 'en' ? upper : f))).join(' ')).toMatch(/not normalized/);
  });
});

describe('FINDING probe: an exact canonical header with bad values', () => {
  it('records the state of the canonical header "quantity" as the share of invalid values grows (k of 10)', async () => {
    const registry = createDefaultRegistry();
    const out: Array<{ bad: number; state: string; field: string | null }> = [];
    for (let k = 0; k <= 10; k++) {
      const rows = Array.from({ length: 10 }, (_, i) => `A-${100 + i},Bolt,Hardware,WH-DFW,${i < k ? `${i + 1} pcs` : String(i + 1)},1,9.50`);
      const text = 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost\n' + rows.join('\n') + '\n';
      const r = await analyzeFile({ bytes: new TextEncoder().encode(text), fileName: 'q.csv', decisions: { kind: 'inventory' } }, { registry });
      if (!r.ok) throw new Error(r.error.code);
      const c = r.value.preview.columns[4];
      out.push({ bad: k, state: c?.state ?? '?', field: c?.field ?? null });
    }
    writeFileSync(join(tmpdir(), 'scc-tester-canonical-header.json'), JSON.stringify(out));
    // never silently mapped elsewhere; MATCHED while the values are mostly fine
    for (const o of out) expect(o.field === null || o.field === 'quantity').toBe(true);
    expect(out[0]?.state).toBe('matched');
    expect(out[1]?.state).toBe('matched');
  });
});
