// Criterion 34 (and the static part of 36): no new dependency (package.json, package-lock.json and tsconfig.json identical to
// the base commit 167cc52), http.ts identical to the base commit (CSP and headers), no eval / new Function /
// dangerouslySetInnerHTML / WebAssembly / HTML sinks in the ingestion code, no new network access, no blob: or data:
// workers, nothing logged, and the worker script response carries the existing security headers. The scanners are pure
// functions, so a block below proves they bite on simulated code.

import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createAppServer } from '../../../src/server/app';
import { createStaticHandler } from '../../../src/server/staticFiles';
import { ROOT, listSource, normalizeEol } from '../../ingest-kit/guards';
import { baseConfig } from '../../ingest-kit/serverHarness';

const BASE = '167cc52';

function baseFile(path: string): string | null {
  try {
    execFileSync('git', ['rev-parse', '--verify', `${BASE}^{commit}`], { stdio: 'pipe', cwd: ROOT });
    return execFileSync('git', ['show', `${BASE}:${path}`], { encoding: 'utf8', stdio: 'pipe', cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null; // no git or no base commit in this environment
  }
}

describe('no new dependency, security code unchanged (versus the base commit)', () => {
  for (const file of ['package.json', 'package-lock.json', 'tsconfig.json', 'src/server/http.ts']) {
    it(`${file} is identical to ${BASE} (skipped only when the commit is absent)`, () => {
      const base = baseFile(file);
      if (base === null) return;
      expect(normalizeEol(readFileSync(join(ROOT, file), 'utf8'))).toBe(normalizeEol(base));
    });
  }

  it('package.json lists exactly the runtime and dev dependencies it listed at the base', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['@fontsource-variable/archivo', '@fontsource-variable/inter', 'react', 'react-dom']);
    // no parser, spreadsheet, compression or schema library was added for ingestion
    for (const name of [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)]) expect(name).not.toMatch(/xlsx|exceljs|sheetjs|papaparse|csv-parse|pako|fflate|jszip|zod|iconv/i);
  });
});

// ---- scanners -----------------------------------------------------------------------------------------------------

/** Removes comments so a sentence like "no eval" in a comment is not reported; strings are kept (a string can hold code). */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

const FORBIDDEN: Array<{ name: string; pattern: RegExp }> = [
  { name: 'eval', pattern: /\beval\s*\(/ },
  { name: 'new Function', pattern: /\bnew\s+Function\b|\bFunction\s*\(\s*['"`]/ },
  { name: 'setTimeout/setInterval with a string', pattern: /\bset(?:Timeout|Interval)\s*\(\s*['"`]/ },
  { name: 'dangerouslySetInnerHTML', pattern: /dangerouslySetInnerHTML/ },
  { name: 'innerHTML / outerHTML / insertAdjacentHTML / document.write', pattern: /\.(?:innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write/ },
  { name: 'WebAssembly', pattern: /\bWebAssembly\b/ },
  { name: 'importScripts call', pattern: /\bimportScripts\s*\(/ },
  { name: 'blob: or data: worker / object URL', pattern: /createObjectURL|new\s+Blob\s*\(\s*\[[^\]]*\]\s*,\s*\{\s*type:\s*['"]text\/javascript|['"`]blob:|worker[^;\n]*['"`]data:/i }
];

const NETWORK: Array<{ name: string; pattern: RegExp }> = [
  { name: 'fetch', pattern: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { name: 'WebSocket', pattern: /\bWebSocket\b/ },
  { name: 'EventSource', pattern: /\bEventSource\b/ },
  { name: 'sendBeacon', pattern: /\bsendBeacon\b/ },
  { name: 'http(s) URL literal', pattern: /['"`]https?:\/\//}
];

const CONSOLE = /\bconsole\s*\.\s*\w+/;

export function scan(source: string, rules: Array<{ name: string; pattern: RegExp }>): string[] {
  const text = stripComments(source);
  return rules.filter((r) => r.pattern.test(text)).map((r) => r.name);
}

const INGEST_DIRS = ['src/shared/ingest', 'src/client/ingest', 'src/client/components/import'];
const ingestFiles = [...listSource(INGEST_DIRS), 'src/client/pages/ImportPage.tsx', 'src/server/ingestLimits.ts'];

describe('the ingestion code uses no dangerous construct, makes no network call and logs nothing', () => {
  it('scans a real set of files', () => {
    expect(ingestFiles.length).toBeGreaterThan(50);
  });

  it('no eval, new Function, dangerouslySetInnerHTML, HTML sink, WebAssembly, importScripts call or blob/data worker', () => {
    const found = ingestFiles.map((f) => [f, scan(readFileSync(join(ROOT, f), 'utf8'), FORBIDDEN)] as const).filter(([, hits]) => hits.length > 0);
    expect(found).toEqual([]);
  });

  it('no network access at all (the pipeline reads the file in the browser; only the existing api client talks to the server)', () => {
    const found = ingestFiles.map((f) => [f, scan(readFileSync(join(ROOT, f), 'utf8'), NETWORK)] as const).filter(([, hits]) => hits.length > 0);
    expect(found).toEqual([]);
  });

  it('nothing is logged: no console call in the ingestion code (criterion 36, static)', () => {
    const found = ingestFiles.filter((f) => f !== 'src/server/ingestLimits.ts' && CONSOLE.test(stripComments(readFileSync(join(ROOT, f), 'utf8'))));
    expect(found).toEqual([]);
  });

  it('the only Worker is the same-origin module worker file built by Vite', () => {
    const uses = ingestFiles.filter((f) => /\bnew\s+Worker\s*\(/.test(stripComments(readFileSync(join(ROOT, f), 'utf8'))));
    expect(uses).toEqual(['src/client/ingest/runner.ts']);
    const runner = readFileSync(join(ROOT, 'src/client/ingest/runner.ts'), 'utf8');
    expect(runner).toContain("new Worker(new URL('./ingest.worker.ts', import.meta.url), { type: 'module' })");
    expect(readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')).toContain("worker: { format: 'es' }");
  });

  it('the only server-side console output of this work is the startup warning and error in index.ts', () => {
    const index = stripComments(readFileSync(join(ROOT, 'src/server/index.ts'), 'utf8'));
    const lines = index.split('\n').filter((l) => CONSOLE.test(l));
    expect(lines.some((l) => /ingestLimits|warning/.test(l))).toBe(true);
    expect(CONSOLE.test(stripComments(readFileSync(join(ROOT, 'src/server/ingestLimits.ts'), 'utf8')))).toBe(false);
  });
});

describe('the scanners bite (simulated code)', () => {
  const hit = (code: string, rules = FORBIDDEN): string[] => scan(code, rules);
  it('flags each forbidden construct', () => {
    expect(hit('const x = eval(text);')).toEqual(['eval']);
    expect(hit('const f = new Function("return 1");')).toContain('new Function');
    expect(hit('setTimeout("alert(1)", 5);')).toContain('setTimeout/setInterval with a string');
    expect(hit('<div dangerouslySetInnerHTML={{ __html: v }} />')).toEqual(['dangerouslySetInnerHTML']);
    expect(hit('el.innerHTML = v;')).toHaveLength(1);
    expect(hit('document.write(v);')).toHaveLength(1);
    expect(hit('WebAssembly.instantiate(b);')).toEqual(['WebAssembly']);
    expect(hit('importScripts("x.js");')).toEqual(['importScripts call']);
    expect(hit('const u = URL.createObjectURL(blob); new Worker(u);')).toHaveLength(1);
    expect(hit('new Worker("blob:abc")')).toHaveLength(1);
  });

  it('flags network access and console use, and ignores words in comments', () => {
    expect(hit('await fetch("/api");', NETWORK)).toEqual(['fetch']);
    expect(hit('new XMLHttpRequest();', NETWORK)).toEqual(['XMLHttpRequest']);
    expect(hit('const u = "https://example.com/x";', NETWORK)).toEqual(['http(s) URL literal']);
    expect(CONSOLE.test('console.log(cell)')).toBe(true);
    expect(hit('// we never call eval( here\n/* new Function */ const a = 1;')).toEqual([]);
    expect(hit('const ok = 1; // fetch( is mentioned in a comment', NETWORK)).toEqual([]);
  });
});

describe('the worker script is served with the existing security headers', () => {
  let root: string;
  let server: ReturnType<typeof createAppServer>;
  let url: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'scc-worker-'));
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'assets', 'ingest.worker-abc123.js'), 'self.onmessage = () => undefined;');
    writeFileSync(join(root, 'index.html'), '<html></html>');
    const staticHandler = createStaticHandler(root);
    server = createAppServer({
      config: baseConfig({ mode: 'production' }),
      api: async () => undefined,
      fallback: (req, res, pathname) => staticHandler(req, res, pathname)
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  });

  const expectHeaders = (res: Response): void => {
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/javascript/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    const csp = res.headers.get('content-security-policy') ?? '';
    // same-origin scripts only: a same-origin module worker is allowed, blob: and data: workers are not
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toMatch(/blob:|unsafe-eval|unsafe-inline|worker-src/);
  };

  it('a worker asset served from the static root carries the headers and the CSP', async () => {
    expectHeaders(await fetch(`${url}/assets/ingest.worker-abc123.js`));
  });

  it('the real built worker asset (when a build exists) is served the same way', async () => {
    const dist = join(ROOT, 'dist/client/assets');
    if (!existsSync(dist)) return;
    const { readdirSync } = await import('node:fs');
    const name = readdirSync(dist).find((n) => /^ingest\.worker-.*\.js$/.test(n));
    if (name === undefined) return;
    const staticHandler = createStaticHandler(join(ROOT, 'dist/client'));
    const real = createAppServer({ config: baseConfig({ mode: 'production' }), api: async () => undefined, fallback: (req, res, p) => staticHandler(req, res, p) });
    await new Promise<void>((resolve) => real.listen(0, '127.0.0.1', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${(real.address() as AddressInfo).port}/assets/${name}`);
      expectHeaders(res);
      // Read the body: the real worker (~150 KB) does not fit in one write, so an unread response keeps the connection
      // active and server.close() below waits on it forever.
      await res.arrayBuffer();
    } finally {
      await new Promise<void>((resolve) => real.close(() => resolve()));
    }
  });
});
