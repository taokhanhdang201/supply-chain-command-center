// Process entry point (plan §6.6): loads `.env`, validates config, builds the sample dataset, wires the store,
// API and fallback (dev: Vite middleware; prod: static files), and starts listening.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig } from './config';
import { createDataStore } from './store';
import { createApiHandler } from './api';
import { IngestLimitsError, loadIngestLimits } from './ingestLimits';
import { createAppServer } from './app';
import { createStaticHandler } from './staticFiles';
import { localToday } from '../shared/dates';
import { createSampleDataset } from '../shared/sample/generateSampleData';

async function main(): Promise<void> {
  if (fs.existsSync('.env')) {
    process.loadEnvFile('.env');
  }

  let config;
  try {
    config = loadConfig(process.env, process.argv.slice(2));
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  let ingestLimits;
  try {
    ingestLimits = loadIngestLimits(process.env);
  } catch (err) {
    if (err instanceof IngestLimitsError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  for (const warning of ingestLimits.warnings) console.warn(warning);

  const getToday = (): string => config.todayOverride ?? localToday(new Date());
  const buildSample = (today: string = getToday()): ReturnType<typeof createSampleDataset> =>
    createSampleDataset(config.seed, today, new Date().toISOString());

  // The API rebuilds the sample when the day changes; it compares against the exact day this one was built for.
  const sampleDay = getToday();
  const store = createDataStore(buildSample(sampleDay));
  const api = createApiHandler({ config, store, getToday, createSampleDataset: buildSample, sampleDay, ingestLimits });

  const opts: Parameters<typeof createAppServer>[0] = { config, api };
  const server = createAppServer(opts);

  if (config.mode === 'development') {
    opts.fallback = await import('./devVite').then((m) => m.createViteFallback(server));
  } else {
    const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client');
    opts.fallback = createStaticHandler(clientDir);
  }

  startServer(server, config);
}

function startServer(server: ReturnType<typeof createAppServer>, config: { port: number; host: string; mode: string }): void {
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use. Set PORT to a free port (see .env.example).`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(config.port, config.host, () => {
    console.log(`Supply Chain Command Center running at http://${config.host}:${config.port} (${config.mode})`);
  });

  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
