import { describe, it, expect, afterEach, vi } from 'vitest';
import { ApiError, createHttpApiClient } from '../../../src/client/api/apiClient';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiClient.undoImport', () => {
  it('posts to /api/undo with the request header and the version of the import', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await createHttpApiClient().undoImport(42);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/undo');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'X-SCC-Request': '1', 'X-SCC-Undo-Version': '42' });
  });

  it('turns a stale undo into an ApiError with the server message', async () => {
    const body = { ok: false, error: { code: 'UNDO_STALE', message: 'This import can no longer be undone: the data changed after it. Use Restore sample data to start over.' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 409 })));
    const err = await createHttpApiClient().undoImport(7).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'UNDO_STALE', message: body.error.message });
  });
});
