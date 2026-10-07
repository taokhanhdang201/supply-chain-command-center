// The application's JSON API (plan §6.4). Owns the 6 endpoints (one of them the one-step Undo), all request validation, and the snapshot cache
// keyed by (store version, today). The client is untrusted: every import is re-validated here in full.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppConfig } from './config';
import type { DataStore } from './store';
import type { DataSourceInfo, DayString, Dataset, ImportKind, Snapshot } from '../shared/types';
import { buildSnapshot } from '../shared/domain/snapshot';
import { importInventoryCsv } from '../shared/csv/importInventory';
import { importShipmentsCsv } from '../shared/csv/importShipments';
import type { ColumnMap } from '../shared/csv/importCommon';
import { COLUMN_MAP_HEADER, parseColumnMapHeader } from '../shared/mapping/columnMapHeader';
import { DEFAULT_INGEST_LIMITS, type IngestLimits } from './ingestLimits';
import { HttpError, assertSameOriginMutation, decodeUtf8Strict, readBody, sanitizeFilename, sendError, sendJson } from './http';

export interface ApiDeps {
  config: AppConfig;
  store: DataStore;
  getToday: () => DayString;
  /** Builds the sample dataset for `today` (default: the caller's own today). */
  createSampleDataset: (today?: DayString) => Dataset;
  /** The day the store's initial sample was built for (default: `getToday()` when the handler is created). */
  sampleDay?: DayString;
  now?: () => Date;
  /** Effective import limits (rows, columns); default = today's constants exactly. */
  ingestLimits?: IngestLimits;
}

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>;

const IMPORT_PREFIX = '/api/import/';

/** Creates the `/api/*` request handler. */
export function createApiHandler(deps: ApiDeps): Handler {
  const now = deps.now ?? (() => new Date());
  const ingestLimits = deps.ingestLimits ?? DEFAULT_INGEST_LIMITS;
  const importLimits = { maxRows: ingestLimits.maxRows, maxColumns: ingestLimits.maxColumns };

  let cachedVersion: number | null = null;
  let cachedToday: DayString | null = null;
  let cachedSnapshot: Snapshot | null = null;

  // The sample's dates are relative to the day it was built, so on the first API request of a new day (same
  // `getToday` as the snapshot) it is rebuilt for that day. Only while BOTH sources are still the sample: once
  // either was imported, neither is touched.
  let sampleDay = deps.sampleDay ?? deps.getToday();

  function refreshSampleForToday(): void {
    const today = deps.getToday();
    if (today === sampleDay) return;
    const { sources } = deps.store.getDataset();
    if (sources.inventory.kind !== 'sample' || sources.shipments.kind !== 'sample') return;
    deps.store.replaceAll(deps.createSampleDataset(today));
    sampleDay = today;
  }

  // One-step Undo: the dataset before the last import and the store version right after it. Undo only works while nothing
  // changed since (another import, a restore, the daily sample refresh), so one visitor never undoes another's change.
  let undoEntry: { previous: Dataset; version: number } | null = null;

  function undoLastImport(req: IncomingMessage): void {
    const raw = req.headers['x-scc-undo-version'];
    const version = typeof raw === 'string' && /^\d{1,15}$/.test(raw) ? Number(raw) : null;
    if (version === null) throw new HttpError(400, 'INVALID_UNDO', 'The undo request does not say which import to undo.');
    if (undoEntry === null || undoEntry.version !== version || deps.store.getVersion() !== version) {
      throw new HttpError(409, 'UNDO_STALE', 'This import can no longer be undone: the data changed after it. Use Restore sample data to start over.');
    }
    deps.store.replaceAll(undoEntry.previous);
    undoEntry = null;
  }

  function getSnapshot(): Snapshot {
    const version = deps.store.getVersion();
    const today = deps.getToday();
    if (cachedSnapshot !== null && cachedVersion === version && cachedToday === today) {
      return cachedSnapshot;
    }
    const snapshot = buildSnapshot(deps.store.getDataset(), today, {
      generatedAt: now().toISOString(),
      limits: { maxUploadBytes: deps.config.maxUploadBytes, maxRows: ingestLimits.maxRows }
    });
    cachedVersion = version;
    cachedToday = today;
    cachedSnapshot = snapshot;
    return snapshot;
  }

  async function handleImport(req: IncomingMessage, res: ServerResponse, kind: ImportKind): Promise<void> {
    assertSameOriginMutation(req);

    const contentType = req.headers['content-type'] ?? '';
    const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    if (mediaType !== 'text/csv') {
      throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Upload the file as text/csv.');
    }

    // Optional user-confirmed column map (V1.5). Whitelist-parsed before the body is read; it only selects which column
    // feeds which field, and the import below re-validates it and every value in full.
    const rawMap = req.headers[COLUMN_MAP_HEADER];
    let columnMap: ColumnMap | undefined;
    if (rawMap !== undefined) {
      const parsedMap = typeof rawMap === 'string' ? parseColumnMapHeader(rawMap, kind) : { ok: false as const };
      if (!parsedMap.ok) {
        throw new HttpError(400, 'INVALID_COLUMN_MAP', 'The column mapping sent with the upload is invalid.');
      }
      columnMap = parsedMap.map;
    }

    const bytes = await readBody(req, deps.config.maxUploadBytes);
    const text = decodeUtf8Strict(bytes);
    if (text === null) {
      throw new HttpError(
        400,
        'INVALID_ENCODING',
        "The file is not valid UTF-8 text. Save it as 'CSV UTF-8' and try again."
      );
    }
    if (text.trim() === '') {
      throw new HttpError(400, 'EMPTY_FILE', 'The file is empty.');
    }

    const result = kind === 'inventory' ? importInventoryCsv(text, importLimits, columnMap) : importShipmentsCsv(text, importLimits, columnMap);
    if (!result.ok) {
      throw new HttpError(
        422,
        'VALIDATION_FAILED',
        `The file was rejected: ${result.totalErrors} problem(s) found. No data was changed.`,
        { errors: result.errors, totalErrors: result.totalErrors, warnings: result.warnings }
      );
    }

    const filenameHeader = req.headers['x-scc-filename'];
    const label = sanitizeFilename(typeof filenameHeader === 'string' ? filenameHeader : undefined);
    const dataSource: DataSourceInfo = {
      kind: 'import',
      label,
      loadedAt: now().toISOString(),
      rowCount: result.rows.length
    };

    const previous = deps.store.getDataset();
    if (kind === 'inventory') {
      deps.store.replaceInventory(result.rows as never, dataSource);
    } else {
      deps.store.replaceShipments(result.rows as never, dataSource);
    }
    undoEntry = { previous, version: deps.store.getVersion() };

    sendJson(res, 200, { ok: true, kind, rowCount: result.rows.length, warnings: result.warnings, dataSource, undo: { version: undoEntry.version } });
  }

  return async function apiHandler(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    try {
      refreshSampleForToday();

      if (pathname === '/api/health') {
        if (method !== 'GET') throw methodNotAllowed(['GET']);
        sendJson(res, 200, { status: 'ok' });
        return;
      }

      if (pathname === '/api/snapshot') {
        if (method !== 'GET') throw methodNotAllowed(['GET']);
        sendJson(res, 200, getSnapshot());
        return;
      }

      if (pathname.startsWith(IMPORT_PREFIX)) {
        const kind = pathname.slice(IMPORT_PREFIX.length);
        if (kind !== 'inventory' && kind !== 'shipments') {
          throw new HttpError(404, 'NOT_FOUND', 'Not found.');
        }
        if (method !== 'POST') throw methodNotAllowed(['POST']);
        await handleImport(req, res, kind);
        return;
      }

      if (pathname === '/api/reset') {
        if (method !== 'POST') throw methodNotAllowed(['POST']);
        assertSameOriginMutation(req);
        const today = deps.getToday();
        deps.store.replaceAll(deps.createSampleDataset(today));
        sampleDay = today;
        undoEntry = null;
        sendJson(res, 200, { ok: true });
        return;
      }

      if (pathname === '/api/undo') {
        if (method !== 'POST') throw methodNotAllowed(['POST']);
        assertSameOriginMutation(req);
        undoLastImport(req);
        sendJson(res, 200, { ok: true });
        return;
      }

      throw new HttpError(404, 'NOT_FOUND', 'Not found.');
    } catch (err) {
      if (err instanceof HttpError) {
        if (err.extra?.['allow'] !== undefined) {
          res.setHeader('Allow', err.extra['allow'] as string);
          const { allow: _allow, ...rest } = err.extra;
          err.extra = Object.keys(rest).length > 0 ? rest : undefined;
        }
        sendError(res, err);
        return;
      }
      console.error(err);
      sendJson(res, 500, { ok: false, error: { code: 'INTERNAL', message: 'Internal server error.' } });
    }
  };
}

function methodNotAllowed(allowed: string[]): HttpError {
  return new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.', { allow: allowed.join(', ') });
}
