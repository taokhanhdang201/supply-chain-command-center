// Helpers for the architecture guards (criteria 34, 38): the protected file set and its hashes, and the import-direction
// rules. They are pure functions over file contents so the tests can also prove the guards bite on simulated content.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

export const ROOT = resolve(process.cwd());

/** Files and folders that Phase 0 + 1a must not change (SA-4; ke-hoach (B) "Do NOT touch"). api.ts and index.ts are NOT here:
 *  they carry the approved M4 edits. A folder means every file below it. */
export const PROTECTED_PATHS: readonly string[] = [
  'src/shared/types.ts',
  'src/shared/domain',
  'src/shared/money.ts',
  'src/shared/dates.ts',
  'src/shared/formulas.ts',
  'src/shared/format.ts',
  'src/shared/geo.ts',
  'src/shared/constants.ts',
  'src/shared/reference',
  'src/shared/sample',
  'src/shared/csv',
  'src/shared/mapping',
  'src/server/http.ts',
  'src/server/store.ts',
  'src/server/app.ts',
  'src/server/config.ts',
  'src/server/staticFiles.ts',
  'src/server/devVite.ts',
  'src/client/api/apiClient.ts',
  'src/client/state/DataContext.tsx',
  'public/templates'
];

/** Every file (repository-relative, forward slashes, sorted) below the given files and folders. */
export function listFiles(paths: readonly string[], root = ROOT): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    const abs = join(root, rel);
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const name of readdirSync(abs).sort()) walk(`${rel}/${name}`);
    } else out.push(rel);
  };
  for (const p of paths) walk(p);
  return out.sort();
}

/** Line endings do not matter (autocrlf): CRLF and lone CR become LF before hashing. */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export function sha256(text: string): string {
  return createHash('sha256').update(normalizeEol(text), 'utf8').digest('hex');
}

export function hashFiles(files: readonly string[], root = ROOT): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files) out[f] = sha256(readFileSync(join(root, f), 'utf8'));
  return out;
}

export interface HashDifference {
  changed: string[];
  missing: string[];
  added: string[];
}

/** What differs between the committed hashes and the current ones. All three lists empty = the guard passes. */
export function compareHashes(expected: Readonly<Record<string, string>>, actual: Readonly<Record<string, string>>): HashDifference {
  const changed: string[] = [];
  const missing: string[] = [];
  for (const [file, hash] of Object.entries(expected)) {
    if (!(file in actual)) missing.push(file);
    else if (actual[file] !== hash) changed.push(file);
  }
  const added = Object.keys(actual).filter((f) => !(f in expected));
  return { changed: changed.sort(), missing: missing.sort(), added: added.sort() };
}

// ---- import direction ---------------------------------------------------------------------------------------------

/** The module specifiers a source file imports (static, `export ... from`, dynamic, `import type`). */
export function importsOf(source: string): string[] {
  const specs: string[] = [];
  const patterns = [/\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/g, /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g];
  for (const re of patterns) for (const m of source.matchAll(re)) specs.push(m[1] as string);
  return [...new Set(specs)];
}

/** Resolves a relative specifier against the importing file; non-relative specifiers (packages, node:) return null. */
export function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  return posix.normalize(posix.join(posix.dirname(fromFile), spec));
}

export function listSource(dirs: readonly string[], extensions = /\.(ts|tsx)$/, root = ROOT): string[] {
  return listFiles(dirs, root).filter((f) => extensions.test(f));
}

export interface Violation {
  file: string;
  imports: string;
  rule: string;
}

const under = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);

/** The direction rules, over a map of repository-relative path -> source text. */
export function directionViolations(files: ReadonlyMap<string, string>, protectedFiles: ReadonlySet<string>): Violation[] {
  const out: Violation[] = [];
  for (const [file, source] of files) {
    for (const spec of importsOf(source)) {
      const target = resolveImport(file, spec);
      if (target === null) continue;
      const add = (rule: string): void => void out.push({ file, imports: target, rule });
      const intoIngest = under(target, 'src/shared/ingest') || under(target, 'src/client/ingest');
      // 1. a protected module never imports ingestion code
      if (protectedFiles.has(file) && intoIngest) add('a protected module must not import src/shared/ingest or src/client/ingest');
      // 2. the core of the ingestion pipeline never imports an adapter
      if (under(file, 'src/shared/ingest') && !under(file, 'src/shared/ingest/adapters') && under(target, 'src/shared/ingest/adapters')) add('a core ingest module must not import from adapters/**');
      // 3. shared code never imports the client or the server
      if (under(file, 'src/shared') && (under(target, 'src/client') || under(target, 'src/server'))) add('shared code must not import src/client or src/server');
      // 4. the client never imports the server
      if (under(file, 'src/client') && under(target, 'src/server')) add('client code must not import src/server');
    }
  }
  return out;
}
