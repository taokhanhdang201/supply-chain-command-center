// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { ConfigError, loadConfig } from '../../src/server/config';

describe('loadConfig', () => {
  it('uses defaults when no env vars are set', () => {
    const config = loadConfig({}, []);
    expect(config).toEqual({
      port: 3000,
      host: '127.0.0.1',
      seed: 42,
      todayOverride: null,
      maxUploadBytes: 2_097_152,
      mode: 'production'
    });
  });

  it('treats empty-string env values as unset', () => {
    const config = loadConfig({ PORT: '', HOST: '', SCC_SEED: '', SCC_TODAY: '', SCC_MAX_UPLOAD_BYTES: '' }, []);
    expect(config.port).toBe(3000);
    expect(config.host).toBe('127.0.0.1');
  });

  it('reads valid overrides', () => {
    const config = loadConfig(
      { PORT: '4000', HOST: '0.0.0.0', SCC_SEED: '7', SCC_TODAY: '2026-03-01', SCC_MAX_UPLOAD_BYTES: '4096' },
      []
    );
    expect(config).toEqual({
      port: 4000,
      host: '0.0.0.0',
      seed: 7,
      todayOverride: '2026-03-01',
      maxUploadBytes: 4096,
      mode: 'production'
    });
  });

  it('sets mode to development when --dev is present in argv', () => {
    expect(loadConfig({}, ['--dev']).mode).toBe('development');
    expect(loadConfig({}, ['--other']).mode).toBe('production');
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => loadConfig({ PORT: 'abc' }, [])).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: 'abc' }, [])).toThrow(
      'Invalid PORT "abc": expected an integer between 1 and 65535.'
    );
  });

  it('rejects PORT out of range', () => {
    expect(() => loadConfig({ PORT: '0' }, [])).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: '70000' }, [])).toThrow(ConfigError);
  });

  it('rejects an out-of-range SCC_SEED', () => {
    expect(() => loadConfig({ SCC_SEED: '-1' }, [])).toThrow(ConfigError);
    expect(() => loadConfig({ SCC_SEED: '4294967296' }, [])).toThrow(ConfigError);
  });

  it('rejects an invalid SCC_TODAY', () => {
    expect(() => loadConfig({ SCC_TODAY: 'not-a-date' }, [])).toThrow(ConfigError);
    expect(() => loadConfig({ SCC_TODAY: '2026-13-40' }, [])).toThrow(ConfigError);
  });

  it('accepts a valid SCC_TODAY', () => {
    expect(loadConfig({ SCC_TODAY: '2026-06-15' }, []).todayOverride).toBe('2026-06-15');
  });

  it('rejects SCC_MAX_UPLOAD_BYTES out of range', () => {
    expect(() => loadConfig({ SCC_MAX_UPLOAD_BYTES: '100' }, [])).toThrow(ConfigError);
    expect(() => loadConfig({ SCC_MAX_UPLOAD_BYTES: '99999999' }, [])).toThrow(ConfigError);
  });

  it('rejects an empty HOST-like edge case gracefully (falls back to default)', () => {
    expect(loadConfig({ HOST: '' }, []).host).toBe('127.0.0.1');
  });

  it('trims a trailing space left by an unquoted cmd.exe env assignment (R-9)', () => {
    // e.g. `set PORT=4000 && npm start` in cmd.exe assigns PORT="4000 " (trailing space) unless the whole
    // NAME=value assignment is quoted.
    const config = loadConfig({ PORT: '4000 ', HOST: ' 0.0.0.0 ' }, []);
    expect(config.port).toBe(4000);
    expect(config.host).toBe('0.0.0.0');
  });
});
