// A section's heading on paper: the h2 at lg / 500 over a 1px ink rule, with optional actions at the
// right end, and at most one subtitle under the rule, before the content. It wears the existing section-bar classes.
import type { ReactNode } from 'react';

export interface SectionHeaderProps {
  /** The section's h2. */
  title: string;
  /** The h2's id, for aria-labelledby on the section. */
  id?: string;
  /** Controls at the right end of the rule (for example a select). */
  actions?: ReactNode;
  /** One line under the rule that says what the section holds (14px, muted, at most 72ch). */
  subtitle?: string;
}

/** A real h2 over the section rule, then the actions; the subtitle, if any, under the rule. */
export function SectionHeader({ title, id, actions, subtitle }: SectionHeaderProps) {
  return (
    <>
      <div className={subtitle === undefined ? 'section-bar' : 'section-bar section-bar--with-subtitle'}>
        <h2 className="section-label" id={id}>
          {title}
        </h2>
        {actions !== undefined && <div className="section-bar__actions">{actions}</div>}
      </div>
      {subtitle !== undefined && <p className="section-bar__subtitle">{subtitle}</p>}
    </>
  );
}
