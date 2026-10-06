// Loads and validates the server's runtime configuration from environment variables and CLI args (plan §6.1).
// Empty-string env values count as unset. Any invalid value throws a ConfigError naming the variable and range.
// Values are trimmed before validation (R-9): a shell that leaves a trailing space in an env var assignment
// (e.g. cmd.exe's `set PORT=4000 && ...` without quoting the whole assignment) should not crash the server.

import type { DayString } from '../shared/types';
import { isDayString } from '../shared/dates';
import { DEFAULT_MAX_UPLOAD_BYTES } from '../shared/constants';

export interface AppConfig {
  port: number;
  host: string;
  seed: number;
  todayOverride: DayString | null;
  maxUploadBytes: number;
  mode: 'development' | 'production' | 'test';
  /** Public hostname of a hosted demo (e.g. scc-demo.onrender.com), also accepted as `Host`; unset locally. */
  publicHost?: string;
}

export class ConfigError extends Error {}

function readEnv(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  return trimmed;
}

function parseIntInRange(env: Record<string, string | undefined>, key: string, min: number, max: number, fallback: number): number {
  const raw = readEnv(env, key);
  if (raw === undefined) return fallback;
  if (!/^-?\d+$/.test(raw)) {
    throw new ConfigError(`Invalid ${key} "${raw}": expected an integer between ${min} and ${max}.`);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw new ConfigError(`Invalid ${key} "${raw}": expected an integer between ${min} and ${max}.`);
  }
  return value;
}

/** Loads and validates the app configuration from environment variables and CLI arguments. */
export function loadConfig(env: Record<string, string | undefined>, argv: readonly string[]): AppConfig {
  const port = parseIntInRange(env, 'PORT', 1, 65535, 3000);
  const host = readEnv(env, 'HOST') ?? '127.0.0.1';
  const seed = parseIntInRange(env, 'SCC_SEED', 0, 4294967295, 42);

  const todayRaw = readEnv(env, 'SCC_TODAY');
  let todayOverride: DayString | null = null;
  if (todayRaw !== undefined) {
    if (!isDayString(todayRaw)) {
      throw new ConfigError(`Invalid SCC_TODAY "${todayRaw}": expected a valid date in YYYY-MM-DD format.`);
    }
    todayOverride = todayRaw;
  }

  const maxUploadBytes = parseIntInRange(env, 'SCC_MAX_UPLOAD_BYTES', 1024, 10_485_760, DEFAULT_MAX_UPLOAD_BYTES);

  const mode: AppConfig['mode'] = argv.includes('--dev') ? 'development' : 'production';

  const publicHost = readPublicHost(env);
  return { port, host, seed, todayOverride, maxUploadBytes, mode, ...(publicHost === undefined ? {} : { publicHost }) };
}

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** SCC_PUBLIC_HOST, else Render's RENDER_EXTERNAL_HOSTNAME: a bare hostname, lower-cased (no scheme, port or path). */
function readPublicHost(env: Record<string, string | undefined>): string | undefined {
  const key = readEnv(env, 'SCC_PUBLIC_HOST') !== undefined ? 'SCC_PUBLIC_HOST' : 'RENDER_EXTERNAL_HOSTNAME';
  const raw = readEnv(env, key);
  if (raw === undefined) return undefined;
  const value = raw.toLowerCase();
  if (!HOSTNAME.test(value)) {
    throw new ConfigError(`Invalid ${key} "${raw}": expected a hostname such as scc-demo.onrender.com (no scheme, port or path).`);
  }
  return value;
}
