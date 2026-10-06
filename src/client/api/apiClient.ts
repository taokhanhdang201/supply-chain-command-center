// HTTP client for the SCC API (plan §8.7). The only write paths are raw CSV upload (optionally with a column-map
// header, V1.5) and "reset to sample data"; the client never sends structured data rows as JSON.

import type { ImportIssue, ImportKind, DataSourceInfo, Snapshot } from '../../shared/types';
import type { ColumnMap } from '../../shared/csv/importCommon';
import { serializeColumnMap } from '../../shared/mapping/columnMapHeader';

export class ApiError extends Error {
  status: number;
  code: string;
  issues: ImportIssue[];
  totalErrors: number;

  constructor(status: number, code: string, message: string, issues: ImportIssue[] = [], totalErrors = 0) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
    this.totalErrors = totalErrors;
  }
}

export interface ImportSuccess {
  ok: true;
  kind: ImportKind;
  rowCount: number;
  warnings: string[];
  dataSource: DataSourceInfo;
}

export interface ApiClient {
  getSnapshot(signal?: AbortSignal): Promise<Snapshot>;
  importCsv(kind: ImportKind, file: File, columnMap?: ColumnMap): Promise<ImportSuccess>;
  resetSampleData(): Promise<void>;
}

function isSnapshotShape(value: unknown): value is Snapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.today === 'string' &&
    Array.isArray(v.inventory) &&
    Array.isArray(v.shipments) &&
    Array.isArray(v.alerts) &&
    typeof v.kpis === 'object' &&
    v.kpis !== null
  );
}

async function parseErrorResponse(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    return new ApiError(res.status, 'BAD_RESPONSE', 'The server returned an unexpected response.');
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const errorField = (b.error ?? {}) as Record<string, unknown>;
  const code = typeof errorField.code === 'string' ? errorField.code : 'BAD_RESPONSE';
  const message = typeof errorField.message === 'string' ? errorField.message : 'The server returned an unexpected response.';
  const issues = Array.isArray(b.errors) ? (b.errors as ImportIssue[]) : [];
  const totalErrors = typeof b.totalErrors === 'number' ? b.totalErrors : 0;
  return new ApiError(res.status, code, message, issues, totalErrors);
}

async function doFetch(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check that it is running and try again.');
  }
}

/** Creates the HTTP-backed `ApiClient` used by the real app (tests use a fake implementation instead). */
export function createHttpApiClient(baseUrl = ''): ApiClient {
  return {
    async getSnapshot(signal?: AbortSignal): Promise<Snapshot> {
      const res = await doFetch(`${baseUrl}/api/snapshot`, { signal });
      if (!res.ok) throw await parseErrorResponse(res);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new ApiError(res.status, 'BAD_RESPONSE', 'The server returned an unexpected response.');
      }
      if (!isSnapshotShape(body)) {
        throw new ApiError(res.status, 'BAD_RESPONSE', 'The server returned an unexpected response.');
      }
      return body;
    },

    async importCsv(kind: ImportKind, file: File, columnMap?: ColumnMap): Promise<ImportSuccess> {
      const headers: Record<string, string> = {
        'Content-Type': 'text/csv; charset=utf-8',
        'X-SCC-Request': '1',
        'X-SCC-Filename': encodeURIComponent(file.name)
      };
      if (columnMap !== undefined) headers['X-SCC-Column-Map'] = serializeColumnMap(columnMap);
      const res = await doFetch(`${baseUrl}/api/import/${kind}`, { method: 'POST', headers, body: file });
      if (!res.ok) throw await parseErrorResponse(res);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new ApiError(res.status, 'BAD_RESPONSE', 'The server returned an unexpected response.');
      }
      return body as ImportSuccess;
    },

    async resetSampleData(): Promise<void> {
      const res = await doFetch(`${baseUrl}/api/reset`, {
        method: 'POST',
        headers: { 'X-SCC-Request': '1' }
      });
      if (!res.ok) throw await parseErrorResponse(res);
    }
  };
}
