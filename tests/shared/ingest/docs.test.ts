// Criterion 54: the four documents under docs/ingestion/ exist and match the code. The test reads the documents and checks
// the facts they state against the source: every path they mention exists, every message code they cite is in the catalogue,
// every limit number in the layer table equals the constant, the environment-variable texts equal what the code prints, the
// adapter counts and names are real, and the honest-limitations sections are present.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIMIT_CEILINGS, LIMIT_DEFAULTS } from '../../../src/shared/ingest/limits';
import { MESSAGE_CATALOGUE } from '../../../src/shared/ingest/messages';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import { loadIngestLimits } from '../../../src/server/ingestLimits';
import { loadConfig } from '../../../src/server/config';
import * as score from '../../../src/shared/ingest/mapping/score';
import { DICTIONARY_FILES, LANGUAGE_ORDER, validateDictionary } from '../../../src/shared/ingest/mapping/dictionary';
import { ROOT } from '../../ingest-kit/guards';

const DOCS = ['architecture', 'add-an-adapter', 'dictionary-guide', 'limits'] as const;
const text = Object.fromEntries(DOCS.map((d) => [d, readFileSync(join(ROOT, `docs/ingestion/${d}.md`), 'utf8')])) as Record<(typeof DOCS)[number], string>;
const all = DOCS.map((d) => text[d]).join('\n');
const registry = createDefaultRegistry();

describe('docs/ingestion', () => {
  it('has the four documents, each substantial', () => {
    for (const d of DOCS) expect(text[d].split('\n').length, d).toBeGreaterThan(60);
  });

  it('every repository path the documents mention exists', () => {
    const paths = new Set<string>();
    for (const m of all.matchAll(/`((?:src|tests|docs|public)\/[A-Za-z0-9_./*<>-]+)`/g)) paths.add(m[1] as string);
    expect(paths.size).toBeGreaterThan(30);
    const missing = [...paths].filter((p) => {
      const clean = p.replace(/\*\*?$/, '').replace(/\/$/, '');
      if (/[<>*]/.test(clean)) return false; // patterns such as adapters/<id>/ or corpus.ts globs
      return !existsSync(join(ROOT, clean));
    });
    expect(missing).toEqual([]);
  });

  it('every message code the documents cite is in the catalogue', () => {
    const cited = new Set<string>();
    for (const m of all.matchAll(/\(`((?:LIMIT|PACKED|ENCODING|CHOICE|EMPTY|UNKNOWN|READ|BROWSER|CANCELLED|NO_)[A-Z_]*)`\)|`((?:LIMIT|PACKED|ENCODING)_[A-Z_]+)`/g)) cited.add((m[1] ?? m[2]) as string);
    expect(cited.size).toBeGreaterThan(8);
    expect([...cited].filter((c) => !(c in MESSAGE_CATALOGUE) && c !== 'LIMIT_DEFAULTS' && c !== 'LIMIT_CEILINGS')).toEqual([]);
  });

  it('limits.md states the real defaults and ceilings', () => {
    const l = text.limits;
    for (const n of ['2,097,152', '20,000', '100,000', '200,000', '1,000,000', '20,000 ms', '120,000 ms', '10,000 ms', '60,000 ms', '5,000,000', '20,000,000', '8,000,000']) expect(l, n).toContain(n);
    expect(LIMIT_DEFAULTS).toMatchObject({ payloadBytes: 2_097_152, maxImportRows: 20_000, maxColumns: 50, maxErrorsReturned: 500, requestTimeoutMs: 30_000, maxScanRows: 200_000, parseBudgetMs: 20_000, validateBudgetMs: 10_000, expansionRatio: 200, archiveEntries: 1000, maxCells: 2_000_000, maxTables: 64, maxDepth: 32, maxNodes: 5_000_000 });
    expect(LIMIT_CEILINGS).toMatchObject({ payloadBytes: 10 * 1024 * 1024, maxImportRows: 100_000, maxScanRows: 1_000_000, maxColumns: 1000, parseBudgetMs: 120_000, validateBudgetMs: 60_000, maxCells: 8_000_000, maxTables: 256, maxNodes: 20_000_000 });
    expect(l).toContain('200:1');
    expect(l).toContain('64 MiB');
  });

  it('limits.md quotes the real environment-variable messages', () => {
    expect(() => loadIngestLimits({ SCC_MAX_IMPORT_ROWS: 'x' })).toThrow('Invalid SCC_MAX_IMPORT_ROWS "x": expected an integer between 1 and 100000.');
    expect(text.limits).toContain('Invalid SCC_MAX_IMPORT_ROWS "x": expected an integer between 1 and 100000.');
    expect(() => loadConfig({ SCC_MAX_UPLOAD_BYTES: 'x' }, [])).toThrow('Invalid SCC_MAX_UPLOAD_BYTES "x": expected an integer between 1024 and 10485760.');
    expect(text.limits).toContain('Invalid SCC_MAX_UPLOAD_BYTES "x": expected an integer between 1024 and 10485760.');
    const warning = loadIngestLimits({ SCC_MAX_IMPORT_ROWS: 'N'.length === 1 ? '30000' : '0' }).warnings[0] as string;
    expect(text.limits).toContain(warning.replace('30000', 'N'));
  });

  it('architecture.md counts the adapters correctly and names the real ones', () => {
    const refusals = registry.refusalFamilies();
    expect(refusals).toHaveLength(15);
    expect(text.architecture).toContain('15 refusal adapters');
    expect(registry.supportedFamilies().map((d) => d.id)).toEqual(['delimited-text', 'gzip']);
    expect(text['add-an-adapter']).toContain('`refuse-zip`');
    for (const id of ['refuse-zip', 'refuse-json', 'refuse-xml', 'refuse-html', 'refuse-pdf']) expect(registry.get(id), id).toBeDefined();
  });

  it('dictionary-guide.md states the real mapper constants and the dictionary rules', () => {
    const g = text['dictionary-guide'];
    const pairs: Array<[string, number]> = [
      ['STRENGTH_STRONG', score.STRENGTH_STRONG],
      ['STRENGTH_MEDIUM', score.STRENGTH_MEDIUM],
      ['STRENGTH_WEAK', score.STRENGTH_WEAK],
      ['SIMILARITY_CAP', score.SIMILARITY_CAP],
      ['SIMILARITY_MIN', score.SIMILARITY_MIN],
      ['SPELLING_CAP', score.SPELLING_CAP],
      ['WEIGHT_HEADER', score.WEIGHT_HEADER],
      ['WEIGHT_PROFILE', score.WEIGHT_PROFILE],
      ['PROFILE_ONLY_CAP', score.PROFILE_ONLY_CAP],
      ['MATCH_MIN_CONFIDENCE', score.MATCH_MIN_CONFIDENCE],
      ['MATCH_MIN_MARGIN', score.MATCH_MIN_MARGIN],
      ['CHECK_MIN_CONFIDENCE', score.CHECK_MIN_CONFIDENCE],
      ['COMPETING_WINDOW', score.COMPETING_WINDOW]
    ];
    for (const [name, value] of pairs) expect(g, `${name} = ${value}`).toContain(String(value));
    expect(g).toContain('0.6 * header + 0.4 * profile');
    expect(score.WEIGHT_HEADER + score.WEIGHT_PROFILE).toBeCloseTo(1, 10);
    expect(LANGUAGE_ORDER).toEqual(['en', 'vi', 'es', 'de', 'fr']);
    expect(DICTIONARY_FILES.every((f) => f.reviewStatus === 'needs native review')).toBe(true);
    expect(validateDictionary(DICTIONARY_FILES)).toEqual([]);
    expect(g).toContain('needs native review');
    expect(g).toContain('upper estimate');
    expect(g).toContain('delivery date');
  });

  it('every document has an honest limitations section', () => {
    expect(text.architecture).toMatch(/## 9\. Known limitations/);
    expect(text.architecture).toContain('Not implemented:');
    expect(text.limits).toMatch(/## 6\. Known gaps/);
    expect(text.limits).toContain('Nothing above 20,000 rows or 2 MiB was measured, and none is promised.');
    expect(text['dictionary-guide']).toMatch(/## 5\. Review status and honest limits/);
    expect(text['add-an-adapter']).toMatch(/## 7\. Limits of this phase/);
  });

  it('the documents contain no placeholder text', () => {
    expect(all).not.toMatch(/\bTODO\b|\bTBD\b|lorem ipsum|XXX/i);
  });
});
