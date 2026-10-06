import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  message?: string;
  action?: ReactNode;
}

/** Shown when a page or filtered view has no rows to display. */
export function EmptyState({ title, message, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      {message !== undefined && <p className="empty-state__message">{message}</p>}
      {action !== undefined && <div className="empty-state__action">{action}</div>}
    </div>
  );
}
