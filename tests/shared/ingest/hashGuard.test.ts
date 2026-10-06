// Criterion 38 (SA-4): the hash guard. The protected files (the canonical model, domain logic, CSV and mapping code, reference
// and sample data, the server security and storage code, the API client, the data context and the templates) must not
// change during Phase 0 + 1a. Their SHA-256 hashes (line endings normalised) are committed in
// tests/fixtures/ingest/protected-hashes.json.
//
// CHANGING OR ADDING A HASH NEEDS THE USER'S EXPLICIT APPROVAL. Record it here, in this comment, with the date and the
// reason, then regenerate the JSON. Approvals so far: none (api.ts and index.ts are deliberately not protected: they carry
// the approved M4 edits of decision 14a).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROTECTED_PATHS, ROOT, compareHashes, hashFiles, listFiles, normalizeEol, sha256 } from '../../ingest-kit/guards';

interface HashFile {
  base: string;
  files: Record<string, string>;
}
const committed = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/ingest/protected-hashes.json'), 'utf8')) as HashFile;

describe('hash guard over the protected file set', () => {
  it('the committed list covers exactly the protected files that exist now', () => {
    const present = listFiles(PROTECTED_PATHS);
    expect(Object.keys(committed.files).sort()).toEqual(present);
    expect(present.length).toBeGreaterThan(30);
    // the files the plan names are all in it
    for (const must of ['src/shared/types.ts', 'src/shared/money.ts', 'src/shared/csv/parseCsv.ts', 'src/shared/mapping/aliases.ts', 'src/server/http.ts', 'src/server/store.ts', 'src/shared/sample/generateSampleData.ts']) {
      expect(committed.files[must], must).toMatch(/^[0-9a-f]{64}$/);
    }
    // the two files with the approved M4 edits are NOT protected
    expect(committed.files['src/server/api.ts']).toBeUndefined();
    expect(committed.files['src/server/index.ts']).toBeUndefined();
  });

  it('no protected file changed', () => {
    const difference = compareHashes(committed.files, hashFiles(Object.keys(committed.files)));
    expect(difference).toEqual({ changed: [], missing: [], added: [] });
  });
});

describe('the guard bites (pure helpers over simulated content)', () => {
  const original = "export const LIMIT = 20000;\r\nexport const NAME = 'x';\r\n";
  const expected = { 'src/shared/constants.ts': sha256(original), 'src/shared/money.ts': sha256('a') };

  it('is not disturbed by line endings', () => {
    expect(sha256(original)).toBe(sha256(normalizeEol(original)));
    expect(sha256('a\nb\n')).toBe(sha256('a\r\nb\r\n'));
    expect(compareHashes(expected, { 'src/shared/constants.ts': sha256(original.replace(/\r\n/g, '\n')), 'src/shared/money.ts': sha256('a') })).toEqual({ changed: [], missing: [], added: [] });
  });

  it('reports a one-character change, a raised default, a deleted file and a new protected file', () => {
    const raised = original.replace('20000', '20001');
    expect(sha256(raised)).not.toBe(sha256(original));
    expect(compareHashes(expected, { 'src/shared/constants.ts': sha256(raised), 'src/shared/money.ts': sha256('a') })).toEqual({ changed: ['src/shared/constants.ts'], missing: [], added: [] });
    expect(compareHashes(expected, { 'src/shared/constants.ts': sha256(original) })).toEqual({ changed: [], missing: ['src/shared/money.ts'], added: [] });
    expect(compareHashes(expected, { ...expected, 'src/shared/csv/new.ts': sha256('b') })).toEqual({ changed: [], missing: [], added: ['src/shared/csv/new.ts'] });
    // whitespace and case are content too
    expect(sha256(`${original} `)).not.toBe(sha256(original));
    expect(sha256(original.toUpperCase())).not.toBe(sha256(original));
  });

  it('the committed JSON records the base commit and a note about approvals', () => {
    expect(committed.base).toBe('167cc52');
    expect(JSON.stringify(committed)).toContain('explicit approval');
  });
});
