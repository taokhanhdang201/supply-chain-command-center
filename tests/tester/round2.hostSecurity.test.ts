// Round-2 independent verification of R-11 (DNS-rebinding Host allowlist), against a REAL HTTP server (not a
// unit-level `assertAllowedHost(makeReq(...))` call), independent of the coder's own end-to-end test in
// tests/server/api.test.ts. Covers: a real foreign-Host request is rejected; the legit 127.0.0.1:<port> and
// localhost:<port> forms are accepted; a missing Host header does not crash the server; and an IPv6 literal
// Host doesn't crash the server either (accepted only when it matches the allowlisted [::1]:<port> form).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import http from 'node:http';
import { createAppServer } from '../../src/server/app';
import { createApiHandler } from '../../src/server/api';
import { createDataStore } from '../../src/server/store';
import type { AppConfig } from '../../src/server/config';
import { createSampleDataset } from '../../src/shared/sample/generateSampleData';

const TODAY = '2026-09-28';

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { port: 0, host: '127.0.0.1', seed: 42, todayOverride: TODAY, maxUploadBytes: 2_097_152, mode: 'test', ...overrides };
}

async function startTestServer(config: AppConfig) {
  const store = createDataStore(createSampleDataset(config.seed, TODAY, '2026-09-28T00:00:00.000Z'));
  const api = createApiHandler({
    config,
    store,
    getToday: () => config.todayOverride ?? TODAY,
    createSampleDataset: () => createSampleDataset(config.seed, TODAY, '2026-09-28T00:00:00.000Z'),
    now: () => new Date('2026-09-28T12:00:00.000Z')
  });
  const server = createAppServer({ config, api });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** Sends a raw request via node:http, setting `Host` exactly as given (fetch/undici forbid overriding it). */
function rawRequest(port: number, headers: Record<string, string | undefined>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const cleanHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (v !== undefined) cleanHeaders[k] = v;
    }
    const req = http.request({ hostname: '127.0.0.1', port, path: '/api/health', headers: cleanHeaders }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Sends a raw HTTP/1.1 request line-by-line over a plain TCP socket, with full control over headers -- needed
 * to actually omit the Host header entirely, since node:http's client (like every HTTP/1.1 client) always
 * auto-supplies one when not given. */
function rawSocketRequest(port: number, extraHeaderLines: string[]): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      const lines = ['GET /api/health HTTP/1.1', ...extraHeaderLines, 'Connection: close', '', ''];
      socket.write(lines.join('\r\n'));
    });
    let raw = '';
    socket.on('data', (chunk) => (raw += chunk.toString('utf-8')));
    socket.on('end', () => {
      const statusLine = raw.split('\r\n')[0] ?? '';
      const match = /HTTP\/1\.\d (\d+)/.exec(statusLine);
      const body = raw.split('\r\n\r\n')[1] ?? '';
      resolve({ status: match ? Number(match[1]) : 0, body });
    });
    socket.on('error', reject);
    setTimeout(() => reject(new Error('rawSocketRequest timed out')), 5000);
  });
}

describe('R-11 regression (round 2, independent, real HTTP server): Host allowlist', () => {
  let port: number;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const server = await startTestServer(baseConfig());
    port = server.port;
    close = server.close;
  });

  afterAll(async () => {
    await close();
  });

  it('rejects a foreign Host header (simulated DNS rebinding) with 421, and the body is a clean JSON error (no crash)', async () => {
    const { status, body } = await rawRequest(port, { Host: 'evil.example:80' });
    expect(status).toBe(421);
    const parsed = JSON.parse(body);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('MISDIRECTED_REQUEST');
  });

  it('accepts a request with Host: 127.0.0.1:<real port>', async () => {
    const { status } = await rawRequest(port, { Host: `127.0.0.1:${port}` });
    expect(status).toBe(200);
  });

  it('accepts a request with Host: localhost:<real port>', async () => {
    const { status } = await rawRequest(port, { Host: `localhost:${port}` });
    expect(status).toBe(200);
  });

  it('rejects Host: 127.0.0.1:<real port> when the port number is wrong (not just the hostname)', async () => {
    const { status } = await rawRequest(port, { Host: `127.0.0.1:${port + 1}` });
    expect(status).toBe(421);
  });

  it('does not crash when the Host header is entirely absent from the raw request -- no 500, no hang', async () => {
    // HTTP/1.1 requires a Host header; node:http's own request parser rejects a request that omits it with a
    // bare 400 before the request ever reaches our application code (assertAllowedHost is never even called) --
    // confirmed here at the socket level. Either way, the key property this test protects is "does not crash or
    // hang the server process": a clean 400 from Node's own parser satisfies that just as well as our own 421
    // would, so this asserts the actual (safe) behavior rather than assuming assertAllowedHost is reached.
    const { status } = await rawSocketRequest(port, []);
    expect(status).toBe(400);
  });

  it('does not crash on an IPv6 literal Host header, and rejects one that does not match [::1]:<port>', async () => {
    const { status } = await rawRequest(port, { Host: '[::1]:80' }); // wrong port -> should be rejected, not crash
    expect(status).toBe(421);
  });

  it('accepts a correctly-formed IPv6 loopback Host: [::1]:<real port>', async () => {
    const { status } = await rawRequest(port, { Host: `[::1]:${port}` });
    expect(status).toBe(200);
  });

  it('does not crash on a garbage/malformed Host header (no port, random junk)', async () => {
    for (const host of ['not-a-host-at-all', 'evil.example', '::::']) {
      const { status } = await rawRequest(port, { Host: host });
      expect(status).toBe(421);
    }
  });

  it('does not crash on an explicitly empty Host header value', async () => {
    const { status } = await rawSocketRequest(port, ['Host: ']);
    expect(status).toBe(421);
  });
});
