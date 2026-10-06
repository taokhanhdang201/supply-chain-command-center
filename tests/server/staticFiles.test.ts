import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStaticHandler } from '../../src/server/staticFiles';

let root: string;
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'scc-static-'));
  await fs.writeFile(path.join(root, 'index.html'), '<html>root</html>');
  await fs.mkdir(path.join(root, 'assets'));
  await fs.writeFile(path.join(root, 'assets', 'app.js'), 'console.log(1);');
  await fs.mkdir(path.join(root, 'sub'));
  await fs.writeFile(path.join(root, 'sub', 'file.txt'), 'hello');

  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scc-outside-'));
  await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'top secret');

  const handler = createStaticHandler(root);
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    void handler(req, res, url.pathname);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('static file handler', () => {
  it('serves index.html at /', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toBe('<html>root</html>');
  });

  it('serves assets with an immutable cache header', async () => {
    const res = await fetch(`${baseUrl}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('serves other files with no-cache', async () => {
    const res = await fetch(`${baseUrl}/sub/file.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('returns 404 for missing files', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist.txt`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for a directory path', async () => {
    const res = await fetch(`${baseUrl}/sub`);
    expect(res.status).toBe(404);
  });

  it('returns 405 for POST', async () => {
    const res = await fetch(`${baseUrl}/`, { method: 'POST' });
    expect(res.status).toBe(405);
  });

  it('rejects traversal with ../ segments', async () => {
    const res = await fetch(`${baseUrl}/../package.json`);
    expect([400, 404]).toContain(res.status);
  });

  it('rejects encoded traversal (%2e%2e)', async () => {
    const res = await fetch(`${baseUrl}/%2e%2e/%2e%2e/etc/passwd`);
    expect(res.status).toBe(404);
  });

  it('rejects backslash traversal attempts', async () => {
    const res = await fetch(`${baseUrl}/..%5c..%5cwindows`);
    expect(res.status).toBe(400);
  });

  it('rejects NUL bytes in the path', async () => {
    const res = await fetch(`${baseUrl}/%00`);
    expect(res.status).toBe(400);
  });

  it('rejects malformed percent-encoding', async () => {
    const res = await fetch(`${baseUrl}/%E0%A4%A`);
    expect(res.status).toBe(400);
  });
});
