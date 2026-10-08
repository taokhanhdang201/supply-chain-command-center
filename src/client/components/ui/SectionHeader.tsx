// A section's heading on paper (Phase 1 spec §6): the h2 at lg / 500 over a 1px ink rule, with optional actions at the
// right end. It wears the existing section-bar classes.
import type { ReactNode } from 'react';

export interface SectionHeaderProps {
  /** The section's h2. */
  title: string;
  /** The h2's id, for aria-labelledby on the section. */
  id?: string;
  /** Controls at the right end of the rule (for example a select). */
  actions?: ReactNode;
}

/** A real h2 over the section rule, then the actions. */
export function SectionHeader({ title, id, actions }: SectionHeaderProps) {
  return (
    <div className="section-bar">
      <h2 className="section-label" id={id}>
        {title}
      </h2>
      {actions !== undefined && <div className="section-bar__actions">{actions}</div>}
    </div>
  );
}
