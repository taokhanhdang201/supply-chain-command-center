// A single 100% stacked bar with a labelled legend: shares of one whole (e.g. shipments by status). Easier to compare
// than a donut when one part dominates, because every part keeps its count and percentage in words. Each part and its swatch
// are drawn in the token of its tone (var(--good), var(--neutral)…), the tones the badges and the other charts use, and in the
// form of its mark (solid, hatched or hollow), so parts that share a tone stay apart. Shares read to one decimal ("2.9%").

import { formatPercent } from '../../../shared/format';
import type { Mark } from '../ui/Badge';
import type { ChartTone } from './StackedBarChart';

export interface ShareDatum {
  key: string;
  label: string;
  value: number;
  tone: ChartTone;
  /** The form of the part and its swatch; solid by default. */
  mark?: Mark;
}

export interface ShareBarProps {
  data: readonly ShareDatum[];
  valueFormat: (n: number) => string;
  ariaLabel: string;
}

/** "share-bar__segment--neutral", plus "share-bar__segment--hatched" or "--hollow" for those forms. */
function partClass(d: ShareDatum): string {
  const mark = d.mark ?? 'solid';
  return mark === 'solid' ? `share-bar__segment--${d.tone}` : `share-bar__segment--${d.tone} share-bar__segment--${mark}`;
}

/** One bar split by share, then one legend row per part: label, value and percentage. A part of 0 has no segment but keeps its
 *  legend row. */
export function ShareBar({ data, valueFormat, ariaLabel }: ShareBarProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const share = (d: ShareDatum) => (total === 0 ? 0 : d.value / total);
  const summary = data.map((d) => `${d.label} ${valueFormat(d.value)} (${formatPercent(share(d))})`).join(', ');

  return (
    <div className="share-bar">
      <div className="share-bar__track" role="img" aria-label={`${ariaLabel}: ${summary}`}>
        {data
          .filter((d) => d.value > 0)
          .map((d) => (
            <span key={d.key} className={`share-bar__segment ${partClass(d)}`} style={{ width: `${share(d) * 100}%`, background: `var(--${d.tone})` }} />
          ))}
      </div>
      <ul className="share-bar__legend" aria-hidden="true">
        {data.map((d) => (
          <li key={d.key} className="share-bar__item">
            <span className={`share-bar__swatch ${partClass(d)}`} style={{ background: `var(--${d.tone})` }} />
            <span className="share-bar__label">{d.label}</span>
            <span className="share-bar__value">{valueFormat(d.value)}</span>
            <span className="share-bar__share">{formatPercent(share(d))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
