// Serves the built SPA (or, in dev, is replaced entirely by `devVite.ts`). Guards against path traversal by
// resolving against the root and requiring the result to stay inside it (plan §6.5 / §9.7).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

type Handler = (req: IncomingMessage, res: ServerResponse, pathname: string) => Promise<void>;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function notFound(res: ServerResponse): void {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Not found');
}

function badRequest(res: ServerResponse): void {
  res.statusCode = 400;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Bad request');
}

/** Creates a static-file handler rooted at `rootDir`, safe against path traversal. */
export function createStaticHandler(rootDir: string): Handler {
  return async function staticHandler(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Method not allowed');
      return;
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      badRequest(res);
      return;
    }

    if (decoded.includes('\0') || decoded.includes('\\')) {
      badRequest(res);
      return;
    }

    const relative = decoded === '/' ? 'index.html' : `.${decoded}`;
    const resolved = path.resolve(rootDir, relative);
    if (resolved !== rootDir && !resolved.startsWith(rootDir + path.sep)) {
      notFound(res);
      return;
    }

    let stat;
    try {
      stat = await fs.stat(resolved);
    } catch {
      notFound(res);
      return;
    }
    if (!stat.isFile()) {
      notFound(res);
      return;
    }

    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Cache-Control',
      decoded.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    );
    res.statusCode = 200;

    if (method === 'HEAD') {
      res.end();
      return;
    }

    await new Promise<void>((resolve) => {
      const stream = createReadStream(resolved);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Internal server error');
        } else {
          res.destroy();
        }
        resolve();
      });
      stream.on('end', () => resolve());
      stream.pipe(res);
    });
  };
}
