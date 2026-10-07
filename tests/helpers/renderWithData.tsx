// Renders a component under a `DataProvider` backed by a fake `ApiClient` whose methods are `vi.fn`s that
// resolve the given snapshot (plan §12 / §14). UI page tests use this instead of hitting the real HTTP client.

import type { ReactElement, ReactNode } from 'react';
import { act, render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { vi } from 'vitest';
import type { Snapshot } from '../../src/shared/types';
import type { ApiClient } from '../../src/client/api/apiClient';
import { DataProvider, useData } from '../../src/client/state/DataContext';

export interface RenderWithDataOptions {
  snapshot: Snapshot;
  api?: Partial<ApiClient>;
}

export interface RenderWithDataResult extends RenderResult {
  api: ApiClient;
}

// A page component calls `useSnapshot()`, which throws unless `DataProvider`'s state is 'ready' (plan §8.7); in
// the real app `AppLayout` only ever mounts a page once ready. This gate reproduces that for isolated page
// tests: `renderWithData` awaits until the snapshot has resolved before `ui` is committed for the first time.
function ReadyGate({ children }: { children: ReactNode }) {
  const { state } = useData();
  return state.status === 'ready' ? <>{children}</> : null;
}

/** Renders `ui` inside a `DataProvider` whose `ApiClient` is a fake resolving `options.snapshot`, waiting for
 * the snapshot to be ready (as `AppLayout` would) before `ui` is ever committed. */
export async function renderWithData(ui: ReactElement, options: RenderWithDataOptions): Promise<RenderWithDataResult> {
  const api: ApiClient = {
    getSnapshot: vi.fn().mockResolvedValue(options.snapshot),
    importCsv: vi.fn(),
    resetSampleData: vi.fn().mockResolvedValue(undefined),
    undoImport: vi.fn().mockResolvedValue(undefined),
    ...options.api
  };

  let result!: RenderResult;
  await act(async () => {
    result = render(
      <DataProvider api={api}>
        <ReadyGate>{ui}</ReadyGate>
      </DataProvider>
    );
  });
  return { ...result, api };
}
