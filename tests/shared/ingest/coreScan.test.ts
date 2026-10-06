// Static scans that keep the core format-agnostic (SA-1, SA-3; criterion 22). Core = everything under src/shared/ingest
// except adapters/**. The full guard (hash guard over protected files, import direction) arrives in milestone M6; this
// part protects the contracts while the rest of the core is written.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'src/shared/ingest');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const all = walk(ROOT);
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/');
const core = all.filter((f) => !rel(f).startsWith('adapters/'));
const adapterFiles = all.filter((f) => rel(f).startsWith('adapters/'));
const source = (f: string) => readFileSync(f, 'utf8');
/** Source with comments removed (prose may mention concepts; code may not). */
const code = (f: string) => source(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the core knows no format', () => {
  it('has core modules to scan', () => {
    expect(core.map(rel)).toEqual(expect.arrayContaining(['types.ts', 'registry.ts', 'limits.ts', 'messages.ts', 'detect/arbiter.ts', 'detect/bytes.ts']));
  });

  it('no core module imports from adapters/**', () => {
    for (const f of core) expect(code(f), rel(f)).not.toMatch(/from\s+['"][^'"]*\/adapters(\/|['"])/);
  });

  it('no core module names a delimiter, encoding, extension or format id in code', () => {
    // Words that belong to adapters. Canonical-CSV/dry-run modules (added later) are allowed to say "csv" because the
    // server contract is CSV; they must still never mention delimiters, encodings or source formats.
    const forbidden = /(delimit|separator|tsv|semicolon|utf-?16|utf-?32|windows-?1252|gzip|xlsx|\.xls\b|\.ods\b|pdf|sqlite|parquet|json lines|ndjson|spreadsheetml)/i;
    const csvAllowed = new Set(['messages.ts', 'canonical/buildCsv.ts', 'canonical/schemaRegistry.ts', 'validate/dryRun.ts', 'pipeline.ts']);
    for (const f of core) {
      const text = code(f);
      expect(text, `${rel(f)} must not mention adapter concepts`).not.toMatch(forbidden);
      if (!csvAllowed.has(rel(f))) expect(text, `${rel(f)} must not mention csv`).not.toMatch(/\bcsv\b/i);
    }
  });

  it('no core module switches on an extension or a format id', () => {
    for (const f of core) {
      const text = code(f);
      expect(text, rel(f)).not.toMatch(/switch\s*\([^)]*(extension|ext|format|mime|adapterId|family)[^)]*\)/i);
      expect(text, rel(f)).not.toMatch(/===?\s*['"]\.(csv|tsv|txt|xlsx|xls|json|xml|html|pdf|gz)['"]/);
      expect(text, rel(f)).not.toMatch(/===?\s*['"](delimited-text|gzip|refuse-[a-z0-9-]+)['"]/);
    }
  });

  it('adapters are listed only in adapters/index.ts (one registration per adapter)', () => {
    const index = source(join(ROOT, 'adapters/index.ts'));
    const imports = [...index.matchAll(/from\s+'\.\/([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['delimited/adapter', 'gzip/adapter', 'refusals']);
    for (const f of adapterFiles.filter((x) => rel(x) !== 'adapters/index.ts')) expect(code(f), rel(f)).not.toMatch(/registerAdapter|\.register\(/);
  });

  it('adapters depend only on the core contracts and on each other\'s pure helpers, never on the pipeline or the UI', () => {
    for (const f of adapterFiles) {
      const imports = [...source(f).matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] as string);
      for (const i of imports) expect(i, `${rel(f)} imports ${i}`).not.toMatch(/pipeline|client|server|mapping|preview|canonical/);
    }
  });
});
