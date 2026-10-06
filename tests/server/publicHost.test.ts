// A hosted demo (Render) is reached as https://<name>.onrender.com: the proxy forwards that hostname, without a port,
// as `Host`. SCC_PUBLIC_HOST (else Render's RENDER_EXTERNAL_HOSTNAME) adds exactly that one hostname to the R-11 Host
// allowlist; every other Host is still rejected, and locally (unset) nothing changes.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConfigError, loadConfig, type AppConfig } from '../../src/server/config';
import { assertAllowedHost, HttpError } from '../../src/server/http';
import { createAppServer } from '../../src/server/app';
import { createApiHandler } from '../../src/server/api';
import { createDataStore } from '../../src/server/store';
import { createSampleDataset } from '../../src/shared/sample/generateSampleData';

const PUBLIC = 'scc-demo.onrender.com';
const TODAY = '2026-09-28';

function makeReq(headers: Record<string, string | undefined>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe('loadConfig: public host', () => {
  it('is unset by default', () => {
    expect(loadConfig({}, []).publicHost).toBeUndefined();
  });

  it('reads SCC_PUBLIC_HOST, trimmed and lower-cased', () => {
    expect(loadConfig({ SCC_PUBLIC_HOST: ' SCC-Demo.OnRender.com ' }, []).publicHost).toBe(PUBLIC);
  });

  it("falls back to Render's RENDER_EXTERNAL_HOSTNAME, and SCC_PUBLIC_HOST wins when both are set", () => {
    expect(loadConfig({ RENDER_EXTERNAL_HOSTNAME: PUBLIC }, []).publicHost).toBe(PUBLIC);
    expect(loadConfig({ SCC_PUBLIC_HOST: 'scc.example.com', RENDER_EXTERNAL_HOSTNAME: PUBLIC }, []).publicHost).toBe('scc.example.com');
  });

  it('rejects anything but a bare hostname, naming the variable', () => {
    for (const bad of ['https://scc-demo.onrender.com', 'scc-demo.onrender.com:443', 'scc-demo.onrender.com/path', 'localhost', 'scc demo.onrender.com']) {
      expect(() => loadConfig({ SCC_PUBLIC_HOST: bad }, []), bad).toThrow(ConfigError);
    }
    expect(() => loadConfig({ RENDER_EXTERNAL_HOSTNAME: 'a b' }, [])).toThrow(/RENDER_EXTERNAL_HOSTNAME/);
  });
});

describe('assertAllowedHost: public host', () => {
  const config = { host: '0.0.0.0', port: 10000, publicHost: PUBLIC };

  it('accepts exactly the public host', () => {
    expect(() => assertAllowedHost(makeReq({ host: PUBLIC }), config)).not.toThrow();
    expect(() => assertAllowedHost(makeReq({ host: 'localhost:10000' }), config)).not.toThrow();
  });

  it('still rejects look-alikes and every other Host', () => {
    for (const host of [`${PUBLIC}:10000`, `evil-${PUBLIC}`, `${PUBLIC}.evil.example`, 'evil.example', 'SCC-DEMO.ONRENDER.COM']) {
      expect(() => assertAllowedHost(makeReq({ host }), config), host).toThrow(HttpError);
    }
  });

  it('accepts no bare hostname when no public host is configured', () => {
    expect(() => assertAllowedHost(makeReq({ host: PUBLIC }), { host: '0.0.0.0', port: 10000 })).toThrow(HttpError);
  });
});

describe('real HTTP server with a public host', () => {
  let port: number;
  let server: http.Server;

  beforeAll(async () => {
    const config: AppConfig = { port: 0, host: '127.0.0.1', seed: 42, todayOverride: TODAY, maxUploadBytes: 2_097_152, mode: 'test', publicHost: PUBLIC };
    const build = () => createSampleDataset(config.seed, TODAY, '2026-09-28T00:00:00.000Z');
    const api = createApiHandler({ config, store: createDataStore(build()), getToday: () => TODAY, createSampleDataset: build, now: () => new Date('2026-09-28T12:00:00.000Z') });
    server = createAppServer({ config, api });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const send = (method: string, path: string, headers: Record<string, string>): Promise<number> =>
    new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, method, path, headers }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      });
      req.on('error', reject);
      req.end();
    });

  it('serves the public host and rejects a foreign one', async () => {
    expect(await send('GET', '/api/health', { Host: PUBLIC })).toBe(200);
    expect(await send('GET', '/api/health', { Host: 'evil.example' })).toBe(421);
  });

  it('a same-origin reset from the public site passes; another origin is refused', async () => {
    expect(await send('POST', '/api/reset', { Host: PUBLIC, Origin: `https://${PUBLIC}`, 'X-SCC-Request': '1' })).toBe(200);
    expect(await send('POST', '/api/reset', { Host: PUBLIC, Origin: 'https://evil.example', 'X-SCC-Request': '1' })).toBe(403);
  });
});
