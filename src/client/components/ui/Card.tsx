// Reference component (plan §12): function components, named exports, a `XxxProps` interface directly above
// the component, no default exports, no `React.FC`, BEM-lite class names.

import type { ReactNode } from 'react';

export interface CardProps {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Card({ title, subtitle, actions, children, className }: CardProps) {
  const classes = className ? `card ${className}` : 'card';
  return (
    <section className={classes}>
      {(title !== undefined || actions !== undefined) && (
        <header className="card__header">
          <div>
            {title !== undefined && <h2 className="card__title">{title}</h2>}
            {subtitle !== undefined && <p className="card__subtitle">{subtitle}</p>}
          </div>
          {actions !== undefined && <div className="card__actions">{actions}</div>}
        </header>
      )}
      <div className="card__body">{children}</div>
    </section>
  );
}
