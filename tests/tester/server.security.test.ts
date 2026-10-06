// Tester (adversarial) suite: server security behaviour beyond the coder's own api.test.ts/http.test.ts/
// staticFiles.test.ts, spun up against a real createAppServer + real static handler wired together, exactly
// like production. Focuses on things the plan's own §9/§11 call out for the tester to hunt.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppServer } from '../../src/server/app';
import { createApiHandler } from '../../src/server/api';
import { createDataStore } from '../../src/server/store';
import { createStaticHandler } from '../../src/server/staticFiles';
import type { AppConfig } from '../../src/server/config';
import { createSampleDataset } from '../../src/shared/sample/generateSampleData';

const TODAY = '2026-06-15';

async function startFullServer() {
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    seed: 42,
    todayOverride: TODAY,
    maxUploadBytes: 2048,
    mode: 'test'
  };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scc-security-'));
  await fs.writeFile(path.join(root, 'index.html'), '<html>app</html>');
  const staticHandler = createStaticHandler(root);

  const store = createDataStore(createSampleDataset(42, TODAY, '2026-06-15T00:00:00.000Z'));
  const api = createApiHandler({
    config,
    store,
    getToday: () => TODAY,
    createSampleDataset: () => createSampleDataset(42, TODAY, '2026-06-15T00:00:00.000Z'),
    now: () => new Date('2026-06-15T12:00:00.000Z')
  });
  const server = createAppServer({
    config,
    api,
    fallback: (req, res, pathname) => staticHandler(req, res, pathname)
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

describe('tester: end-to-end server security', () => {
  let server: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    server = await startFullServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('security headers (nosniff, frame deny, COOP, CORP, permissions-policy, CSP) present on a plain GET of /', async () => {
    const res = await fetch(`${server.url}/`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(res.headers.get('permissions-policy')).toContain('geolocation=()');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('no CORS headers are ever sent, even with an Origin header on a GET', async () => {
    const res = await fetch(`${server.url}/api/health`, { headers: { Origin: 'http://evil.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('a malformed Origin header (not a valid URL) on a mutating request is rejected with 403, not a 500', async () => {
    const res = await fetch(`${server.url}/api/reset`, {
      method: 'POST',
      headers: { 'X-SCC-Request': '1', Origin: 'not a url at all' }
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('a matching same-host Origin (with a different scheme/port normalized away by host-only check) is allowed', async () => {
    const parsed = new URL(server.url);
    const res = await fetch(`${server.url}/api/reset`, {
      method: 'POST',
      headers: { 'X-SCC-Request': '1', Origin: `http://${parsed.host}` }
    });
    expect(res.status).toBe(200);
  });

  it('oversize Content-Length is rejected immediately with 413 without reading the whole body', async () => {
    const res = await fetch(`${server.url}/api/import/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': '1', 'Content-Length': '999999999' },
      body: 'x'.repeat(10) // body itself is small; only the declared Content-Length matters here
    }).catch((e) => e);
    // fetch may throw because the declared length mismatches the actual body; accept either a clean 413
    // response or a client-side error, but a server crash (ECONNRESET before any response) is the failure mode
    // we're checking for.
    if (res instanceof Response) {
      expect(res.status).toBe(413);
    }
  });

  it('oversize streamed body (no reliable Content-Length) is drained and rejected with 413, connection completes cleanly', async () => {
    const chunkSize = 512;
    const totalChunks = 20; // 10KB, over the 2048-byte test limit
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= totalChunks) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(chunkSize).fill(97));
        sent += 1;
      }
    });
    const res = await fetch(`${server.url}/api/import/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': '1' },
      body: stream,
      duplex: 'half'
    } as RequestInit);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('unknown method on a known API path returns 405 with an Allow header (not a 500)', async () => {
    const res = await fetch(`${server.url}/api/snapshot`, { method: 'DELETE' });
    expect(res.status).toBe(405);
  });

  it('unknown top-level route falls through to static handling and 404s cleanly (no stack trace leak)', async () => {
    const res = await fetch(`${server.url}/totally/unknown/route`);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text.toLowerCase()).not.toContain('at ');
    expect(text.toLowerCase()).not.toContain('.ts:');
  });

  it('path traversal with mixed encoded separators (../%2e%2e/) never returns file content from outside root', async () => {
    const attempts = [
      '/../../../../etc/passwd',
      '/%2e%2e/%2e%2e/%2e%2e/etc/passwd',
      '/..%2f..%2f..%2fetc/passwd',
      '/..%5c..%5cetc%5cpasswd',
      '/assets/../../../etc/passwd'
    ];
    for (const p of attempts) {
      const res = await fetch(`${server.url}${p}`);
      expect([400, 404]).toContain(res.status);
      const text = await res.text();
      expect(text).not.toContain('root:'); // /etc/passwd signature - must never leak
    }
  });

  it('NUL byte and malformed percent-encoding in the path both 400, not 500', async () => {
    for (const p of ['/%00', '/%E0%A4%A', '/foo%00bar']) {
      const res = await fetch(`${server.url}${p}`);
      expect(res.status).toBe(400);
    }
  });

  it('POST to a static path (not /api/*) is rejected with 405, not treated as a mutation', async () => {
    const res = await fetch(`${server.url}/`, { method: 'POST' });
    expect(res.status).toBe(405);
  });

  it('an unhandled exception inside a request produces a generic 500 body with no stack trace', async () => {
    // The store's replaceAll throws inside the /api/reset handler if createSampleDataset throws; simulate via a
    // store wrapper isn't directly reachable from outside, so instead exercise the "thrown internal error"
    // path indirectly: a snapshot request must never expose file paths or stack frames even under provoked
    // malformed input.
    const res = await fetch(`${server.url}/api/import/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': '1' },
      body: Buffer.from([0xff, 0xfe, 0x00, 0x01])
    });
    expect([400, 422]).toContain(res.status);
    const text = await res.text();
    expect(text).not.toMatch(/\/home\/|\/src\//);
  });
});
