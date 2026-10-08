// TESTER (Agent 3): independent scope and protected-file integrity checks (criteria 33, 34, 38, 42; SA-4).
// The Coder's protected-hashes.json was generated from the CURRENT tree, so on its own it cannot prove the protected
// files equal the base commit. Here every protected file is (1) re-hashed with an independent implementation and
// compared with the JSON, and (2) compared byte-for-byte (line endings normalised) with `git show 167cc52:<path>`.
// The tree-wide `git diff` checks pin the approved scope OF THE INGESTION WORK: they compare the base with the work's
// checkpoint tag (SCC-V2-Ingestion-P0-1a-Stable), not with the working tree, so later work items (for example a Dashboard
// redesign) are not blocked by this work item's scope. Protected files, package/config files and tags are still checked
// against the current tree. Skipped only when git, the base commit or the tag is unavailable.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROTECTED_PATHS, compareHashes, directionViolations, hashFiles, importsOf, listFiles } from '../../ingest-kit/guards';
import vitestConfig from '../../../vitest.config';

const ROOT = resolve(process.cwd());
const BASE = '167cc52';
const TAG = 'SCC-V2-Ingestion-P0-1a-Stable';
const git = (args: string[]): string => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
const hasBase = ((): boolean => {
  try {
    git(['rev-parse', '--verify', `${BASE}^{commit}`]);
    git(['rev-parse', '--verify', `${TAG}^{commit}`]);
    return true;
  } catch {
    return false;
  }
})();
const lf = (s: string): string => s.replace(/\r\n?/g, '\n');
const myHash = (s: string): string => createHash('sha256').update(Buffer.from(lf(s), 'utf8')).digest('hex');
const committed = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/ingest/protected-hashes.json'), 'utf8')) as { base: string; files: Record<string, string> };

const APPROVED_MODIFIED = [
  'src/client/components/import/ColumnMappingPanel.tsx',
  'src/client/pages/ImportPage.tsx',
  'src/client/styles/components.css',
  'src/client/styles/pages.css',
  'src/server/api.ts',
  'src/server/index.ts',
  'tests/client/pages/ImportPage.test.tsx',
  'tests/tester/v16.static.test.ts',
  'vite.config.ts'
];

describe.runIf(hasBase)('TESTER integrity versus the base commit 167cc52', () => {
  it('protected-hashes.json: 37 entries, independently re-hashed values equal the JSON', () => {
    const files = Object.keys(committed.files).sort();
    expect(files).toHaveLength(37);
    for (const f of files) expect(myHash(readFileSync(join(ROOT, f), 'utf8')), f).toBe(committed.files[f]);
  });

  // 37 `git show` processes (~1.9 s alone, measured); process spawns slow down a lot under the parallel full suite.
  it('every protected file equals its 167cc52 version (so the JSON blessed no change made during the work)', { timeout: 15_000 }, () => {
    for (const f of Object.keys(committed.files)) {
      const base = git(['show', `${BASE}:${f}`]);
      expect(myHash(base), f).toBe(committed.files[f]);
    }
  });

  it('the protected list includes the SA-4 files and excludes the two approved server edits on purpose', () => {
    const files = new Set(Object.keys(committed.files));
    const mustHave = [
      'src/shared/types.ts', 'src/shared/money.ts', 'src/shared/dates.ts', 'src/shared/formulas.ts', 'src/shared/geo.ts', 'src/shared/format.ts', 'src/shared/constants.ts',
      'src/server/http.ts', 'src/server/store.ts', 'src/server/app.ts', 'src/server/config.ts', 'src/server/staticFiles.ts', 'src/server/devVite.ts',
      'src/client/api/apiClient.ts', 'src/client/state/DataContext.tsx'
    ];
    for (const f of mustHave) expect(files.has(f), f).toBe(true);
    // all of domain/**, csv/**, mapping/**, reference/**, sample/** as they exist in the BASE commit
    for (const dir of ['src/shared/domain', 'src/shared/csv', 'src/shared/mapping', 'src/shared/reference', 'src/shared/sample', 'public/templates']) {
      const inBase = git(['ls-tree', '-r', '--name-only', BASE, '--', dir]).split('\n').filter((x) => x !== '');
      expect(inBase.length, dir).toBeGreaterThan(0);
      for (const f of inBase) expect(files.has(f), f).toBe(true);
    }
    expect(files.has('src/server/api.ts')).toBe(false);
    expect(files.has('src/server/index.ts')).toBe(false);
  });

  it('tracked files the ingestion work changed (base to tag), other than additions, are exactly the nine approved files', () => {
    // `--diff-filter=a` leaves out Added paths (checked in the next-but-two test). `--no-renames` turns a rename into a
    // deletion plus an addition, so a renamed file still shows up here (as the deletion) and fails.
    const changed = git(['diff', '--name-only', '--no-renames', '--diff-filter=a', BASE, TAG]).split('\n').map((x) => x.trim()).filter((x) => x !== '').sort();
    expect(changed).toEqual(APPROVED_MODIFIED);
  });

  it('no tracked file was deleted or renamed, package.json / package-lock.json / tsconfig.json are unchanged, and vitest.config.ts only splits the run', () => {
    expect(git(['diff', '--name-only', '--diff-filter=DR', BASE]).trim()).toBe('');
    for (const f of ['package.json', 'package-lock.json', 'tsconfig.json', 'tests/setup.ts']) {
      expect(lf(readFileSync(join(ROOT, f), 'utf8')), f).toBe(lf(git(['show', `${BASE}:${f}`])));
    }
    // vitest.config.ts was changed once, with approval, only to split `npm test` into two groups run one after the
    // other (every test, then the wall-clock performance budgets alone): browser suites stay opt-in, the shared
    // settings are those of BASE.
    type Project = { extends?: boolean; test?: { name?: string; include?: string[]; exclude?: string[]; sequence?: { groupOrder?: number } } };
    const projects = (vitestConfig.test?.projects ?? []) as Project[];
    expect(projects.map((p) => [p.test?.name, p.test?.sequence?.groupOrder, p.extends])).toEqual([
      ['unit', 0, true],
      ['performance', 1, true]
    ]);
    const [unit, perf] = projects.map((p) => p.test ?? {});
    expect(unit?.include).toEqual(['tests/**/*.test.{ts,tsx}']);
    expect(unit?.exclude).toEqual(expect.arrayContaining(['tests/**/*.browser.test.{ts,tsx}', 'tests/shared/ingest/performance.test.ts']));
    expect(perf?.include).toEqual(['tests/shared/ingest/performance.test.ts']);
    expect(perf?.exclude).toContain('tests/**/*.browser.test.{ts,tsx}');
    expect(vitestConfig.test).toMatchObject({ environment: 'node', setupFiles: ['tests/setup.ts'], env: { TZ: 'America/Chicago' }, restoreMocks: true });
  });

  it('the ingestion work left every other page and component (Dashboard, Atlas, charts, layout, routes) unchanged', () => {
    // additions under src/client (the new ingest components) are checked by the added-paths test below
    const changedClient = git(['diff', '--name-only', '--no-renames', '--diff-filter=a', BASE, TAG, '--', 'src/client']).split('\n').filter((x) => x !== '').sort();
    expect(changedClient).toEqual(['src/client/components/import/ColumnMappingPanel.tsx', 'src/client/pages/ImportPage.tsx', 'src/client/styles/components.css', 'src/client/styles/pages.css']);
  });

  it('files the ingestion work added (base to tag) are only under the approved new paths, and local tooling is never tracked', () => {
    // The approved new paths of the work plus this work item's own deliverables.
    const approvedNew = [
      /^src\/shared\/ingest\//, /^src\/client\/ingest\//, /^src\/server\/ingestLimits\.ts$/,
      /^src\/client\/components\/import\/(FormatPanel|StructurePanel|TablePicker|ValueMappingPanel|UniversalImportCard|EvidenceList|ImportPreview|PasteBox)\.tsx$/,
      /^docs\/ingestion\//, /^tests\/(shared\/ingest|client\/ingest|ingest-kit|fixtures\/ingest|tester\/ingest)\//, /^tests\/server\/ingestLimits\.test\.ts$/,
      /^\.bangiao\/v2-universal-ingestion\//
    ];
    const committedAdded = git(['diff', '--name-only', '--no-renames', '--diff-filter=A', BASE, TAG]).split('\n').map((x) => x.trim()).filter((x) => x !== '');
    expect(committedAdded.filter((f) => !approvedNew.some((re) => re.test(f)))).toEqual([]);
    // Local tooling (agent folders, the user's own skills lock) may sit untracked in the working tree but must never be
    // committed, by this work or any later one. Checked against the current tree.
    const localOnly = [/^\.agents\//, /^\.claude\//, /^\.serena\//, /^\.codex\//, /^skills-lock\.json$/];
    const tracked = git(['ls-files']).split('\n').map((x) => x.trim()).filter((x) => x !== '');
    expect(tracked.filter((f) => localOnly.some((re) => re.test(f)))).toEqual([]);
  });

  it('constants and config defaults are unchanged (no production default raised)', () => {
    for (const f of ['src/shared/constants.ts', 'src/server/config.ts', 'src/server/app.ts']) expect(lf(readFileSync(join(ROOT, f), 'utf8')), f).toBe(lf(git(['show', `${BASE}:${f}`])));
  });

  it('checkpoint tags are intact', () => {
    const tag = (t: string): string => git(['rev-parse', `${t}^{commit}`]).trim();
    expect(tag('SCC-V1.6-Stable').startsWith('046222a')).toBe(true);
    expect(tag('SCC-V2-Dashboard-Stable').startsWith('167cc52')).toBe(true);
    expect(tag('SCC-V1-Stable')).toMatch(/^[0-9a-f]{40}$/);
    expect(tag('SCC-V1.5-Stable')).toMatch(/^[0-9a-f]{40}$/);
    // The work builds on the base: the base must be an ancestor of HEAD (true before and after the work is committed).
    // `git merge-base --is-ancestor` exits non-zero otherwise, which makes `git()` throw.
    expect(() => git(['merge-base', '--is-ancestor', BASE, 'HEAD'])).not.toThrow();
  });
});

describe('TESTER: the Coder guards bite on simulated changes of REAL protected files', () => {
  it('a one-byte change, an appended line or a deletion of a real protected file is reported by compareHashes', () => {
    const files = Object.keys(committed.files);
    const actual = hashFiles(files);
    expect(compareHashes(committed.files, actual)).toEqual({ changed: [], missing: [], added: [] });
    for (const f of ['src/shared/types.ts', 'src/shared/csv/parseCsv.ts', 'src/server/http.ts', 'src/shared/constants.ts']) {
      const text = readFileSync(join(ROOT, f), 'utf8');
      const mutated = text.replace(/\d/, (d) => String((Number(d) + 1) % 10));
      expect(mutated).not.toBe(text);
      expect(compareHashes(committed.files, { ...actual, [f]: myHash(mutated) }).changed).toEqual([f]);
      expect(compareHashes(committed.files, { ...actual, [f]: myHash(`${text}\n// x`) }).changed).toEqual([f]);
      const without = { ...actual };
      delete without[f];
      expect(compareHashes(committed.files, without).missing).toEqual([f]);
    }
    expect(listFiles(PROTECTED_PATHS).length).toBe(37);
  });

  it('import direction: rules bite on real protected files with an injected ingest import', () => {
    const protectedSet = new Set(listFiles(PROTECTED_PATHS).filter((f) => /\.(ts|tsx)$/.test(f)));
    const real = readFileSync(join(ROOT, 'src/shared/domain/snapshot.ts'), 'utf8');
    const v = directionViolations(new Map([['src/shared/domain/snapshot.ts', `import { analyzeFile } from '../ingest/pipeline';\n${real}`]]), protectedSet);
    expect(v.map((x) => x.rule)).toEqual(['a protected module must not import src/shared/ingest or src/client/ingest']);
    // core -> adapter, shared -> client, client -> server
    expect(directionViolations(new Map([['src/shared/ingest/structure/profile.ts', "import { x } from '../adapters/index';"]]), protectedSet)).toHaveLength(1);
    expect(directionViolations(new Map([['src/shared/ingest/messages.ts', "import { y } from '../../client/ingest/runner';"]]), protectedSet)).toHaveLength(1);
    expect(directionViolations(new Map([['src/client/components/import/FormatPanel.tsx', "import { z } from '../../../server/ingestLimits';"]]), protectedSet)).toHaveLength(1);
  });

  it('import scanner coverage gaps (recorded): forms the regex does NOT see', () => {
    // seen
    expect(importsOf("import { a } from '../ingest/a';")).toEqual(['../ingest/a']);
    expect(importsOf("import {\n  a,\n  b\n} from '../ingest/a';")).toEqual(['../ingest/a']);
    // NOT seen by guards.importsOf (each a theoretical bypass of rule 1-4; none is used in the tree today):
    expect(importsOf("export * as ns from '../ingest/a';")).toEqual([]);
    expect(importsOf("const m = require('../ingest/a');")).toEqual([]);
    expect(importsOf("import { a /* note */ } from '../ingest/a';")).toEqual([]);
  });

  it('none of the unseen import forms is used anywhere under src/ today', () => {
    const files = listFiles(['src']).filter((f) => /\.(ts|tsx)$/.test(f));
    const offenders = files.filter((f) => {
      const s = readFileSync(join(ROOT, f), 'utf8');
      return /export\s+\*\s+as\s+\w+\s+from/.test(s) || /\brequire\s*\(/.test(s) || /import\s*\{[^}]*\/\*/.test(s);
    });
    expect(offenders).toEqual([]);
  });
});

describe('TESTER: the coreScan forbidden-word rule (copied verbatim from tests/shared/ingest/coreScan.test.ts line 40)', () => {
  const forbidden = /(delimit|separator|tsv|semicolon|utf-?16|utf-?32|windows-?1252|gzip|xlsx|\.xls\b|\.ods\b|pdf|sqlite|parquet|json lines|ndjson|spreadsheetml)/i;
  it('bites on obvious coupling', () => {
    for (const s of ["if (choice.key === 'delimiter') {}", "const enc = 'utf-16le';", "if (name.endsWith('.xlsx'))", "family === 'gzip'"]) expect(s, s).toMatch(forbidden);
  });
  it('misses real coupling written without the listed words (false negatives, recorded)', () => {
    for (const s of ["if (choice.key === 'encoding') stop();", "row.split(';')", "text.split('\\t')", "if (bytes[0] === 0x50 && bytes[1] === 0x4b) zip();", "if (head.startsWith('<?xml')) xml();", "const isComma = ch === ',';"]) {
      expect(s, s).not.toMatch(forbidden);
    }
  });
  it('flags harmless prose in code strings (false positives, recorded)', () => {
    expect("message: 'Use the thousands separator of your locale'").toMatch(forbidden);
    expect("hint: 'export the report as PDF'").toMatch(forbidden);
  });
});
