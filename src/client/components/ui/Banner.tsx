import type { ReactNode } from 'react';

export type BannerTone = 'info' | 'success' | 'warning' | 'critical';

export interface BannerProps {
  tone: BannerTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

/** An inline message banner. Uses `role="alert"` for warning/critical tones, `role="status"` otherwise. */
export function Banner({ tone, title, children, action }: BannerProps) {
  const role = tone === 'critical' || tone === 'warning' ? 'alert' : 'status';
  return (
    <div className={`banner banner--${tone}`} role={role}>
      <div className="banner__body">
        <p className="banner__title">{title}</p>
        {children !== undefined && <div className="banner__message">{children}</div>}
      </div>
      {action !== undefined && <div className="banner__action">{action}</div>}
    </div>
  );
}
