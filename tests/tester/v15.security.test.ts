// V1.5 tester: the existing security protections still hold on the mapped-import path (§15.11, §17).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { INV_ALT, INV_FIELDS, post, rawPost, rawRequest, startServer, statusOf, type TestServer } from './v15.helpers';

let srv: TestServer;
beforeAll(async () => { srv = await startServer({ maxUploadBytes: 4096 }); });
afterAll(async () => { await srv.close(); });

const MAP = 'X-SCC-Column-Map';
const good = INV_FIELDS.join(',');
const H = { [MAP]: good };

describe('V1.5 security regressions on the mapped path', () => {
  it('CSRF marker: no X-SCC-Request -> 403 even with a valid map and even with an invalid map (auth before parsing)', async () => {
    for (const map of [good, '__proto__']) {
      const res = await fetch(`${srv.url}/api/import/inventory`, { method: 'POST', headers: { 'Content-Type': 'text/csv', [MAP]: map }, body: INV_ALT });
      expect(res.status).toBe(403);
    }
    const wrong = await fetch(`${srv.url}/api/import/inventory`, { method: 'POST', headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': 'true', [MAP]: good }, body: INV_ALT });
    expect(wrong.status).toBe(403);
    expect(srv.store.getVersion()).toBe(0);
  });

  it('Origin: a foreign Origin is 403, a same-origin Origin is fine; a null/garbage Origin is 403', async () => {
    const send = (origin: string) =>
      new Promise<number>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: srv.port, path: '/api/import/inventory', method: 'POST', headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': '1', Origin: origin, [MAP]: good } }, (r) => { r.resume(); resolve(r.statusCode ?? 0); });
        req.on('error', reject); req.end(INV_ALT);
      });
    expect(await send('http://evil.example')).toBe(403);
    expect(await send('null')).toBe(403);
    expect(await send('not a url')).toBe(403);
    expect(await send(`http://127.0.0.1:${srv.port}`)).toBe(200);
  });

  it('Host allowlist (DNS rebinding): a foreign Host is 421 for a mapped import, and nothing is imported', async () => {
    const before = srv.store.getVersion();
    const raw = await rawPost(srv.port, 'inventory', `${MAP}: ${good}\r\n`, INV_ALT, { host: 'evil.example' });
    expect(statusOf(raw)).toBe(421);
    const raw2 = await rawPost(srv.port, 'inventory', `${MAP}: ${good}\r\n`, INV_ALT, { host: `attacker.test:${srv.port}` });
    expect(statusOf(raw2)).toBe(421);
    expect(srv.store.getVersion()).toBe(before);
  });

  it('Content-Type: non-CSV is 415 with a valid map, and 415 wins over a bad map', async () => {
    for (const ct of ['application/json', 'text/plain', 'multipart/form-data; boundary=x', 'text/html']) {
      for (const map of [good, '__proto__']) {
        const res = await fetch(`${srv.url}/api/import/inventory`, { method: 'POST', headers: { 'Content-Type': ct, 'X-SCC-Request': '1', [MAP]: map }, body: INV_ALT });
        expect(res.status).toBe(415);
      }
    }
  });

  it('size limit: oversize body with a map is 413 (Content-Length) and 413 when streamed chunked; the store is untouched', async () => {
    const before = srv.store.getVersion();
    const big = INV_ALT + 'A-1,P,C,WH-DFW,1,1,1.00,1,1\n'.repeat(400); // > 4096 bytes
    expect(Buffer.byteLength(big)).toBeGreaterThan(4096);
    const res = await post(srv, 'inventory', big, H);
    expect(res.status).toBe(413);
    const chunked = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: srv.port, path: '/api/import/inventory', method: 'POST', headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': '1', 'Transfer-Encoding': 'chunked', [MAP]: good } }, (r) => { r.resume(); resolve(r.statusCode ?? 0); });
      req.on('error', reject);
      for (let i = 0; i < 5; i++) req.write(big.slice(i * 1000, (i + 1) * 1000));
      req.end(big.slice(5000));
    });
    expect(chunked).toBe(413);
    expect(srv.store.getVersion()).toBe(before);
  });

  it('exactly at the limit is accepted, one byte over is not (limit semantics unchanged by the map)', async () => {
    const line = 'A-1,P,C,WH-DFW,1,1,1.00,1,1\n';
    const head = INV_ALT.split('\n')[0]! + '\n';
    let body = head; let i = 0;
    while (Buffer.byteLength(body + line) <= 4096) { body += line.replace('A-1', `A-${1000 + i++}`); }
    const pad = 4096 - Buffer.byteLength(body);
    const fit = body + ' '.repeat(pad); // trailing spaces after the last newline: still one blank-ish line
    expect(Buffer.byteLength(fit)).toBe(4096);
    const over = await post(srv, 'inventory', fit + ' ', H);
    expect(over.status).toBe(413);
    const ok = await post(srv, 'inventory', body, H);
    expect(ok.status).toBe(200);
  });

  it('invalid UTF-8: rejected 400 INVALID_ENCODING with a map, including when the bad bytes sit in an ignored column', async () => {
    const before = srv.store.getVersion();
    const bad = Buffer.concat([Buffer.from(INV_ALT.split('\n')[0] + ',Notes\nA-1,P,C,WH-DFW,1,1,1.00,1,1,'), Buffer.from([0xff, 0xfe, 0xc0, 0x80]), Buffer.from('\n')]);
    const res = await post(srv, 'inventory', bad, { [MAP]: good + ',' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_ENCODING');
    const overlong = Buffer.concat([Buffer.from(INV_ALT.split('\n')[0] + '\nA-1,'), Buffer.from([0xc0, 0xaf]), Buffer.from(',C,WH-DFW,1,1,1.00,1,1\n')]);
    const r2 = await post(srv, 'inventory', overlong, H);
    expect(r2.status).toBe(400);
    expect(srv.store.getVersion()).toBe(before);
  });

  it('empty and whitespace-only bodies with a map are 400 EMPTY_FILE', async () => {
    for (const b of ['', '   \n\n  ', '﻿']) {
      const res = await post(srv, 'inventory', b, H);
      expect(res.status).toBe(400);
    }
  });

  it('security headers (nosniff, CSP, frame, referrer, no-store) are present on 200, 400, 403, 413, 415 and 422 mapped-import responses', async () => {
    const big = 'x'.repeat(5000);
    const cases: Promise<Response>[] = [
      post(srv, 'inventory', INV_ALT, H),
      post(srv, 'inventory', INV_ALT, { [MAP]: '__proto__' }),
      fetch(`${srv.url}/api/import/inventory`, { method: 'POST', headers: { 'Content-Type': 'text/csv', [MAP]: good }, body: INV_ALT }),
      post(srv, 'inventory', big, H),
      fetch(`${srv.url}/api/import/inventory`, { method: 'POST', headers: { 'Content-Type': 'text/html', 'X-SCC-Request': '1', [MAP]: good }, body: INV_ALT }),
      post(srv, 'inventory', INV_ALT, { [MAP]: 'sku' })
    ];
    const statuses: number[] = [];
    for (const r of await Promise.all(cases)) {
      statuses.push(r.status);
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
      expect(r.headers.get('x-frame-options')).toBe('DENY');
      expect(r.headers.get('referrer-policy')).toBe('no-referrer');
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(r.headers.get('content-type')).toContain('application/json');
    }
    expect(statuses).toEqual([200, 400, 403, 413, 415, 422]);
  });

  it('the map header value is never reflected in any response body or header', async () => {
    const marker = 'zzreflectmarkerzz';
    const res = await post(srv, 'inventory', INV_ALT, { [MAP]: marker });
    const text = await res.text();
    expect(text).not.toContain(marker);
    for (const [, v] of res.headers) expect(v).not.toContain(marker);
  });

  it('path traversal / odd paths on the import route still 404 or 405, never import', async () => {
    const before = srv.store.getVersion();
    // raw request line: fetch() would normalize the dot segments itself, so bypass it
    for (const p of ['/api/import/inventory/', '/api/import/%2e%2e/inventory', '/api/import/inventory%00', '/api/import/INVENTORY', '/api/import/../../etc/passwd', '/api/import/inventory/..%2f..%2fx']) {
      const body = INV_ALT;
      const raw = await rawRequest(srv.port, `POST ${p} HTTP/1.1\r\nHost: 127.0.0.1:${srv.port}\r\nContent-Type: text/csv\r\nX-SCC-Request: 1\r\n${MAP}: ${good}\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
      // note: `/api/import/../import/inventory` is normalized by `new URL()` to the real import route (V1 behaviour, same protections apply)
      expect([400, 404, 405], p).toContain(statusOf(raw));
    }
    expect(srv.store.getVersion()).toBe(before);
  });

  it('GET/PUT/DELETE on the import route with a map are 405', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const res = await fetch(`${srv.url}/api/import/inventory`, { method, headers: { 'X-SCC-Request': '1', [MAP]: good } });
      expect(res.status).toBe(405);
    }
  });

  it('a filename header cannot smuggle markup into the data-source label on a mapped import', async () => {
    const res = await post(srv, 'inventory', INV_ALT, { ...H, 'X-SCC-Filename': encodeURIComponent('<img src=x onerror=1>../../a.csv') });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.dataSource.label).toMatch(/^[A-Za-z0-9 ._-]+$/);
  });

  it('after every rejected attempt above the server still serves valid imports (no state leak between requests)', async () => {
    const res = await post(srv, 'inventory', INV_ALT, H);
    expect(res.status).toBe(200);
    const bad = await post(srv, 'inventory', INV_ALT, { [MAP]: good.replace('sku', 'product_name') });
    expect(bad.status).toBe(422);
    const again = await post(srv, 'inventory', INV_ALT, H);
    expect(again.status).toBe(200);
  });
});
