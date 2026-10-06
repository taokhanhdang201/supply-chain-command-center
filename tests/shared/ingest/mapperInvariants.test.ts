// Criteria 26 (determinism, no network/clock/randomness, byte-identical reports, Suggester unwired) and 49 (mapper
// invariants: permutation, junk columns, header variants, one column per field).

import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { HELD_OUT } from '../../fixtures/ingest/heldoutCorpus';
import { build, col, G, type BuiltCase } from '../../fixtures/ingest/gen';
import { FIXTURES } from '../../fixtures/ingest/corpus45';
import { cellsOf, proposeCase } from '../../ingest-kit/mapperHarness';
import { readFixture } from '../../ingest-kit/stagesHarness';
import { applyStructure, detectStructure } from '../../../src/shared/ingest/structure/detectStructure';
import { profileColumn } from '../../../src/shared/ingest/structure/profile';
import { proposeMapping, serializeReport, type MappingProposal } from '../../../src/shared/ingest/mapping/report';
import { DICTIONARY_FILES, buildDictionary, recognizesHeader, type DictionaryFile } from '../../../src/shared/ingest/mapping/dictionary';
import { detectNumberPreset, detectDatePreset } from '../../../src/shared/ingest/normalize/detectPreset';

const CASES: BuiltCase[] = HELD_OUT.map(build);

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let a = seed;
  for (let i = out.length - 1; i > 0; i--) {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    const j = a % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

describe('SA-5 / criterion 26: deterministic, AI-free, explainable', () => {
  it('uses no network, Math.random or Date: throwing stubs do not change the result', () => {
    const before = CASES.map((c) => serializeReport(proposeCase(c)));
    const fetchStub = vi.fn(() => {
      throw new Error('network is forbidden in mapping');
    });
    vi.stubGlobal('fetch', fetchStub);
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random is forbidden in mapping');
    });
    const RealDate = Date;
    vi.stubGlobal(
      'Date',
      new Proxy(RealDate, {
        construct() {
          throw new Error('Date is forbidden in mapping');
        },
        get(target, prop, receiver) {
          if (prop === 'now') return () => {
            throw new Error('Date.now is forbidden in mapping');
          };
          return Reflect.get(target, prop, receiver);
        }
      })
    );
    try {
      const during = CASES.map((c) => serializeReport(proposeCase(c)));
      expect(during).toEqual(before);
      detectNumberPreset(['1,250.50', '89.50']);
      detectDatePreset(['03/04/2026', '13/04/2026']);
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('repeated runs give byte-identical reports', () => {
    for (const c of CASES) {
      const a = serializeReport(proposeCase(c));
      const b = serializeReport(proposeCase(c));
      expect(b).toBe(a);
    }
  });

  it('shuffled dictionary insertion order (files, groups, phrases, ambiguous entries) gives byte-identical reports', () => {
    const scrambled = (seed: number): DictionaryFile[] =>
      shuffled(DICTIONARY_FILES, seed).map((f, i) => ({
        ...f,
        groups: shuffled(f.groups, seed + i).map((g, k) => ({
          ...g,
          strong: g.strong === undefined ? undefined : shuffled(g.strong, seed + k),
          medium: g.medium === undefined ? undefined : shuffled(g.medium, seed + k + 1),
          weak: g.weak === undefined ? undefined : shuffled(g.weak, seed + k + 2)
        })) as never,
        ambiguous: shuffled(f.ambiguous, seed)
      }));
    const reference = CASES.map((c) => serializeReport(proposeCase(c)));
    for (const seed of [1, 7, 42, 1234]) {
      const dict = buildDictionary(scrambled(seed));
      expect(CASES.map((c) => serializeReport(proposeCase(c, dict)))).toEqual(reference);
    }
  });

  it('the report is stable under different object key orders of the input columns', () => {
    const c = CASES[2] as BuiltCase;
    const profiles = c.headers.map((h, i) => profileColumn(h, cellsOf(c.rows, i)));
    const a = serializeReport(proposeMapping(c.kind, c.headers, profiles));
    const reorderedProfiles = profiles.map((p) => Object.fromEntries(Object.entries(p).reverse()) as typeof p);
    expect(serializeReport(proposeMapping(c.kind, c.headers, reorderedProfiles))).toBe(a);
  });

  it('every mapping entry has non-empty human-readable evidence, on every corpus case', () => {
    for (const c of CASES) {
      for (const column of proposeCase(c).columns) {
        expect(column.evidence.length, `${c.id}: ${column.header}`).toBeGreaterThan(0);
        for (const line of column.evidence) expect(line.trim().length, `${c.id}: ${column.header}`).toBeGreaterThan(10);
      }
    }
  });

  it('mapping and normalizing modules contain no network, random, clock or eval in code', () => {
    const root = resolve(process.cwd(), 'src/shared/ingest');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const n of readdirSync(dir)) {
        const full = join(dir, n);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.ts$/.test(n)) files.push(full);
      }
    };
    for (const sub of ['mapping', 'normalize', 'structure', 'canonical']) walk(join(root, sub));
    expect(files.length).toBeGreaterThan(15);
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const f of files) {
      const code = strip(readFileSync(f, 'utf8'));
      expect(code, relative(root, f)).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|Math\.random|\bnew Date\b|Date\.now|performance\.now|setTimeout|setInterval|\beval\s*\(|new Function|crypto\.getRandomValues|import\s*\(/);
    }
  });

  it('Suggester exists only as an interface and is not imported by any production module', () => {
    const src = resolve(process.cwd(), 'src');
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const n of readdirSync(dir)) {
        const full = join(dir, n);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(n) && !full.endsWith('mapping\\suggester.ts') && !full.endsWith('mapping/suggester.ts')) {
          if (/suggester['"]|\bSuggester\b/.test(readFileSync(full, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')) && /ingest/.test(full)) hits.push(relative(src, full));
        }
      }
    };
    walk(src);
    expect(hits).toEqual([]);
    const text = readFileSync(resolve(src, 'shared/ingest/mapping/suggester.ts'), 'utf8');
    expect(text).toContain('export interface Suggester');
    expect(text).not.toMatch(/export (const|function|class)/);
  });
});

function project(p: MappingProposal): Array<[string, string, string | null, number | null]> {
  return p.columns.map((c) => [c.header, c.state, c.field, c.confidence === null ? null : Math.round(c.confidence * 1e6) / 1e6]);
}

describe('criterion 49: mapper invariants', () => {
  it('permuting columns permutes the mapping', () => {
    for (const c of CASES) {
      const base = project(proposeCase(c));
      for (const seed of [3, 11]) {
        const order = shuffled(c.headers.map((_, i) => i), seed);
        const permuted: BuiltCase = { ...c, headers: order.map((i) => c.headers[i] as string), rows: c.rows.map((r) => order.map((i) => r[i] as string)), truth: order.map((i) => c.truth[i] ?? null) };
        const got = project(proposeCase(permuted));
        expect(got, `${c.id} seed ${seed}`).toEqual(order.map((i) => base[i]));
      }
    }
  });

  it('adding junk columns changes no other mapping', () => {
    const junk = [col('Notes', null, G.text('n')), col('Weight (kg)', null, G.weight()), col('Customer Reference', null, G.po()), col('Col9', null, G.int(0, 50)), col('Created On', null, G.date())];
    for (const c of CASES) {
      const base = proposeCase(c);
      const extra = junk.map((j) => ({ header: j.header, cells: Array.from({ length: c.rows.length }, (_, i) => j.gen(i)) }));
      const widened: BuiltCase = { ...c, headers: [...c.headers, ...extra.map((e) => e.header)], rows: c.rows.map((r, i) => [...r, ...extra.map((e) => e.cells[i] as string)]), truth: [...c.truth, ...extra.map(() => null)] };
      const got = proposeCase(widened);
      expect(project({ ...got, columns: got.columns.slice(0, c.headers.length) }), c.id).toEqual(project(base));
      for (const column of got.columns.slice(c.headers.length)) expect(column.state, `${c.id}: ${column.header}`).toBe('ignored');
    }
  });

  it('case, diacritic and whitespace variants of a header give the same mapping', () => {
    const variants: Array<(h: string) => string> = [
      (h) => h.toUpperCase(),
      (h) => h.toLowerCase(),
      (h) => `  ${h}  `,
      (h) => h.replace(/ /g, '_'),
      (h) => h.replace(/ /g, '-'),
      (h) => h.normalize('NFD'), // decomposed accents
      (h) => h.replace(/\s+/g, '   ')
    ];
    for (const c of CASES) {
      const base = proposeCase(c).columns.map((x) => [x.state, x.field, x.confidence]);
      variants.forEach((v, k) => {
        const variant: BuiltCase = { ...c, headers: c.headers.map(v) };
        expect(proposeCase(variant).columns.map((x) => [x.state, x.field, x.confidence]), `${c.id} variant ${k}`).toEqual(base);
      });
    }
  });

  it('a field is never used twice and a column never maps to two fields, on every corpus and fixture', async () => {
    const proposals: MappingProposal[] = CASES.map((c) => proposeCase(c));
    for (const f of FIXTURES) {
      const table = await readFixture(f);
      const d = detectStructure(table, recognizesHeader);
      const st = applyStructure(table, d.headerRowIndex, d.structuralRows.map((r) => r.rowIndex), d);
      const profiles = st.headers.map((h, i) => profileColumn(h, st.rows.map((r) => r[i] ?? { v: '', t: 'empty' as const })));
      proposals.push(proposeMapping(f.kind, st.headers, profiles));
    }
    for (const p of proposals) {
      const used = p.columns.filter((c) => c.state === 'matched' || c.state === 'check').map((c) => c.field);
      expect(new Set(used).size, `${p.kind}`).toBe(used.length);
      for (const c of p.columns) {
        if (c.state === 'matched' || c.state === 'check') expect(c.candidates).toHaveLength(1);
        if (c.state === 'ignored') expect(c.field).toBeNull();
      }
      for (const f of p.fields) {
        const claimants = p.columns.filter((c) => (c.state === 'matched' || c.state === 'check') && c.field === f.field);
        expect(claimants.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('a mapped field matches the field statuses of the proposal (columnIndex points at its column)', () => {
    for (const c of CASES) {
      const p = proposeCase(c);
      for (const f of p.fields) {
        if (f.state === 'mapped') expect(p.columns[f.columnIndex as number]?.field).toBe(f.field);
        else expect(f.columnIndex).toBeNull();
      }
    }
  });

  it('the dictionary recognizer is stable under the same header variants (used by delimiter detection)', () => {
    for (const h of ['Consignment Reference', 'CONSIGNMENT REFERENCE', 'consignment_reference', ' Consignment   Reference ', 'Número de Guía', 'NUMERO DE GUIA'.toLowerCase()]) {
      expect(recognizesHeader(h), h).toBe(true);
    }
  });
});
