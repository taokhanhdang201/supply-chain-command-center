// Reference component (plan §12): function components, named exports, a `XxxProps` interface directly above
// the component, no default exports, no `React.FC`, BEM-lite class names.

import type { ReactNode } from 'react';

export interface CardProps {
  title?: string;
  /** The title's heading level: 2 (the default) when the card is a section of its page, 3 when it sits under a section's
   *  h2 (a chart under "Charts"). It looks the same either way. */
  titleLevel?: 2 | 3;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Card({ title, titleLevel = 2, subtitle, actions, children, className }: CardProps) {
  const classes = className ? `card ${className}` : 'card';
  const Title = titleLevel === 3 ? 'h3' : 'h2';
  return (
    <section className={classes}>
      {(title !== undefined || actions !== undefined) && (
        <header className="card__header">
          <div>
            {title !== undefined && <Title className="card__title">{title}</Title>}
            {subtitle !== undefined && <p className="card__subtitle">{subtitle}</p>}
          </div>
          {actions !== undefined && <div className="card__actions">{actions}</div>}
        </header>
      )}
      <div className="card__body">{children}</div>
    </section>
  );
}
