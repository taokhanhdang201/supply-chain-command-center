import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHttpApiClient } from '../../../src/client/api/apiClient';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: true, kind: 'inventory', rowCount: 1, warnings: [], dataSource: {} }), { status: 200 })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('apiClient.importCsv', () => {
  it('sends the raw file and no column-map header when no map is given', async () => {
    const fetchMock = stubFetch();
    const file = new File(['sku\n1\n'], 'a b.csv', { type: 'text/csv' });
    await createHttpApiClient().importCsv('inventory', file);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/import/inventory');
    expect(init.body).toBe(file);
    expect(init.headers).toEqual({
      'Content-Type': 'text/csv; charset=utf-8',
      'X-SCC-Request': '1',
      'X-SCC-Filename': 'a%20b.csv'
    });
  });

  it('adds X-SCC-Column-Map when a map is given, still sending the unchanged file', async () => {
    const fetchMock = stubFetch();
    const file = new File(['a,b,c\n1,2,3\n'], 'a.csv', { type: 'text/csv' });
    await createHttpApiClient().importCsv('inventory', file, ['sku', null, 'warehouse']);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-SCC-Column-Map']).toBe('sku,,warehouse');
    expect((init.headers as Record<string, string>)['X-SCC-Request']).toBe('1');
    expect(init.body).toBe(file);
  });
});
