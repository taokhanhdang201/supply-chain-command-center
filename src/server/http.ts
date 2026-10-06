// Low-level HTTP helpers shared by the API and static-file handlers (plan §6.3): security headers, JSON
// responses, a size-limited body reader, strict UTF-8 decoding, the same-origin mutation check, and filename
// sanitization for the display label used on imports.

import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
  "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

/** Applies the security headers required on every response; adds CSP only when `opts.csp` is true (not in dev). */
export function applySecurityHeaders(res: ServerResponse, opts: { csp: boolean }): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (opts.csp) {
    res.setHeader('Content-Security-Policy', CSP);
  }
}

/** Sends a JSON response with the given status; always disables caching. */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(payload);
}

/** Sends a standard `{ ok:false, error:{code,message}, ...extra }` error body for an HttpError. */
export function sendError(res: ServerResponse, err: HttpError): void {
  sendJson(res, err.status, {
    ok: false,
    error: { code: err.code, message: err.message },
    ...(err.extra ?? {})
  });
}

/** Reads the full request body, enforcing `limit` bytes both via Content-Length and while streaming. */
export function readBody(req: IncomingMessage, limit: number): Promise<Uint8Array> {
  const contentLengthHeader = req.headers['content-length'];
  if (contentLengthHeader !== undefined) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > limit) {
      return Promise.reject(new HttpError(413, 'FILE_TOO_LARGE', fileTooLargeMessage(limit)));
    }
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let exceeded = false;
    let settled = false;

    const cleanup = (): void => {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
    };

    const onData = (chunk: Buffer): void => {
      total += chunk.length;
      if (total > limit) {
        // Keep draining (without buffering) so the client can finish sending and cleanly receive the error
        // response, instead of the connection resetting mid-upload.
        exceeded = true;
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (exceeded) {
        reject(new HttpError(413, 'FILE_TOO_LARGE', fileTooLargeMessage(limit)));
        return;
      }
      resolve(new Uint8Array(Buffer.concat(chunks)));
    };

    const onError = (err: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

function fileTooLargeMessage(limit: number): string {
  const mb = (limit / (1024 * 1024)).toFixed(1);
  return `The file exceeds the ${mb} MB upload limit.`;
}

/** Strictly decodes UTF-8 bytes to a string, stripping a leading BOM; returns null on invalid encoding. */
export function decodeUtf8Strict(bytes: Uint8Array): string | null {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const text = decoder.decode(bytes);
    return text.replace(/^﻿/, '');
  } catch {
    return null;
  }
}

/**
 * Rejects a request whose `Host` header does not match one of this server's own bound addresses (R-11: DNS
 * rebinding). Without this, a page served from an attacker-controlled domain that later resolves to
 * 127.0.0.1 (DNS rebinding) would send a matching `Host`/`Origin` pair (both the attacker's domain), which
 * `assertSameOriginMutation`'s same-origin check alone cannot distinguish from a legitimate same-origin request.
 */
export function assertAllowedHost(req: IncomingMessage, config: { host: string; port: number }): void {
  const host = req.headers.host;
  if (typeof host !== 'string' || host.length === 0) {
    throw new HttpError(421, 'MISDIRECTED_REQUEST', 'Missing or invalid Host header.');
  }
  const allowedHosts = new Set([
    `127.0.0.1:${config.port}`,
    `localhost:${config.port}`,
    `[::1]:${config.port}`,
    `${config.host}:${config.port}`
  ]);
  if (!allowedHosts.has(host)) {
    throw new HttpError(421, 'MISDIRECTED_REQUEST', 'This server does not respond to that Host.');
  }
}

/** Requires the `X-SCC-Request` header and, when `Origin` is present, that it matches the request host. */
export function assertSameOriginMutation(req: IncomingMessage): void {
  const marker = req.headers['x-scc-request'];
  if (marker !== '1') {
    throw new HttpError(403, 'FORBIDDEN', 'Missing X-SCC-Request header.');
  }
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.length > 0) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new HttpError(403, 'FORBIDDEN', 'Cross-origin requests are not allowed.');
    }
    if (originHost !== req.headers.host) {
      throw new HttpError(403, 'FORBIDDEN', 'Cross-origin requests are not allowed.');
    }
  }
}

/** Sanitizes an (optionally URI-encoded) filename for safe display: basename only, restricted charset, truncated. */
export function sanitizeFilename(raw: string | undefined): string {
  if (raw === undefined) return 'upload.csv';
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const lastSlash = Math.max(decoded.lastIndexOf('/'), decoded.lastIndexOf('\\'));
  const base = lastSlash >= 0 ? decoded.slice(lastSlash + 1) : decoded;
  const cleaned = base.replace(/[^A-Za-z0-9 ._-]/g, '_').slice(0, 80);
  return cleaned === '' ? 'upload.csv' : cleaned;
}
