import type { ReactNode } from 'react';

export type BannerTone = 'info' | 'success' | 'warning' | 'critical';

export interface BannerProps {
  tone: BannerTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** Gives the title this id and makes the banner a region named by it (a landmark), instead of a live region. */
  titleId?: string;
}

/** An inline message banner. Uses `role="alert"` for warning/critical tones, `role="status"` otherwise; with a `titleId`,
 *  `role="region"` named by its title. */
export function Banner({ tone, title, children, action, titleId }: BannerProps) {
  const live = tone === 'critical' || tone === 'warning' ? 'alert' : 'status';
  return (
    <div className={`banner banner--${tone}`} role={titleId === undefined ? live : 'region'} aria-labelledby={titleId}>
      <div className="banner__body">
        <p className="banner__title" id={titleId}>
          {title}
        </p>
        {children !== undefined && <div className="banner__message">{children}</div>}
      </div>
      {action !== undefined && <div className="banner__action">{action}</div>}
    </div>
  );
}
