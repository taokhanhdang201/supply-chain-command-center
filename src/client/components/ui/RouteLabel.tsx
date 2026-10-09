// Renders a route label ("Origin → Destination"). Each place sits in its own box (pages.css), so "Las Vegas, NV" keeps its
// line while it fits and a long label breaks at the arrow; the arrow is muted ink. The text content is always identical to the
// label, and the spaces sit outside the spans so the computed accessible name is unchanged too.

export interface RouteLabelProps {
  label: string;
}

/** A route label whose places keep their line; labels without exactly one arrow render as raw text. */
export function RouteLabel({ label }: RouteLabelProps) {
  const parts = label.split(' → ');
  if (parts.length === 2) {
    return (
      <>
        <span className="route-label__place">{parts[0]}</span>{' '}
        <span className="route-arrow">→</span>{' '}
        <span className="route-label__place">{parts[1]}</span>
      </>
    );
  }
  return <>{label}</>;
}
