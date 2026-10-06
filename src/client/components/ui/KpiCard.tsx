// Reference component (plan §12): function components, named exports, a `XxxProps` interface directly above
// the component, no default exports, no `React.FC`, BEM-lite class names (`kpi-card`, `kpi-card__value`, ...).

import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type KpiTone = 'neutral' | 'good' | 'warning' | 'critical';

export interface KpiCardProps {
  label: string;
  value: string;
  detail?: string;
  tone?: KpiTone;
  href?: string;
  icon?: IconName;
  /** Presentational scale: `hero` > `large` > `medium`. Omitted = the plain card look. */
  size?: 'hero' | 'large' | 'medium';
}

/** A single dashboard metric. When `href` is given the whole card is a link whose accessible name is "label value". */
export function KpiCard({ label, value, detail, tone = 'neutral', href, icon, size }: KpiCardProps) {
  const content: ReactNode = (
    <>
      {icon !== undefined && (
        <span className="kpi-card__icon">
          <Icon name={icon} />
        </span>
      )}
      <span className="kpi-card__label">{label}</span>
      <span className="kpi-card__value">{value}</span>
      {detail !== undefined && <span className="kpi-card__detail">{detail}</span>}
    </>
  );

  const className = `kpi-card kpi-card--${tone}${size ? ` kpi-card--${size}` : ''}`;

  if (href !== undefined) {
    return (
      <a className={className} href={href}>
        {content}
      </a>
    );
  }

  return <div className={className}>{content}</div>;
}
