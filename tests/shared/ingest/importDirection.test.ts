// Criterion 38 / SA-4: the import-direction rules.
//   1. no protected module imports from src/shared/ingest/** or src/client/ingest/**
//   2. no core ingest module imports from adapters/** (the only list of adapters is adapters/index.ts, used by the callers)
//   3. shared code (so shared ingest too) imports nothing from src/server or src/client
//   4. client code does not import from src/server
// The rules are pure functions over file contents, so the second block proves they bite on simulated content.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROTECTED_PATHS, ROOT, directionViolations, importsOf, listFiles, listSource, resolveImport } from '../../ingest-kit/guards';

const protectedFiles = new Set(listFiles(PROTECTED_PATHS).filter((f) => /\.(ts|tsx)$/.test(f)));
const sources = (dirs: string[]): Map<string, string> => new Map(listSource(dirs).map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));

describe('import direction in the real source tree', () => {
  const all = sources(['src/shared', 'src/server', 'src/client']);

  it('scans a real, non-trivial tree', () => {
    expect(all.size).toBeGreaterThan(100);
    expect(protectedFiles.size).toBeGreaterThan(25);
    expect([...all.keys()].filter((f) => f.startsWith('src/shared/ingest/')).length).toBeGreaterThan(35);
    expect([...all.keys()].filter((f) => f.startsWith('src/client/ingest/')).length).toBeGreaterThanOrEqual(3);
  });

  it('has no violation of the four rules', () => {
    expect(directionViolations(all, protectedFiles)).toEqual([]);
  });

  it('the client reaches the ingestion code only through the intended entry points', () => {
    const importers = [...all.entries()].filter(([f, s]) => f.startsWith('src/client/') && !f.startsWith('src/client/ingest/') && !f.startsWith('src/client/components/import/') && importsOf(s).some((spec) => /ingest/.test(spec)));
    expect(importers.map(([f]) => f).sort()).toEqual(['src/client/pages/ImportPage.tsx']);
  });

  it('the server touches the ingestion code only for its limits', () => {
    const touching = [...all.entries()].filter(([f, s]) => f.startsWith('src/server/') && importsOf(s).some((spec) => /ingest/.test(spec)));
    expect(touching.map(([f]) => f).sort()).toEqual(['src/server/api.ts', 'src/server/index.ts', 'src/server/ingestLimits.ts']);
    for (const [f, s] of touching) for (const spec of importsOf(s)) if (/ingest/.test(spec) && f !== 'src/server/ingestLimits.ts') expect(spec, f).toBe('./ingestLimits');
    // ingestLimits itself uses only the shared limits module
    const limits = importsOf(all.get('src/server/ingestLimits.ts') as string).filter((s) => /ingest/.test(s));
    expect(limits).toEqual(['../shared/ingest/limits']);
  });
});

describe('the rules bite (simulated content)', () => {
  const run = (files: Record<string, string>, protectedList: string[] = []): ReturnType<typeof directionViolations> =>
    directionViolations(new Map(Object.entries(files)), new Set(protectedList));

  it('resolves relative specifiers and ignores packages', () => {
    expect(resolveImport('src/shared/csv/a.ts', '../ingest/types')).toBe('src/shared/ingest/types');
    expect(resolveImport('src/client/pages/P.tsx', '../ingest/runner')).toBe('src/client/ingest/runner');
    expect(resolveImport('src/shared/a.ts', 'react')).toBeNull();
    expect(resolveImport('src/shared/a.ts', 'node:fs')).toBeNull();
  });

  it('finds every import form', () => {
    const text = "import a from './a';\nimport type { B } from '../b';\nimport * as c from \"./c\";\nimport './side';\nexport { d } from './d';\nexport * from './e';\nconst f = await import('./f');\n";
    expect(importsOf(text).sort()).toEqual(['../b', './a', './c', './d', './e', './f', './side']);
  });

  it('rule 1: a protected module importing ingestion code is reported (static, type-only and dynamic imports)', () => {
    for (const line of ["import { x } from '../ingest/types';", "import type { X } from '../../client/ingest/runner';", "const m = await import('../ingest/limits');", "export { y } from '../ingest/messages';"]) {
      const v = run({ 'src/shared/csv/parseCsv.ts': line }, ['src/shared/csv/parseCsv.ts']).filter((x) => /protected module/.test(x.rule));
      expect(v, line).toHaveLength(1);
      expect(v[0]?.rule).toMatch(/protected module/);
    }
    expect(run({ 'src/shared/csv/parseCsv.ts': "import { x } from '../ingest/types';" }, [])).toEqual([]); // not protected: rule 1 does not apply (rule 3 etc. do not either)
  });

  it('rule 2: a core ingest module importing an adapter is reported, an adapter importing core is not', () => {
    expect(run({ 'src/shared/ingest/pipeline.ts': "import { delimitedAdapter } from './adapters/delimited/adapter';" })).toHaveLength(1);
    expect(run({ 'src/shared/ingest/detect/arbiter.ts': "import { gzip } from '../adapters/gzip/adapter';" })[0]?.rule).toMatch(/adapters/);
    expect(run({ 'src/shared/ingest/adapters/gzip/adapter.ts': "import { ingestError } from '../../messages';" })).toEqual([]);
    expect(run({ 'src/shared/ingest/adapters/index.ts': "import { a } from './delimited/adapter';" })).toEqual([]);
  });

  it('rule 3: shared code importing the server or the client is reported', () => {
    expect(run({ 'src/shared/ingest/limits.ts': "import { loadConfig } from '../../server/config';" })[0]?.rule).toMatch(/shared code/);
    expect(run({ 'src/shared/ingest/pipeline.ts': "import { Icon } from '../../client/components/ui/Icon';" })).toHaveLength(1);
    expect(run({ 'src/shared/csv/a.ts': "import { b } from '../types';" })).toEqual([]);
  });

  it('rule 4: client code importing the server is reported', () => {
    expect(run({ 'src/client/ingest/runner.ts': "import { createAppServer } from '../../server/app';" })[0]?.rule).toMatch(/client code/);
    expect(run({ 'src/client/ingest/runner.ts': "import { analyzeFile } from '../../shared/ingest/pipeline';" })).toEqual([]);
  });
});
