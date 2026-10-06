// Dev-only fallback: mounts Vite in middleware mode on the same HTTP server/port so there is one process for
// both the API and the SPA during development (plan §6.6). Vite is imported dynamically so it never ships in
// the production server bundle.

import type http from 'node:http';
import type { Fallback } from './app';

/** Creates a fallback handler backed by Vite's dev middleware, attached to the given HTTP server for HMR. */
export async function createViteFallback(server: http.Server): Promise<Fallback> {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa'
  });
  return (req, res) => {
    vite.middlewares(req, res);
  };
}
