// The parts of the design reference (#/_design) that DesignPage.tsx places among its own blocks: number formats, the target
// tone, the one mark, the filter bar on the grid, the table variants and the ID rule, stacked rows, the chart card, the
// explanation line and terms, the badge title, display names and the frame. Each block draws the shared component or rule
// with the code the pages use (formatters, Term, DataTable, ChartFrame, the tone and name maps), so the sample cannot drift.
// Development builds only, like DesignPage.tsx (it is imported from there alone, so it never reaches the production bundle).

import type { CSSProperties, ReactNode } from 'react';
import { formatDay, formatDays, formatPercent, monthAxisLabels } from '../../shared/format';
import { ChartFrame } from '../components/charts/ChartFrame';
import { StackedBarChart } from '../components/charts/StackedBarChart';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Figure } from '../components/ui/Figure';
import { IdText } from '../components/ui/IdText';
import { SearchInput } from '../components/ui/SearchInput';
import { SectionHeader } from '../components/ui/SectionHeader';
import { SelectField, type SelectOption } from '../components/ui/SelectField';
import { Term } from '../components/ui/Term';
import { displayMoneySummary, displayMoneyTable } from '../lib/displayMoney';
import { KPI_LABELS, routeDisplay, warehouseShortName } from '../lib/displayNames';
import { monthTableLabel, monthTooltipLabel, partialMonthNote } from '../lib/monthLabels';
import { ON_TIME_TARGET, onTimeTone, targetFigureTone, utilizationTone } from '../lib/targets';

/** The controls on this page show a state; they do not change it. */
export const noop = (): void => {};

/** The day the samples are dated (the demo's day). */
const TODAY = '2026-10-07';

/** One part of the system: a section named by its h2, and at most one note under its rule, before the samples. */
export function Block({ id, title, note, children }: { id: string; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="design-sheet__block" aria-labelledby={id}>
      <SectionHeader id={id} title={title} />
      {note !== undefined && <p className="design-sheet__note">{note}</p>}
      {children}
    </section>
  );
}

const RANGE_OPTIONS: SelectOption[] = [
  { value: '180d', label: '180d' },
  { value: '30d', label: '30d' }
];

/** A two-column table of samples: what it is, then how it reads. */
interface Sample {
  kind: string;
  example: ReactNode;
  rule: string;
}

const SAMPLE_COLUMNS: Column<Sample>[] = [
  { key: 'kind', header: 'Kind', render: (r) => r.kind },
  { key: 'example', header: 'Example', render: (r) => r.example, wrap: true },
  { key: 'rule', header: 'Rule', render: (r) => r.rule, wrap: true }
];

// Every example is written by the function the pages call, from these cents, ratios and days.
const NUMBER_FORMATS: Sample[] = [
  { kind: 'Money, a summary', example: `${displayMoneySummary(3_264_337_148)} · ${displayMoneySummary(60_012_345)}`, rule: 'A figure and its detail line: compact with one decimal from $10,000, whole dollars below.' },
  { kind: 'Money in a table', example: displayMoneyTable(76_516_680, 'amount'), rule: 'An amount (a value, a total): to the dollar.' },
  {
    kind: 'Price',
    example: `${displayMoneyTable(61_707, 'price')} · avg ${displayMoneyTable(128_504, 'price')} per shipment`,
    rule: "One unit, one shipment's cost or the average per shipment: to the cent, on a figure too."
  },
  { kind: 'Percent', example: `${formatPercent(0.902)} · ${formatPercent(ON_TIME_TARGET, 0)} target`, rule: 'Measured: one decimal, in a share column too. A target or a threshold: whole.' },
  { kind: 'Duration', example: formatDays(3.1), rule: 'Days to one decimal.' },
  { kind: 'Date', example: formatDay(TODAY), rule: 'Month, day and year. In every table a date keeps proportional figures: it is read, not compared.' },
  {
    kind: 'No value',
    example: (
      <>
        <span className="data-table__no-value" aria-hidden="true">
          —
        </span>
        <span className="visually-hidden">No value</span>
      </>
    ),
    rule: 'A dash in the quietest ink; a screen reader hears "No value".'
  },
  {
    kind: 'Month to date',
    example: monthAxisLabels(['2026-09', '2026-10'], TODAY.slice(0, 7)).join(' · '),
    rule: `The axis marks it; under the chart: "${partialMonthNote(['2026-10'], TODAY)}" A table row reads "${monthTableLabel('2026-10', TODAY)}", a tooltip "${monthTooltipLabel('2026-10', TODAY)}".`
  }
];

export function NumberFormatsBlock() {
  return (
    <Block id="design-numbers" title="Number formats" note="One way to write each kind of number, from the client's formatters. Tabular figures where numbers line up or change in place.">
      <DataTable caption="Number formats" columns={SAMPLE_COLUMNS} rows={NUMBER_FORMATS} rowKey={(r) => r.kind} stackedRows />
    </Block>
  );
}

/** A gauge as the Dashboard and Analytics draw it: the share on a neutral track, the target tick. */
function Gauge({ rate }: { rate: number }) {
  const style = { ['--rate' as string]: `${(rate * 100).toFixed(2)}%`, ['--target' as string]: `${ON_TIME_TARGET * 100}%` } as CSSProperties;
  return <span className="stage-gauge" style={style} aria-hidden="true" />;
}

export function TargetToneBlock() {
  const below = 0.856;
  const onTarget = 0.92;
  return (
    <Block
      id="design-target"
      title="Target tone"
      note="A number with a target is plain ink on target, amber below it and red below its floor (on time under 80%, utilization over 100%). Only the number takes the tone: its label, detail and gauge stay as they are, and being below target is also said in words."
    >
      <div className="surface-stage design-sheet__stage analytics-stage">
        <ul className="figure-stage__figures">
          <Figure value={formatPercent(below)} label="Below target" detail={`below the ${formatPercent(ON_TIME_TARGET, 0)} target`} tone={targetFigureTone(onTimeTone(below))}>
            <Gauge rate={below} />
          </Figure>
          <Figure value={formatPercent(onTarget)} label="On target" detail="at or above the target" tone={targetFigureTone(onTimeTone(onTarget))}>
            <Gauge rate={onTarget} />
          </Figure>
        </ul>
      </div>
      <ul className="meter-list">
        {[0.924, 0.851].map((u) => {
          const tone = utilizationTone(u);
          return (
            <li key={u} className="meter-list__item">
              <span className="meter-list__label">{tone === 'neutral' ? 'Under 90% full' : 'From 90% full'}</span>
              <span className="meter meter--neutral" aria-hidden="true">
                <span className="meter__bar" style={{ width: `${u * 100}%` }} />
              </span>
              <span className={tone === 'neutral' ? 'meter-list__value' : `meter-list__value meter-list__value--${tone}`}>{formatPercent(u)}</span>
            </li>
          );
        })}
      </ul>
    </Block>
  );
}

export function MarksBlock() {
  return (
    <Block
      id="design-marks"
      title="Marks"
      note="One mark for a status or a severity: an 8px square with a 1px radius, in its tone; the word beside it tells the levels apart. Where states share a tone its form tells them apart: solid, hatched (not started) or hollow (ended). No circles, no triangles."
    >
      <div className="design-sheet__row">
        <Badge tone="neutral" mark="hatched">
          Pending
        </Badge>
        <Badge tone="neutral">In transit</Badge>
        <Badge tone="good">Delivered</Badge>
        <Badge tone="neutral" mark="hollow">
          Cancelled
        </Badge>
        <Badge tone="critical">Critical</Badge>
        <Badge tone="warning">Warning</Badge>
      </div>
    </Block>
  );
}

export function FilterBarBlock() {
  return (
    <Block
      id="design-filter-bar"
      title="Filter bar"
      note="Fields fill grid columns, never a width of their own: a select spans 2 columns and a search 4 from 1100px, 3 and 6 from 768px, 6 and the whole row below. The faint columns behind are the grid."
    >
      <div className="design-sheet__overlay-host">
        <div className="design-sheet__overlay" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
        <div className="filter-bar filter-bar--grid">
          <div className="filter-bar__select">
            <SelectField label="Range" value="180d" options={RANGE_OPTIONS} onChange={noop} />
          </div>
          <div className="filter-bar__select">
            <SelectField label="Status" value="180d" options={RANGE_OPTIONS} onChange={noop} />
          </div>
          <div className="filter-bar__select">
            <SelectField label="Carrier" value="180d" options={RANGE_OPTIONS} onChange={noop} />
          </div>
          <div className="filter-bar__search">
            <SearchInput label="Search" value="" onChange={noop} placeholder="ID, route or carrier" />
          </div>
        </div>
      </div>
    </Block>
  );
}

/** A few shipments for the table samples. */
interface ShipmentRow {
  id: string;
  route: string;
  carrier: string;
  eta: string | null;
  cents: number;
}

const SHIPMENTS: ShipmentRow[] = [
  { id: 'SHP-100065', route: 'ATL → BOS', carrier: 'Northline', eta: '2026-10-09', cents: 90_819 },
  { id: 'SHP-100138', route: 'DFW → HOU', carrier: 'Coastal Freight', eta: null, cents: 54_508 },
  { id: 'SHP-100200', route: 'EWR → ORD', carrier: 'Northline', eta: '2026-10-12', cents: 128_504 }
];

const SHIPMENT_COLUMNS: Column<ShipmentRow>[] = [
  { key: 'id', header: 'ID', sortable: true, render: (r) => <IdText text={r.id} /> },
  { key: 'route', header: 'Route', render: (r) => r.route },
  { key: 'carrier', header: 'Carrier', render: (r) => r.carrier },
  { key: 'eta', header: 'ETA', sortable: true, render: (r) => (r.eta === null ? null : formatDay(r.eta)) },
  { key: 'cost', header: 'Cost', align: 'right', render: (r) => displayMoneyTable(r.cents, 'price') }
];

export function TableVariantsBlock() {
  const sort = { key: 'eta', direction: 'asc' as const };
  return (
    <Block
      id="design-table-variants"
      title="Table variants"
      note="An ID is a link (accent, underlined on hover) only where it opens a detail; SCC has no detail pages yet, so an ID is text that keeps its line (IdText)."
    >
      <p className="design-sheet__note">Default: a table to work in. Sortable columns, a row lights up under the pointer.</p>
      <DataTable caption="Shipments, default" columns={SHIPMENT_COLUMNS} rows={SHIPMENTS} rowKey={(r) => r.id} sort={sort} onSortChange={noop} />
      <p className="design-sheet__note">Static: a table to read (the Dashboard&apos;s recent activity). No sort buttons, even on a sortable column, no hover.</p>
      <DataTable caption="Shipments, static" columns={SHIPMENT_COLUMNS} rows={SHIPMENTS} rowKey={(r) => r.id} variant="static" />
      <p className="design-sheet__note">Compact: 32px rows, 4px above and below a cell and 8px beside it, for a short list inside a card.</p>
      <DataTable caption="Shipments, compact" columns={SHIPMENT_COLUMNS} rows={SHIPMENTS} rowKey={(r) => r.id} variant="static" density="compact" />
    </Block>
  );
}

export function StackedRowsBlock() {
  return (
    <Block
      id="design-stacked"
      title="Stacked rows"
      note="Below 768px each row is a record: its first cell alone at 14/600, then each label (12/600, muted) beside its value (14), 12px between the pairs, 16px and a hairline between the records. From 768px it is the table. An empty cell reads a dash."
    >
      <DataTable caption="Shipments, stacked on a phone" columns={SHIPMENT_COLUMNS} rows={SHIPMENTS} rowKey={(r) => r.id} variant="static" stackedRows />
    </Block>
  );
}

const MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const ON_TIME = [61, 66, 70, 64, 72, 18];
const DELAYED = [9, 12, 10, 14, 11, 3];

export function ChartCardBlock() {
  return (
    <Block
      id="design-chart-card"
      title="Chart card"
      note="One header line: the title (16/600) takes the room, the Table toggle keeps its width; one subtitle line is kept so the charts of a row start level. Axis text 12px muted, the axis a 1px line, horizontal gridlines only. Bars in one ink; colour only where it means something (red is late). Up to three series are named on the chart; from four, one legend row of 8px squares sits above it."
    >
      <ChartFrame
        title="On-time vs delayed by month"
        subtitle="Last 180 days"
        isEmpty={false}
        note={partialMonthNote(MONTHS, TODAY)}
        table={{ columns: ['Month', 'On time', 'Delayed'], rows: MONTHS.map((m, i) => [monthTableLabel(m, TODAY), ON_TIME[i] as number, DELAYED[i] as number]) }}
      >
        <StackedBarChart
          categories={MONTHS.map((m) => monthTooltipLabel(m, TODAY))}
          axisLabels={monthAxisLabels(MONTHS, TODAY.slice(0, 7))}
          series={[
            { name: 'On time', values: ON_TIME, tone: 'neutral' },
            { name: 'Delayed', values: DELAYED, tone: 'critical' }
          ]}
          valueFormat={(n) => n.toLocaleString('en-US')}
          ariaLabel="On-time vs delayed shipments by month, a sample"
        />
      </ChartFrame>
    </Block>
  );
}

export function TermsBlock() {
  return (
    <Block
      id="design-terms"
      title="Explanation line and terms"
      note='When a number differs from the same name on another page, one 14px muted line under it says why, starting "Differs from {Page}:". A term is an abbreviation with a dotted underline; its meaning opens on hover and on focus, and Escape closes it.'
    >
      <div>
        <p className="analytics-figure__value">{displayMoneySummary(60_012_345)}</p>
        <p className="explain-line">Differs from Shipments: last 180 days only, cancelled excluded.</p>
      </div>
      <p>
        <Term abbr="DIO">Days inventory outstanding: how many days today&apos;s stock lasts at the recorded usage rate (365 ÷ turnover).</Term>{' '}
        32.7 days · <Term abbr="ETA">Estimated arrival date. Delivered after it counts as late; still open after it counts as overdue.</Term> Oct 9 ·
        Oct 2026 <Term abbr="MTD">Month to date: Oct 1–7 only, so it isn&apos;t comparable with full months.</Term>
      </p>
    </Block>
  );
}

export function BadgeTitleBlock() {
  return (
    <Block id="design-badge-title" title="Badge title" note="A title only where the badge's words are cut short or are a term; a badge that says it all has none.">
      <div className="design-sheet__row">
        <Badge tone="neutral" title="Month to date: Oct 1–7 only, so it isn't comparable with full months.">
          MTD
        </Badge>
        <span className="design-sheet__note">with a title (a term)</span>
        <Badge tone="good">Delivered</Badge>
        <span className="design-sheet__note">without one</span>
      </div>
    </Block>
  );
}

const ROUTE = routeDisplay({ label: 'Atlanta DC → Boston, MA', originCode: 'WH-ATL', destinationCode: 'BOS', originName: 'Atlanta DC', destinationName: 'Boston, MA' });

const NAMES: Sample[] = [
  { kind: 'Warehouse in a list or a table', example: 'Dallas-Fort Worth DC', rule: 'The full name, from 768px.' },
  {
    kind: 'Warehouse on an axis, at 390px',
    example: <abbr title="Dallas-Fort Worth DC">{warehouseShortName('WH-DFW')}</abbr>,
    rule: 'The code without "WH-", with the full name as its title.'
  },
  { kind: 'Route', example: <span title={ROUTE.full}>{ROUTE.short}</span>, rule: `Codes everywhere; the full label ("${ROUTE.full}") only in a tooltip or an accessible name.` },
  { kind: 'KPIs', example: Object.values(KPI_LABELS).join(' · '), rule: 'One name each, on every page.' }
];

export function DisplayNamesBlock() {
  return (
    <Block id="design-display-names" title="Display names" note="One name for each thing, from one map in the client (lib/displayNames.ts); the data's codes do not change.">
      <DataTable caption="Display names" columns={SAMPLE_COLUMNS} rows={NAMES} rowKey={(r) => r.kind} stackedRows />
    </Block>
  );
}

export function FrameBlock() {
  return (
    <Block
      id="design-frame"
      title="Frame"
      note="The dark frame around every page. A sidebar link at rest, hovered and current (a 2px accent line and 600); the top bar's date, chip and Refresh; the target gauge (a 2px track, the share in ink, a 2 x 8px amber tick); and a disclosure, closed by default."
    >
      <div className="surface-stage design-sheet__stage design-sheet__frame">
        <ul className="design-sheet__list">
          <li>
            <a className="sidebar__link" href="#/_design">
              Inventory
            </a>
            <span className="design-sheet__note">at rest</span>
          </li>
          <li>
            <a className="sidebar__link" href="#/_design" data-state="hover" tabIndex={-1}>
              Inventory
            </a>
            <span className="design-sheet__note">hover</span>
          </li>
          <li>
            <a className="sidebar__link" href="#/_design" data-state="current" tabIndex={-1}>
              Inventory
            </a>
            <span className="design-sheet__note">current</span>
          </li>
        </ul>
        <div className="design-sheet__row">
          <span className="topbar__date">Data as of {formatDay(TODAY)}</span>
          <span className="topbar__chip">Sample data</span>
          <Button size="sm">Refresh</Button>
        </div>
        <Gauge rate={0.856} />
      </div>
      <details className="disclosure">
        <summary>How these are counted</summary>
        <p>A shipment is late when it is delivered after its ETA, and overdue when it is still open after it.</p>
      </details>
    </Block>
  );
}

/** The band's fields at rest, hovered, focused and unavailable (DESIGN.md "Fields"). */
interface BandRow {
  name: string;
  rest: ReactNode;
  hover: ReactNode;
  focus: ReactNode;
  off: ReactNode;
}

const choices = RANGE_OPTIONS.map((o) => (
  <option key={o.value} value={o.value}>
    {o.label}
  </option>
));

const BAND_ROWS: BandRow[] = [
  {
    name: 'Select',
    rest: (
      <select className="select-field__control" aria-label="Range on the band" value="180d" onChange={noop}>
        {choices}
      </select>
    ),
    hover: (
      <select className="select-field__control" aria-label="Range on the band, hover" value="180d" onChange={noop} data-state="hover" tabIndex={-1}>
        {choices}
      </select>
    ),
    focus: (
      <select className="select-field__control" aria-label="Range on the band, focus" value="180d" onChange={noop} data-state="focus" tabIndex={-1}>
        {choices}
      </select>
    ),
    off: (
      <select className="select-field__control" aria-label="Range on the band, disabled" value="180d" onChange={noop} disabled>
        {choices}
      </select>
    )
  },
  {
    name: 'Search',
    rest: <input className="search-input__field" type="search" aria-label="Search on the band" placeholder="Search" />,
    hover: <span className="design-sheet__note">—</span>,
    focus: <input className="search-input__field" type="search" aria-label="Search on the band, focus" placeholder="Search" data-state="focus" tabIndex={-1} />,
    off: <input className="search-input__field" type="search" aria-label="Search on the band, disabled" placeholder="Search" disabled />
  },
  {
    name: 'Secondary button',
    rest: <Button size="sm">Show all 25 lanes</Button>,
    hover: (
      <Button size="sm" data-state="hover" tabIndex={-1}>
        Show all 25 lanes
      </Button>
    ),
    focus: (
      <Button size="sm" data-state="focus" tabIndex={-1}>
        Show all 25 lanes
      </Button>
    ),
    off: (
      <Button size="sm" disabled>
        Show all 25 lanes
      </Button>
    )
  }
];

const BAND_COLUMNS: Column<BandRow>[] = [
  { key: 'name', header: 'Control', render: (r) => r.name },
  { key: 'rest', header: 'At rest', render: (r) => r.rest },
  { key: 'hover', header: 'Hover', render: (r) => r.hover },
  { key: 'focus', header: 'Focus', render: (r) => r.focus },
  { key: 'off', header: 'Unavailable', render: (r) => r.off }
];

/** The fields on the dark band (the Range on Analytics, the filters of Routes, Refresh, "Show all 25 lanes"). */
export function FieldsOnTheBand() {
  return (
    <>
      <p className="design-sheet__note">On the band: the same fields on the dark field fill with the band&apos;s edge, 36px tall (32px for a small button).</p>
      <div className="surface-stage design-sheet__stage">
        <DataTable caption="Fields on the band" columns={BAND_COLUMNS} rows={BAND_ROWS} rowKey={(r) => r.name} stackedRows />
      </div>
    </>
  );
}
