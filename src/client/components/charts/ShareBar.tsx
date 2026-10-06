// A single 100% stacked bar with a labelled legend: shares of one whole (e.g. shipments by status). Easier to compare
// than a donut when one part dominates, because every part keeps its count and percentage in words.

import { formatPercent } from '../../../shared/format';

export type ShareTone = 'ink' | 'accent' | 'soft' | 'muted';

export interface ShareDatum {
  key: string;
  label: string;
  value: number;
  tone: ShareTone;
}

export interface ShareBarProps {
  data: readonly ShareDatum[];
  valueFormat: (n: number) => string;
  ariaLabel: string;
}

/** One bar split by share, then one legend row per part: label, value and percentage. */
export function ShareBar({ data, valueFormat, ariaLabel }: ShareBarProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const share = (d: ShareDatum) => (total === 0 ? 0 : d.value / total);
  const summary = data.map((d) => `${d.label} ${valueFormat(d.value)} (${formatPercent(share(d), 0)})`).join(', ');

  return (
    <div className="share-bar">
      <div className="share-bar__track" role="img" aria-label={`${ariaLabel}: ${summary}`}>
        {data
          .filter((d) => d.value > 0)
          .map((d) => (
            <span key={d.key} className={`share-bar__segment share-bar__segment--${d.tone}`} style={{ width: `${share(d) * 100}%` }} />
          ))}
      </div>
      <ul className="share-bar__legend" aria-hidden="true">
        {data.map((d) => (
          <li key={d.key} className="share-bar__item">
            <span className={`share-bar__swatch share-bar__segment--${d.tone}`} />
            <span className="share-bar__label">{d.label}</span>
            <span className="share-bar__value">{valueFormat(d.value)}</span>
            <span className="share-bar__share">{formatPercent(share(d), 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
