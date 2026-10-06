// The shared page skeleton's dark headline band (V1.6 §5.0). The h1 keeps the exact route title (the focus target
// and accessibility contract); the two editorial display lines are a decorative restatement, hidden from assistive tech.
import type { ReactNode } from 'react';

export interface PageStageProps {
  /** Exact route title: rendered as the page's only h1 (focus target, test and a11y contract). */
  title: string;
  /** Two editorial lines. Decorative restatement, rendered aria-hidden and never a heading. */
  display?: readonly [string, string];
  /** Top-right slot beside the h1 (rarely used). */
  actions?: ReactNode;
  /** Stage content: hero figures, map, briefing. */
  children?: ReactNode;
  variant?: 'compact' | 'full';
}

/** The dark page stage: h1 eyebrow, optional display headline, and optional stage content. */
export function PageStage({ title, display, actions, children, variant = 'full' }: PageStageProps) {
  return (
    <div className={`page-stage page-stage--${variant} surface-stage`}>
      <div className="page-stage__inner">
        <div className="page-stage__head">
          <h1 tabIndex={-1} className="page-stage__title">
            {title}
          </h1>
          {actions && <div className="page-stage__actions">{actions}</div>}
        </div>
        {display && (
          <p className="page-stage__display" aria-hidden="true">
            <span className="page-stage__line">{display[0]}</span>
            <span className="page-stage__line page-stage__line--dim">{display[1]}</span>
          </p>
        )}
        {children !== undefined && <div className="page-stage__body">{children}</div>}
      </div>
    </div>
  );
}
