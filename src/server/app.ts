// Wires together the HTTP server: parses the URL, applies security headers to every response, and routes to
// the API handler or a fallback (static files in production, Vite middleware in dev) (plan §6.6).

import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppConfig } from './config';
import { applySecurityHeaders, assertAllowedHost, sendError, HttpError } from './http';

export type ApiHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>;
export type Fallback = (req: IncomingMessage, res: ServerResponse, pathname: string) => void | Promise<void>;

export interface CreateAppServerOptions {
  config: AppConfig;
  api: ApiHandler;
  fallback?: Fallback;
}

/** Creates the `node:http` server: security headers on every response, `/api/*` to the API handler, else fallback. */
export function createAppServer(opts: CreateAppServerOptions): http.Server {
  // The Host allowlist (R-11) is checked against the server's *actual* bound port, not `opts.config.port` —
  // when the caller listens on port 0 (e.g. tests picking a free port), the OS-assigned port only becomes known
  // once the server starts listening, and only that real port can ever appear in a legitimate request's Host
  // header.
  let boundPort = opts.config.port;

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        applySecurityHeaders(res, { csp: opts.config.mode !== 'development' });
        assertAllowedHost(req, { host: opts.config.host, port: boundPort, publicHost: opts.config.publicHost });
        const url = new URL(req.url ?? '/', 'http://localhost');

        if (url.pathname.startsWith('/api/')) {
          await opts.api(req, res, url);
          return;
        }

        if (opts.fallback) {
          await opts.fallback(req, res, url.pathname);
          return;
        }

        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Not found');
      } catch (err) {
        if (err instanceof HttpError) {
          if (!res.headersSent) sendError(res, err);
          else res.destroy();
          return;
        }
        console.error(err);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Internal server error');
        } else {
          res.destroy();
        }
      }
    })();
  });

  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;

  server.on('listening', () => {
    const addr = server.address();
    if (addr !== null && typeof addr === 'object') {
      boundPort = addr.port;
    }
  });

  return server;
}
