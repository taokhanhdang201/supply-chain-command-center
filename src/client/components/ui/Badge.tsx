import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'info' | 'good' | 'warning' | 'critical';

/** The one mark (DESIGN.md "Marks"): an 8px square, filled, hatched or hollow. The form tells apart states that share a tone. */
export type Mark = 'solid' | 'hatched' | 'hollow';

export interface BadgeProps {
  tone: BadgeTone;
  children: ReactNode;
  /** Only when the words are cut short or are a term (for example "MTD"); a badge that says it all has none. */
  title?: string;
  /** The form of its square; solid by default. */
  mark?: Mark;
}

/** A small status label. Always shows text (never conveys meaning through color alone). */
export function Badge({ tone, children, title, mark = 'solid' }: BadgeProps) {
  const className = mark === 'solid' ? `badge badge--${tone}` : `badge badge--${tone} badge--${mark}`;
  return (
    <span className={className} title={title}>
      {children}
    </span>
  );
}
