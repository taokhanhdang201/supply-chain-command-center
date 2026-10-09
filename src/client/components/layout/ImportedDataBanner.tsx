// The banner on every page while the data is not the generated sample: someone imported a file, and the live demo's data is
// shared, so restoring the sample resets it for everyone. One click restores it (the server's reset, then a reload); the
// Data Import page keeps its own Restore card, which asks first.

import { useState } from 'react';
import type { JSX } from 'react';
import type { Snapshot } from '../../../shared/types';
import type { ApiError } from '../../api/apiClient';
import { useData } from '../../state/DataContext';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';

export interface ImportedDataBannerProps {
  dataSources: Snapshot['dataSources'];
  /** Called once the server has reset the data, before the reload: the shell says so once the sample is back. */
  onRestored: () => void;
}

/** Both sources are the generated sample (the server rebuilds it each day only then). */
export function isSampleData(dataSources: Snapshot['dataSources']): boolean {
  return dataSources.inventory.kind === 'sample' && dataSources.shipments.kind === 'sample';
}

const TITLE_ID = 'imported-data-title';

/** "Someone imported a file." with Restore sample data, or nothing while the data is the sample. */
export function ImportedDataBanner({ dataSources, onRestored }: ImportedDataBannerProps): JSX.Element | null {
  const { api, refresh } = useData();
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isSampleData(dataSources)) return null;

  async function handleRestore(): Promise<void> {
    setRestoring(true);
    setError(null);
    try {
      await api.resetSampleData();
    } catch (err) {
      setError((err as ApiError).message);
      setRestoring(false);
      return;
    }
    onRestored();
    // A failed reload keeps this banner (the data still reads as imported) under "Could not refresh data".
    await refresh();
    setRestoring(false);
  }

  // Busy, not disabled, while it runs: the button keeps the focus and ignores another click (Refresh does the same).
  const action = (
    <Button busy={restoring} onClick={handleRestore}>
      {restoring ? 'Restoring…' : error === null ? 'Restore sample data' : 'Try again'}
    </Button>
  );

  return (
    <div className="data-banner surface-stage">
      {error === null ? (
        <Banner tone="info" title="Someone imported a file." titleId={TITLE_ID} action={action}>
          These figures come from that file, not the sample. Restoring resets it for everyone.
        </Banner>
      ) : (
        <Banner tone="warning" title="Could not restore sample data" action={action}>
          {error}
        </Banner>
      )}
    </div>
  );
}
