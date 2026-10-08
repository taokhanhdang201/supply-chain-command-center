// The app shell (plan §8.1/§8.2): sidebar + topbar + routed page, wired to the current hash route and the
// shared data-loading state. Owns the off-canvas drawer's open/close/focus behaviour. A development build also answers
// #/_design with the design reference (Phase 1 spec §10).

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { useData } from '../../state/DataContext';
import { ROUTES, useHashRoute, type RouteId } from '../../router';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { LoadingState } from '../ui/LoadingState';
import { ErrorState } from '../ui/ErrorState';
import { Banner } from '../ui/Banner';
import { ErrorBoundary } from '../ErrorBoundary';
import { DashboardPage } from '../../pages/DashboardPage';
import { InventoryPage } from '../../pages/InventoryPage';
import { ShipmentsPage } from '../../pages/ShipmentsPage';
import { RoutesPage } from '../../pages/RoutesPage';
import { AnalyticsPage } from '../../pages/AnalyticsPage';
import { AlertsPage } from '../../pages/AlertsPage';
import { ImportPage } from '../../pages/ImportPage';
import { NotFoundPage } from '../../pages/NotFoundPage';

const PAGE_COMPONENTS: Record<RouteId, () => ReactNode> = {
  dashboard: DashboardPage,
  inventory: InventoryPage,
  shipments: ShipmentsPage,
  routes: RoutesPage,
  analytics: AnalyticsPage,
  alerts: AlertsPage,
  import: ImportPage
};

/** The design reference (#/_design), for development builds only. A production build replaces import.meta.env.DEV with
 *  false, so this is null there: the page and its stylesheet are dropped from the bundle and the hash reads as "Page not
 *  found". It is not one of ROUTES. */
const DesignPage = import.meta.env.DEV ? lazy(() => import('../../pages/DesignPage').then((m) => ({ default: m.DesignPage }))) : null;

function titleFor(routeId: RouteId | 'not_found'): string {
  if (routeId === 'not_found') return 'Not found';
  return ROUTES.find((r) => r.id === routeId)?.title ?? '';
}

/** The app shell: sidebar, topbar, and the current route's page, driven by data-load state (§8.2). */
export function AppLayout() {
  const route = useHashRoute();
  const { state, refresh } = useData();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.title = `${titleFor(route.id)} · Supply Chain Command Center`;
    const heading = mainRef.current?.querySelector<HTMLElement>('h1');
    heading?.focus();
    if (typeof window.scrollTo === 'function') {
      try {
        window.scrollTo(0, 0);
      } catch {
        // jsdom logs "Not implemented" for scrollTo; harmless outside a real browser.
      }
    }
  }, [route.id]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const firstLink = document.querySelector<HTMLElement>('#sidebar a');
    firstLink?.focus();

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setDrawerOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  function handleMenuClick(): void {
    if (drawerOpen) {
      setDrawerOpen(false);
      menuButtonRef.current?.focus();
    } else {
      setDrawerOpen(true);
    }
  }

  function handleNavigate(): void {
    setDrawerOpen(false);
  }

  function handleBackdropClick(): void {
    setDrawerOpen(false);
    menuButtonRef.current?.focus();
  }

  /** Skip link: focus the page's h1 (or <main> while no page is mounted) without touching the hash, which the router
   *  would read as a route ("Page not found"). */
  function handleSkipLinkClick(e: MouseEvent<HTMLAnchorElement>): void {
    e.preventDefault();
    const main = mainRef.current;
    (main?.querySelector<HTMLElement>('h1') ?? main)?.focus();
  }

  const alertCount =
    state.status === 'ready'
      ? state.snapshot.alerts.filter((a) => a.severity === 'critical' || a.severity === 'warning').length
      : null;
  const today = state.status === 'ready' ? state.snapshot.today : null;
  const dataSources = state.status === 'ready' ? state.snapshot.dataSources : null;
  const refreshing = state.status === 'ready' ? state.refreshing : false;

  let body: ReactNode;
  if (state.status === 'loading') {
    body = <LoadingState />;
  } else if (state.status === 'error') {
    body = <ErrorState title="Could not load data" message={state.error.message} onRetry={refresh} />;
  } else {
    const PageComponent = route.id === 'not_found' ? NotFoundPage : PAGE_COMPONENTS[route.id];
    // #/_design is no route (the router reads it as not found); only a development build answers it. The hash is read
    // here because the router keeps only the route id; useHashRoute re-renders on every hash change.
    const page =
      DesignPage !== null && route.id === 'not_found' && window.location.hash.startsWith('#/_design') ? (
        <Suspense fallback={<LoadingState />}>
          <DesignPage />
        </Suspense>
      ) : (
        <PageComponent />
      );
    body = (
      <>
        {state.refreshError !== null && (
          <Banner
            tone="warning"
            title="Could not refresh data"
            action={
              <button type="button" className="button" onClick={refresh}>
                Retry
              </button>
            }
          >
            {state.refreshError.message}
          </Banner>
        )}
        <ErrorBoundary key={route.id}>{page}</ErrorBoundary>
      </>
    );
  }

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link" onClick={handleSkipLinkClick}>
        Skip to main content
      </a>
      <Sidebar activeRouteId={route.id} alertCount={alertCount} open={drawerOpen} onNavigate={handleNavigate} />
      {drawerOpen && <div className="drawer-backdrop" onClick={handleBackdropClick} />}
      <div className="app-shell__content">
        <Topbar
          today={today}
          dataSources={dataSources}
          refreshing={refreshing}
          onRefresh={refresh}
          drawerOpen={drawerOpen}
          onMenuClick={handleMenuClick}
          menuButtonRef={menuButtonRef}
        />
        <main id="main" className="main" ref={mainRef} tabIndex={-1}>
          {body}
        </main>
      </div>
    </div>
  );
}
