// Catches rendering errors in a page so one broken page doesn't blank the whole app (plan §8.3). App.tsx keys
// this per-route so navigating away from a crashed page recovers automatically.

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

export interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(error, info);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="error-state" role="alert">
          <p className="error-state__title">Something went wrong</p>
          <p className="error-state__message">Something went wrong while rendering this page.</p>
          <button type="button" className="button button--primary" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
