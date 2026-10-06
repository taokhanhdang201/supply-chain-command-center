// Minimal hash router (plan §8.8): 7 static routes, no dependency. Hash routing needs no server fallback.

import { useEffect, useState } from 'react';

export type RouteId = 'dashboard' | 'inventory' | 'shipments' | 'routes' | 'analytics' | 'alerts' | 'import';

export interface ParsedRoute {
  id: RouteId | 'not_found';
  params: URLSearchParams;
}

export const ROUTES: ReadonlyArray<{ id: RouteId; path: string; title: string }> = [
  { id: 'dashboard', path: '/', title: 'Dashboard' },
  { id: 'inventory', path: '/inventory', title: 'Inventory' },
  { id: 'shipments', path: '/shipments', title: 'Shipments' },
  { id: 'routes', path: '/routes', title: 'Routes' },
  { id: 'analytics', path: '/analytics', title: 'Analytics' },
  { id: 'alerts', path: '/alerts', title: 'Alerts' },
  { id: 'import', path: '/import', title: 'Data Import' }
];

function normalizePath(path: string): string {
  if (path === '' || path === '/') return '/';
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

/** Parses a `location.hash` value into a route id and its query params. Trailing slashes are tolerated. */
export function parseHash(hash: string): ParsedRoute {
  const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash;
  const [rawPath, rawQuery = ''] = withoutHash.split('?');
  const path = normalizePath(rawPath ?? '');
  const params = new URLSearchParams(rawQuery);
  const route = ROUTES.find((r) => r.path === path);
  return { id: route ? route.id : 'not_found', params };
}

/** Builds a hash string (e.g. `#/shipments?status=delivered`) for the given route and optional query params. */
export function buildHash(id: RouteId, params?: Record<string, string>): string {
  const route = ROUTES.find((r) => r.id === id);
  const path = route ? route.path : '/';
  const query = params ? new URLSearchParams(params).toString() : '';
  return query ? `#${path}?${query}` : `#${path}`;
}

/** Sets the current location hash, triggering navigation. */
export function navigate(hash: string): void {
  window.location.hash = hash;
}

/** Subscribes to `hashchange` and returns the currently parsed route. */
export function useHashRoute(): ParsedRoute {
  const [route, setRoute] = useState<ParsedRoute>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route;
}
