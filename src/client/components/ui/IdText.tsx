// Keeps identifiers (SHP-100138, APP-0005, WH-ORD) whole: a browser may break a line after a hyphen, which splits an
// ID across two lines. Each ID in the text is wrapped in a no-wrap span; the rest of the text wraps as usual.

/** An uppercase prefix, a hyphen, then the code: shipment ids, SKUs and warehouse codes. */
const ID_PATTERN = /([A-Z]{2,4}-[A-Z0-9]{3,6})/;

/** Renders `text` with every ID kept on one line. The text content is unchanged (search, copy and tests see it as is). */
export function IdText({ text }: { text: string }) {
  // With a capturing group, split() puts the IDs at the odd indices.
  return (
    <>
      {text.split(ID_PATTERN).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="id-code">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </>
  );
}
