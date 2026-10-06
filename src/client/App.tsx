import { DataProvider } from './state/DataContext';
import type { ApiClient } from './api/apiClient';
import { AppLayout } from './components/layout/AppLayout';

export interface AppProps {
  api: ApiClient;
}

/** The application root: wires the data provider to the app shell. */
export function App({ api }: AppProps) {
  return (
    <DataProvider api={api}>
      <AppLayout />
    </DataProvider>
  );
}
