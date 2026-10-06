// Round-2 independent verification of R-9 (README's Windows PORT example + config.ts env trimming). Reasons
// through both cmd.exe and PowerShell quoting semantics and tests loadConfig's trimming directly, rather than
// re-testing the exact fixture the coder already added (tests/server/config.test.ts's "trims a trailing space...").

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { loadConfig, ConfigError } from '../../src/server/config';

describe('R-9 regression (round 2, independent): README Windows PORT commands', () => {
  const readme = fs.readFileSync('README.md', 'utf-8');

  it('cmd.exe example quotes the whole assignment, so `set` does not capture a trailing space before &&', () => {
    // cmd.exe's `set NAME=value && cmd` (unquoted) includes every character up to (but not including) the line
    // end or an unescaped `&`; the space before `&&` becomes part of the value: PORT="4000 " (trailing space).
    // Quoting the whole `NAME=value` token, i.e. `set "PORT=4000" && npm start`, makes `set` parse everything
    // inside the quotes as the assignment and stops there, with quotes stripped from the value -- so PORT=4000
    // exactly, no trailing space, regardless of what follows on the line.
    expect(readme).toContain('set "PORT=4000" && npm start');
    // The old, broken form must not still be present anywhere in the doc.
    expect(readme).not.toMatch(/set PORT=4000 &&/);
  });

  it('PowerShell example ($env:PORT=4000) has no equivalent trailing-space hazard', () => {
    // PowerShell's `$env:PORT = 4000; npm start` assigns the *statement* up to the `;` (or newline); PowerShell's
    // parser, unlike cmd.exe's naive text substitution, does not include the separating whitespace/`;` in the
    // assigned value. `$env:PORT` becomes the string "4000" with no trailing space either way -- so no quoting
    // is needed here, and the doc is correct to leave it unquoted.
    expect(readme).toMatch(/\$env:PORT\s*=\s*4000;\s*npm start/);
  });

  it('a value with genuinely-invalid trailing/leading whitespace-only content still round-trips through trim() to empty (treated as unset)', () => {
    // readEnv's contract: trim first, then treat an empty result as "unset" (falls back to default), so an env
    // var that is only whitespace (e.g. a stray `set PORT= && npm start` typo) doesn't crash the server with a
    // confusing "Invalid PORT \"\"" error -- it just uses the default port.
    const config = loadConfig({ PORT: '   ' }, []);
    expect(config.port).toBe(3000); // default, not a thrown ConfigError
  });

  it('trims leading AND trailing whitespace on every trimmable env var (PORT, HOST, SCC_SEED, SCC_TODAY, SCC_MAX_UPLOAD_BYTES)', () => {
    const config = loadConfig(
      {
        PORT: '  4321  ',
        HOST: '  0.0.0.0  ',
        SCC_SEED: '  9  ',
        SCC_TODAY: '  2026-03-01  ',
        SCC_MAX_UPLOAD_BYTES: '  8192  '
      },
      []
    );
    expect(config.port).toBe(4321);
    expect(config.host).toBe('0.0.0.0');
    expect(config.seed).toBe(9);
    expect(config.todayOverride).toBe('2026-03-01');
    expect(config.maxUploadBytes).toBe(8192);
  });

  it('a value with internal whitespace (not just leading/trailing) is still correctly rejected, not silently coerced', () => {
    // Trimming must not paper over a genuinely malformed value like "40 00" (space in the middle) -- that should
    // still throw, exactly as an untrimmed "40 00" would have.
    expect(() => loadConfig({ PORT: '40 00' }, [])).toThrow(ConfigError);
  });

  it('the cmd.exe-style trailing-space bug this R-9 fix targets no longer crashes the server (end-to-end through loadConfig)', () => {
    // Reproduces exactly what `set PORT=4000 && npm start` (unquoted, the OLD broken README text) would have
    // passed as process.env.PORT before the fix: "4000 " with a trailing space.
    expect(() => loadConfig({ PORT: '4000 ' }, [])).not.toThrow();
    expect(loadConfig({ PORT: '4000 ' }, []).port).toBe(4000);
  });
});
