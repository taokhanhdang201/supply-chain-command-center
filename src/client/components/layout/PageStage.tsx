// The shared page skeleton's dark headline band (DESIGN.md "The page band"): the h1 (the page's only visible title, the
// focus target and accessibility contract), at most one context line, then the stage content. The two editorial display
// lines are a decorative restatement, hidden from assistive tech.
import type { ReactNode } from 'react';

export interface PageStageProps {
  /** Exact route title: rendered as the page's only h1 (focus target, test and a11y contract). */
  title: string;
  /** At most one line of context under the h1 (a fifth number goes here, never into a fifth figure). */
  context?: string;
  /** Two editorial lines. Decorative restatement, rendered aria-hidden and never a heading. */
  display?: readonly [string, string];
  /** Top-right slot beside the h1 (rarely used). */
  actions?: ReactNode;
  /** Stage content: hero figures, map, briefing. */
  children?: ReactNode;
  /** `slim`: a stage with nothing but its title (Data Import, Page not found), kept under 64px. */
  variant?: 'compact' | 'full' | 'slim';
}

/** The dark page stage: the h1, an optional context line, an optional display headline and optional stage content. */
export function PageStage({ title, context, display, actions, children, variant = 'full' }: PageStageProps) {
  return (
    <div className={`page-stage page-stage--${variant} surface-stage`}>
      <div className="page-stage__inner">
        <div className="page-stage__head">
          <h1 tabIndex={-1} className="page-stage__title">
            {title}
          </h1>
          {actions && <div className="page-stage__actions">{actions}</div>}
        </div>
        {context ? <p className="page-stage__context">{context}</p> : null}
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
