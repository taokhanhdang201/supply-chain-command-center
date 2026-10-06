// THE single list of adapters. Adding a format = one line here (plus its adapter module and fixtures). The core never
// imports this file: the worker entry, the inline runner and the tests build a registry from it.

import { AdapterRegistry, createRegistry } from '../registry';
import type { FormatAdapter } from '../types';
import { delimitedAdapter } from './delimited/adapter';
import { gzipAdapter } from './gzip/adapter';
import { refusalAdapters } from './refusals';

/** Registration order is detection tie-break order only for display; arbitration itself is order independent. */
export const builtinAdapters: readonly FormatAdapter[] = [
  delimitedAdapter,
  gzipAdapter,
  ...refusalAdapters
];

/** A fresh registry holding every built-in adapter. Tests add their own adapters to a registry like this one. */
export function createDefaultRegistry(): AdapterRegistry {
  const registry = createRegistry();
  for (const adapter of builtinAdapters) registry.register(adapter);
  return registry;
}
