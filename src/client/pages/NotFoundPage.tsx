import { buildHash } from '../router';
import { PageStage } from '../components/layout/PageStage';

/** Shown for an unrecognised route; links back to the dashboard. */
export function NotFoundPage() {
  return (
    <div className="page">
      <PageStage title="Page not found" variant="compact" />
      <div className="page-floor">
        <p>The page you're looking for doesn't exist.</p>
        <a href={buildHash('dashboard')}>Back to dashboard</a>
      </div>
    </div>
  );
}
