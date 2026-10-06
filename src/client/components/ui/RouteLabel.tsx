// Renders a route label ("Origin → Destination") with the arrow in the accent colour. The text content is always
// identical to the label, and the spaces sit outside the arrow span so the computed accessible name is unchanged too.

export interface RouteLabelProps {
  label: string;
}

/** A route label with an accent-coloured direction arrow; labels without exactly one arrow render as raw text. */
export function RouteLabel({ label }: RouteLabelProps) {
  const parts = label.split(' → ');
  if (parts.length === 2) {
    return (
      <>
        {parts[0]}{' '}
        <span className="route-arrow">→</span>{' '}
        {parts[1]}
      </>
    );
  }
  return <>{label}</>;
}
