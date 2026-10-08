// A figure on the dark page band (Phase 1 spec §6): the value first, then its label and an optional detail. It is one list
// item of a ul.figure-stage__figures; with href the whole figure is one link to the filter it counts. It wears the
// existing stage-figure classes.
import type { ReactNode } from 'react';

/** `neutral` (the default) is plain ink: normal, in progress, unknown, or a zero. */
export type FigureTone = 'critical' | 'warning' | 'neutral';

export interface FigureProps {
  /** The number, already formatted ("73", "$32.6M", "85.6%"). */
  value: string;
  /** What the number counts ("Delayed"). */
  label: string;
  /** A supporting line after the label ("12 overdue · 61 delivered late"). */
  detail?: ReactNode;
  /** Colours the value: critical for late, out of stock or blocking; warning for needs attention soon. */
  tone?: FigureTone;
  /** The filter the figure counts: the figure becomes one link, read as value, label, detail. */
  href?: string;
  /** Drawn between the value and the label (the Analytics on-time gauge); mark it aria-hidden. */
  children?: ReactNode;
}

/** One band figure as a list item: value, children, label, detail; a link when href is given. */
export function Figure({ value, label, detail, tone = 'neutral', href, children }: FigureProps) {
  const className = tone === 'neutral' ? 'stage-figure' : `stage-figure stage-figure--${tone}`;
  const content = (
    <>
      <span className="stage-figure__value">{value}</span>
      {children}{' '}
      <span className="stage-figure__label">{label}</span>
      {detail !== undefined && (
        <>
          {' '}
          <span className="stage-figure__detail">{detail}</span>
        </>
      )}
    </>
  );
  if (href === undefined) return <li className={className}>{content}</li>;
  return (
    <li>
      <a className={className} href={href}>
        {content}
      </a>
    </li>
  );
}
