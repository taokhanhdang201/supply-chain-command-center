// Holds the current `Snapshot` for the whole app (plan §8.2 / §8.7). One `DataProvider` fetches on mount,
// aborting on unmount, and exposes `refresh()` which keeps the previous snapshot visible while it runs.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Snapshot } from '../../shared/types';
import type { ApiClient, ApiError } from '../api/apiClient';

export type DataState =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError }
  | { status: 'ready'; snapshot: Snapshot; refreshing: boolean; refreshError: ApiError | null };

export interface DataContextValue {
  state: DataState;
  refresh: () => Promise<void>;
  api: ApiClient;
}

const DataContext = createContext<DataContextValue | null>(null);

export interface DataProviderProps {
  api: ApiClient;
  children: ReactNode;
}

export function DataProvider({ api, children }: DataProviderProps) {
  const [state, setState] = useState<DataState>({ status: 'loading' });
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const controller = new AbortController();
    api
      .getSnapshot(controller.signal)
      .then((snapshot) => {
        setState({ status: 'ready', snapshot, refreshing: false, refreshError: null });
      })
      .catch((err: ApiError) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', error: err });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const refresh = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    if (current.status === 'ready') {
      setState({ ...current, refreshing: true });
    } else {
      setState({ status: 'loading' });
    }
    try {
      const snapshot = await api.getSnapshot();
      setState({ status: 'ready', snapshot, refreshing: false, refreshError: null });
    } catch (err) {
      const apiErr = err as ApiError;
      const latest = stateRef.current;
      if (latest.status === 'ready') {
        setState({ ...latest, refreshing: false, refreshError: apiErr });
      } else {
        setState({ status: 'error', error: apiErr });
      }
    }
  }, [api]);

  const value = useMemo<DataContextValue>(() => ({ state, refresh, api }), [state, refresh, api]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

/** Returns the data context: current load state, `refresh()`, and the `api` client. */
export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (ctx === null) throw new Error('useData must be used within a DataProvider.');
  return ctx;
}

/** Returns the current snapshot. Throws if the data is not yet ready; only call this under the ready branch. */
export function useSnapshot(): Snapshot {
  const { state } = useData();
  if (state.status !== 'ready') throw new Error('useSnapshot called before data was ready.');
  return state.snapshot;
}
