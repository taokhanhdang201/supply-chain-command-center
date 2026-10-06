// V1.6 tester: static guards for a presentation-only redesign (no browser needed, runs in the default suite).
// - no reference image / design-references path is imported or referenced from src/ or shipped in dist/
// - no reference brand or name appears in the UI source
// - fonts are self-hosted (no remote font/CSS URLs)
// - shared/server code is byte-identical to the V1.5 tag when that tag is available locally
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const srcFiles = walk('src').filter((f) => /\.(tsx?|css|html)$/.test(f));
const read = (f: string) => fs.readFileSync(f, 'utf-8');

describe('V1.6 presentation-only guards', () => {
  it('src never references docs/design-references or imports raster images', () => {
    for (const f of srcFiles) {
      const t = read(f);
      expect(t, f).not.toMatch(/design-references/);
      expect(t, f).not.toMatch(/(from|import)\s+['"][^'"]+\.(jpe?g|png|webp|gif|avif)['"]/i);
      expect(t, f).not.toMatch(/url\(\s*['"]?[^)'"]+\.(jpe?g|png|webp|gif|avif)/i);
    }
  });

  it('no reference brand or name appears in the UI source', () => {
    const banned = /elias\s*noir|kleen|coldport|fiftytwo|global logistics network monitor/i;
    for (const f of [...srcFiles, 'index.html']) expect(read(f), f).not.toMatch(banned);
  });

  it('CSS and HTML load nothing from the network (fonts are self-hosted)', () => {
    for (const f of srcFiles.filter((f) => /\.(css|html)$/.test(f)).concat('index.html')) {
      const urls = (read(f).match(/https?:\/\/[^\s"')]+/g) ?? []).filter((u) => u !== 'http://www.w3.org/2000/svg');
      expect(urls, f).toEqual([]);
    }
  });

  it('a built dist/client (if present) ships no raster image and no design-references file', () => {
    if (!fs.existsSync('dist/client')) return;
    const files = walk('dist/client');
    expect(files.filter((f) => /\.(jpe?g|png|webp|gif|avif)$/i.test(f))).toEqual([]);
    expect(files.filter((f) => /design-references/.test(f))).toEqual([]);
    for (const f of files.filter((f) => /\.(js|css|html)$/.test(f))) expect(read(f), f).not.toMatch(/design-references/);
    expect(files.filter((f) => f.endsWith('.woff2')).length).toBeGreaterThan(0);
  });

  it('src/shared and src/server are unchanged versus SCC-V1.5-Stable (skipped only when the tag is absent)', () => {
    // V2 ingestion M4: the user approved (yeu-cau.md section B2, ke-hoach decision 14a) exactly these two server edits
    // (SCC_MAX_IMPORT_ROWS limit wiring). Any other modified, deleted or renamed path under src/shared or src/server still
    // fails this guard.
    // V2 ingestion, second user approval (yeu-cau.md section B2, after the Reviewer's CAN SUA): once the work is committed,
    // the NEW ingestion files show up in this diff as added paths. ADDED files are accepted only under the two locations of
    // ALLOWED_V2_ADDED; any other added file still fails. Renames are reported as a deletion plus an addition
    // (`--no-renames`), so a rename can never slip through as an "addition".
    const ALLOWED_V2_CHANGES = ['src/server/api.ts', 'src/server/index.ts'];
    const ALLOWED_V2_ADDED = [/^src\/shared\/ingest\//, /^src\/server\/ingestLimits\.ts$/];
    const unexpected = (nameStatus: string): string[] =>
      nameStatus
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l !== '')
        .flatMap((line) => {
          const [status = '', path = ''] = line.split('\t');
          if (status === 'A') return ALLOWED_V2_ADDED.some((re) => re.test(path)) ? [] : [path];
          return ALLOWED_V2_CHANGES.includes(path) ? [] : [path];
        });
    expect(ALLOWED_V2_CHANGES).toHaveLength(2); // neither allow-list can silently grow
    expect(ALLOWED_V2_ADDED).toHaveLength(2);
    expect(unexpected('M\tsrc/server/api.ts\nM\tsrc/server/index.ts\n')).toEqual([]);
    expect(unexpected('M\tsrc/server/api.ts\nM\tsrc/server/config.ts\nM\tsrc/shared/money.ts\n')).toEqual(['src/server/config.ts', 'src/shared/money.ts']); // the guard still bites
    expect(unexpected('A\tsrc/shared/ingest/pipeline.ts\nA\tsrc/shared/ingest/adapters/index.ts\nA\tsrc/server/ingestLimits.ts\n')).toEqual([]);
    expect(unexpected('A\tsrc/shared/evil.ts\nA\tsrc/server/other.ts\nA\tsrc/shared/ingestion/a.ts\nA\tsrc/shared/domain/new.ts\nA\tsrc/server/ingestLimits.ts.bak\n')).toEqual([
      'src/shared/evil.ts',
      'src/server/other.ts',
      'src/shared/ingestion/a.ts',
      'src/shared/domain/new.ts',
      'src/server/ingestLimits.ts.bak'
    ]); // an addition anywhere else still fails
    expect(unexpected('M\tsrc/shared/ingest/pipeline.ts\nD\tsrc/shared/types.ts\nD\tsrc/server/ingestLimits.ts\n')).toEqual([
      'src/shared/ingest/pipeline.ts',
      'src/shared/types.ts',
      'src/server/ingestLimits.ts'
    ]); // the added-path allowance never covers a modification or a deletion
    let diff: string;
    try {
      execFileSync('git', ['rev-parse', '--verify', 'SCC-V1.5-Stable'], { stdio: 'pipe' });
      diff = execFileSync('git', ['diff', '--name-status', '--no-renames', 'SCC-V1.5-Stable', '--', 'src/shared', 'src/server'], { encoding: 'utf-8' });
    } catch {
      return; // no git or tag in this environment
    }
    expect(unexpected(diff)).toEqual([]);
  });
});
