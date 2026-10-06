import { describe, it, expect } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { assertAllowedHost, assertSameOriginMutation, decodeUtf8Strict, sanitizeFilename, HttpError } from '../../src/server/http';

function makeReq(headers: Record<string, string | undefined>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe('sanitizeFilename', () => {
  it('returns upload.csv when raw is undefined', () => {
    expect(sanitizeFilename(undefined)).toBe('upload.csv');
  });

  it('strips path components (posix and windows)', () => {
    expect(sanitizeFilename('folder%2Fsub%2Ffile.csv')).toBe('file.csv');
    expect(sanitizeFilename('C%3A%5Cusers%5Cme%5Cdata.csv')).toBe('data.csv');
  });

  it('decodes URI-encoded unicode names and replaces unsafe characters', () => {
    expect(sanitizeFilename(encodeURIComponent('inventário.csv'))).toBe('inventário.csv'.replace(/[^A-Za-z0-9 ._-]/g, '_'));
  });

  it('falls back to the raw string when decodeURIComponent throws', () => {
    expect(sanitizeFilename('%')).toBe('_');
  });

  it('truncates to 80 characters', () => {
    const long = 'a'.repeat(200) + '.csv';
    const result = sanitizeFilename(long);
    expect(result.length).toBe(80);
  });

  it('returns upload.csv when the cleaned name is empty', () => {
    expect(sanitizeFilename('')).toBe('upload.csv');
  });
});

describe('decodeUtf8Strict', () => {
  it('decodes valid UTF-8 bytes', () => {
    expect(decodeUtf8Strict(new TextEncoder().encode('hello'))).toBe('hello');
  });

  it('strips a leading BOM', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('hi')]);
    expect(decodeUtf8Strict(withBom)).toBe('hi');
  });

  it('returns null for invalid UTF-8 bytes', () => {
    expect(decodeUtf8Strict(new Uint8Array([0xe9, 0x00, 0xff]))).toBeNull();
  });
});

describe('assertSameOriginMutation', () => {
  it('throws 403 when the X-SCC-Request header is missing', () => {
    const req = makeReq({});
    expect(() => assertSameOriginMutation(req)).toThrow(HttpError);
    try {
      assertSameOriginMutation(req);
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(403);
      expect((err as HttpError).message).toBe('Missing X-SCC-Request header.');
    }
  });

  it('passes when the header is present and there is no Origin header', () => {
    const req = makeReq({ 'x-scc-request': '1' });
    expect(() => assertSameOriginMutation(req)).not.toThrow();
  });

  it('passes when Origin matches Host', () => {
    const req = makeReq({ 'x-scc-request': '1', origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000' });
    expect(() => assertSameOriginMutation(req)).not.toThrow();
  });

  it('throws 403 when Origin does not match Host', () => {
    const req = makeReq({ 'x-scc-request': '1', origin: 'http://evil.example', host: '127.0.0.1:3000' });
    expect(() => assertSameOriginMutation(req)).toThrow(HttpError);
    try {
      assertSameOriginMutation(req);
    } catch (err) {
      expect((err as HttpError).status).toBe(403);
    }
  });

  it('throws 403 when Origin is malformed', () => {
    const req = makeReq({ 'x-scc-request': '1', origin: 'not a url', host: '127.0.0.1:3000' });
    expect(() => assertSameOriginMutation(req)).toThrow(HttpError);
  });
});

describe('assertAllowedHost (R-11: DNS rebinding)', () => {
  const config = { host: '127.0.0.1', port: 3000 };

  it('passes for 127.0.0.1:<port>, localhost:<port> and [::1]:<port>', () => {
    expect(() => assertAllowedHost(makeReq({ host: '127.0.0.1:3000' }), config)).not.toThrow();
    expect(() => assertAllowedHost(makeReq({ host: 'localhost:3000' }), config)).not.toThrow();
    expect(() => assertAllowedHost(makeReq({ host: '[::1]:3000' }), config)).not.toThrow();
  });

  it('passes for the configured HOST:<port>', () => {
    expect(() => assertAllowedHost(makeReq({ host: '0.0.0.0:3000' }), { host: '0.0.0.0', port: 3000 })).not.toThrow();
  });

  it('rejects a rebound attacker domain even with the right port (DNS rebinding)', () => {
    const req = makeReq({ host: 'evil.example:3000' });
    expect(() => assertAllowedHost(req, config)).toThrow(HttpError);
    try {
      assertAllowedHost(req, config);
    } catch (err) {
      expect((err as HttpError).status).toBe(421);
    }
  });

  it('rejects a mismatched port on an otherwise-allowed hostname', () => {
    expect(() => assertAllowedHost(makeReq({ host: '127.0.0.1:9999' }), config)).toThrow(HttpError);
  });

  it('rejects a missing Host header', () => {
    expect(() => assertAllowedHost(makeReq({}), config)).toThrow(HttpError);
  });
});
