export interface ErrorStateProps {
  title: string;
  message: string;
  onRetry?: () => void;
}

/** Shown when data failed to load; offers a Retry button when `onRetry` is given. */
export function ErrorState({ title, message, onRetry }: ErrorStateProps) {
  return (
    <div className="error-state" role="alert">
      <p className="error-state__title">{title}</p>
      <p className="error-state__message">{message}</p>
      {onRetry !== undefined && (
        <button type="button" className="button button--primary" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
