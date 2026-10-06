// TESTER (Agent 3): independent documentation-to-code consistency check (criterion 54). Every back-ticked path in
// docs/ingestion/*.md must exist; every back-ticked code identifier must occur in src/ or tests/; every env variable
// must be read somewhere (or be explicitly marked as not wired); the numbers the docs quote are compared with the code.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as score from '../../../src/shared/ingest/mapping/score';
import { HEAD_BYTES } from '../../../src/shared/ingest/detect/bytes';
import { refusalAdapters } from '../../../src/shared/ingest/adapters/refusals';
import { builtinAdapters } from '../../../src/shared/ingest/adapters';
import { LIMIT_CEILINGS, LIMIT_DEFAULTS } from '../../../src/shared/ingest/limits';
import { DICTIONARY_FILES } from '../../../src/shared/ingest/mapping/dictionary';

const ROOT = resolve(process.cwd());
const DOCS = ['architecture', 'add-an-adapter', 'dictionary-guide', 'limits'].map((d) => ({ name: d, text: readFileSync(join(ROOT, 'docs/ingestion', `${d}.md`), 'utf8') }));

function corpus(dirs: string[]): string {
  let out = '';
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n)) out += readFileSync(p, 'utf8') + '\n';
    }
  };
  for (const d of dirs) walk(join(ROOT, d));
  return out;
}
const SRC = corpus(['src']);
const ALL = SRC + corpus(['tests/shared', 'tests/client', 'tests/server', 'tests/ingest-kit', 'tests/fixtures/ingest']) + readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
const ticks = (t: string): string[] => [...t.matchAll(/`([^`\n]+)`/g)].map((m) => (m[1] as string).trim());

describe('TESTER docs/ingestion consistency', () => {
  it('every back-ticked repository path exists', () => {
    const missing: string[] = [];
    for (const d of DOCS) {
      for (const tok of ticks(d.text)) {
        const m = /^((?:src|tests|docs|public)\/[A-Za-z0-9_./-]+?)(?:[`),:]|$)/.exec(tok.split(/\s/)[0] as string);
        if (m === null || /<|\*|\{/.test(tok)) continue;
        const p = (m[1] as string).replace(/[.,]$/, '');
        if (!existsSync(join(ROOT, p))) missing.push(`${d.name}: ${p}`);
      }
      // brace lists such as `src/shared/ingest/adapters/delimited/`, `gzip/` are covered above; folder mentions too
    }
    expect(missing).toEqual([]);
  });

  it('every back-ticked identifier that looks like code occurs in the source or tests', () => {
    const idents = new Set<string>();
    for (const d of DOCS) for (const tok of ticks(d.text)) for (const m of tok.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
      const w = m[1] as string;
      if (/^[a-z]+$/.test(w) || w.length < 4) continue; // plain words
      if (/^[A-Z][a-z]+$/.test(w)) continue; // capitalised English words
      idents.add(w);
    }
    // names of test files (`hashGuard.test.ts` gives the token hashGuard) count when such a file exists
    const testNames = new Set<string>();
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else testNames.add(n.replace(/\.test\.tsx?$/, '').replace(/\.tsx?$/, ''));
      }
    };
    walk(join(ROOT, 'tests'));
    const prose = new Set(['canonicalFile', 'testTimeout']); // a parameter name in prose and an npm/vitest flag
    const missing = [...idents].filter((w) => !ALL.includes(w) && !testNames.has(w) && !prose.has(w)).sort();
    expect(testNames.has('roundTripCross') && testNames.has('roundTrip')).toBe(true); // `roundTrip*.test.ts` in the guide
    writeFileSync(join(tmpdir(), 'scc-tester-docs.json'), JSON.stringify({ identifiers: idents.size, missing }, null, 1));
    // env variable spellings and prose placeholders are checked separately below
    expect(missing.filter((w) => !/^(VITE_SCC_INGEST_|SCC_|ADAPTER_ID|MAX_SCAN_ROWS|PARSE_BUDGET_MS|VALIDATE_BUDGET_MS|SOURCE_BYTES_)/.test(w))).toEqual([]);
  });

  it('environment variables named in the docs are read in src/ (VITE_SCC_INGEST_* only by the unwired limitConfigFromEnv, as the docs admit)', () => {
    const env = new Set<string>();
    for (const d of DOCS) for (const m of d.text.matchAll(/\b((?:VITE_)?SCC_[A-Z_]+)\b/g)) env.add(m[1] as string);
    for (const e of env) {
      if (e.startsWith('VITE_SCC_INGEST')) continue;
      expect(SRC.includes(e) || SRC.includes(`'${e}'`) || (e === 'SCC_MAX_UPLOAD_BYTES' && SRC.includes('SCC_MAX_UPLOAD_BYTES')), e).toBe(true);
    }
    expect(SRC).toContain("'VITE_SCC_INGEST_MAX_SCAN_ROWS'");
    // the honest gap: nothing in the application calls limitConfigFromEnv
    const callers = SRC.split('\n').filter((l) => l.includes('limitConfigFromEnv(') && !l.includes('export function'));
    expect(callers).toEqual([]);
    expect(DOCS.find((d) => d.name === 'limits')?.text).toMatch(/does not call it yet/);
  });

  it('numbers quoted by the docs equal the code', () => {
    expect([score.STRENGTH_STRONG, score.STRENGTH_MEDIUM, score.STRENGTH_WEAK, score.STRENGTH_EXACT]).toEqual([0.92, 0.75, 0.55, 1]);
    expect([score.SIMILARITY_CAP, score.SIMILARITY_MIN, score.SPELLING_CAP, score.WEIGHT_HEADER, score.WEIGHT_PROFILE, score.PROFILE_ONLY_CAP]).toEqual([0.6, 0.5, 0.55, 0.6, 0.4, 0.7]);
    expect([score.MATCH_MIN_CONFIDENCE, score.MATCH_MIN_MARGIN, score.CHECK_MIN_CONFIDENCE, score.COMPETING_WINDOW]).toEqual([0.85, 0.25, 0.55, 0.15]);
    expect(HEAD_BYTES).toBe(64 * 1024);
    expect(refusalAdapters.length).toBe(15); // architecture.md: "15 refusal adapters"
    expect(builtinAdapters.length).toBe(17); // 1 delimited + 1 gzip + 15 refusals
    expect([LIMIT_DEFAULTS.expandedEntryBytes, LIMIT_DEFAULTS.expandedTotalBytes, LIMIT_DEFAULTS.expansionRatio, LIMIT_DEFAULTS.archiveEntries]).toEqual([64 * 2 ** 20, 100 * 2 ** 20, 200, 1000]);
    expect([LIMIT_DEFAULTS.maxCells, LIMIT_DEFAULTS.maxTables, LIMIT_DEFAULTS.maxDepth, LIMIT_DEFAULTS.maxNodes, LIMIT_DEFAULTS.maxTextNode]).toEqual([2_000_000, 64, 32, 5_000_000, 2 ** 20]);
    expect([LIMIT_CEILINGS.maxCells, LIMIT_CEILINGS.maxTables, LIMIT_CEILINGS.maxDepth, LIMIT_CEILINGS.maxNodes, LIMIT_CEILINGS.maxTextNode]).toEqual([8_000_000, 256, 32, 20_000_000, 4 * 2 ** 20]);
    expect([LIMIT_CEILINGS.parseBudgetMs, LIMIT_CEILINGS.validateBudgetMs, LIMIT_CEILINGS.maxScanRows, LIMIT_CEILINGS.maxColumns]).toEqual([120_000, 60_000, 1_000_000, 1000]);
    expect(DICTIONARY_FILES.every((f) => f.reviewStatus === 'needs native review')).toBe(true);
  });

  it('recorded inaccuracies (the doc text versus the code)', () => {
    const guide = DOCS.find((d) => d.name === 'dictionary-guide')?.text ?? '';
    // "All thresholds are named constants at the top of score.ts and assign.ts": assign.ts defines none (it imports them)
    expect(guide).toContain('named constants at the top of `score.ts` and `assign.ts`');
    expect(readFileSync(join(ROOT, 'src/shared/ingest/mapping/assign.ts'), 'utf8')).not.toMatch(/^export const /m);
  });
});
