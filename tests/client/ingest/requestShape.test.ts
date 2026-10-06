// Criterion 44: the default path's request shape is pinned. Uploading a file (directly, with a confirmed column map, or a
// canonical CSV produced by the pipeline) sends exactly the V1 request: same endpoint, same method, same three headers
// (plus the optional map header), the raw text/csv body, nothing new. The client file is not edited by this work.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpApiClient } from '../../../src/client/api/apiClient';

interface Call {
  url: string;
  init: RequestInit;
}

function stubFetch(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true, kind: 'inventory', rowCount: 1, warnings: [], dataSource: { kind: 'import', label: 'x.csv', loadedAt: '2026-06-15T00:00:00.000Z', rowCount: 1 } }), { status: 200 });
    })
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('default-path request shape (criterion 44)', () => {
  it('a plain upload sends exactly the V1 request', async () => {
    const calls = stubFetch();
    const file = new File(['sku,qty\nA,1\n'], 'my file.csv', { type: 'text/csv' });
    await createHttpApiClient().importCsv('inventory', file);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/import/inventory');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers).toEqual({ 'Content-Type': 'text/csv; charset=utf-8', 'X-SCC-Request': '1', 'X-SCC-Filename': encodeURIComponent('my file.csv') });
    expect(calls[0]?.init.body).toBe(file);
    expect(Object.keys(calls[0]?.init ?? {}).sort()).toEqual(['body', 'headers', 'method']);
  });

  it('a confirmed column map adds only the X-SCC-Column-Map header (V1.5)', async () => {
    const calls = stubFetch();
    const file = new File(['a,b\n1,2\n'], 'alt.csv');
    await createHttpApiClient().importCsv('shipments', file, ['shipment_id', null, 'status']);
    expect(calls[0]?.url).toBe('/api/import/shipments');
    expect(calls[0]?.init.headers).toEqual({ 'Content-Type': 'text/csv; charset=utf-8', 'X-SCC-Request': '1', 'X-SCC-Filename': 'alt.csv', 'X-SCC-Column-Map': 'shipment_id,,status' });
  });

  it('the pipeline\'s canonical file goes through the same two-argument call with the ORIGINAL file name as the data-source label', async () => {
    const calls = stubFetch();
    const canonical = new File(['sku,product_name\nA,B\n'], 'Alder Q3 export.xlsx', { type: 'text/csv' });
    await createHttpApiClient().importCsv('inventory', canonical);
    expect(calls[0]?.init.headers).toEqual({ 'Content-Type': 'text/csv; charset=utf-8', 'X-SCC-Request': '1', 'X-SCC-Filename': encodeURIComponent('Alder Q3 export.xlsx') });
    expect((calls[0]?.init.headers as Record<string, string>)['X-SCC-Column-Map']).toBeUndefined();
  });

  it('no new endpoint is used: only the two per-kind import URLs, the snapshot and the reset exist on the client', async () => {
    const calls = stubFetch();
    const client = createHttpApiClient();
    await client.importCsv('inventory', new File(['x'], 'a.csv'));
    await client.importCsv('shipments', new File(['x'], 'b.csv'));
    expect(calls.map((c) => c.url)).toEqual(['/api/import/inventory', '/api/import/shipments']);
    expect(Object.keys(client).sort()).toEqual(['getSnapshot', 'importCsv', 'resetSampleData']);
  });
});
