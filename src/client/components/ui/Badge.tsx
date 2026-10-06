import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'info' | 'good' | 'warning' | 'critical';

export interface BadgeProps {
  tone: BadgeTone;
  children: ReactNode;
  title?: string;
}

/** A small status label. Always shows text (never conveys meaning through color alone). */
export function Badge({ tone, children, title }: BadgeProps) {
  return (
    <span className={`badge badge--${tone}`} title={title}>
      {children}
    </span>
  );
}
