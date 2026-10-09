// The design reference at #/_design: the six type sizes and the type roles, the colors with their contrast on paper and on
// the band, the spacing scale, the 12-column grid, the shared components most pages use, with their states, and the tone of
// each shipment status. The hover, pressed and focus samples are static copies of the live rules (design.css;
// DesignPage.test.tsx compares them).
// Development builds only: AppLayout loads it at #/_design when import.meta.env.DEV, so neither this module nor design.css
// reaches the production bundle (tests/tester/designPage.browser.test.ts reads dist/). It is not one of ROUTES, reads no
// data, and its controls change nothing.

import { Fragment, type ReactNode } from 'react';
import { formatNumber, statusLabel } from '../../shared/format';
import type { ShipmentStatus } from '../../shared/types';
import { PageStage } from '../components/layout/PageStage';
import { ShareBar } from '../components/charts/ShareBar';
import { STATUS_TONE } from '../components/charts/statusTones';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Button, type ButtonVariant } from '../components/ui/Button';
import { DataTable, type Column } from '../components/ui/DataTable';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Figure, type FigureTone } from '../components/ui/Figure';
import { LoadingState } from '../components/ui/LoadingState';
import { Pagination } from '../components/ui/Pagination';
import { SearchInput } from '../components/ui/SearchInput';
import { SectionHeader } from '../components/ui/SectionHeader';
import { SelectField, type SelectOption } from '../components/ui/SelectField';
import { displayMoneyTable } from '../lib/displayMoney';
import '../styles/design.css';

/** The controls on this page show a state; they do not change it. */
const noop = (): void => {};

/** DESIGN.md §8: six sizes, each the size of one type role. */
const TYPE_SIZES: ReadonlyArray<{ token: string; px: string; role: string }> = [
  { token: '--text-xs', px: '12px', role: 'label' },
  { token: '--text-sm', px: '14px', role: 'control, detail line' },
  { token: '--text-md', px: '16px', role: 'body' },
  { token: '--text-lg', px: '24px', role: 'title: the page h1; a section h2 at 500' },
  { token: '--text-xl', px: '36px', role: 'figure' },
  { token: '--text-display', px: '56–88px', role: 'display: the Dashboard on-time rate' }
];

/** One type role as its stylesheet rule sets it (DESIGN.md "Type roles"). DesignPage.test.tsx checks that the rule still
 *  declares every line of `css`. */
interface TypeRole {
  role: string;
  at16: string;
  css: readonly string[];
  selector: string;
  file: string;
}

const TYPE_ROLES: TypeRole[] = [
  {
    role: 'Label (fields, table headers)',
    at16: '12 / 14.4px, 600',
    css: ['font-size: var(--text-xs)', 'font-weight: 600', 'line-height: 1.2', 'letter-spacing: var(--tracking-label)'],
    selector: '.select-field__label',
    file: 'components.css'
  },
  { role: 'Control (a button)', at16: '14px, 500, in a 36px box', css: ['font-size: var(--text-sm)', 'font-weight: 500'], selector: '.button', file: 'components.css' },
  { role: 'Body', at16: '16px, 400', css: ['font-family: var(--font-sans)', 'font-size: var(--text-md)'], selector: 'body', file: 'base.css' },
  { role: 'Table cell', at16: '14 / 19.6px, 400', css: ['font-size: var(--text-sm)', 'line-height: 1.4'], selector: '.data-table', file: 'components.css' },
  { role: 'Detail line', at16: '14px, 400', css: ['font-size: var(--text-sm)'], selector: '.stage-figure__detail', file: 'pages.css' },
  {
    role: 'Section title (h2 on paper)',
    at16: '24 / 30px, 500',
    css: ['font: 500 var(--text-lg) / 1.25 var(--font-display)', 'letter-spacing: var(--tracking-title)'],
    selector: '.section-label',
    file: 'pages.css'
  },
  {
    role: 'Page title (h1)',
    at16: '24 / 30px, 600',
    css: ['font: 600 var(--text-lg) / 1.25 var(--font-display)', 'letter-spacing: var(--tracking-title)'],
    selector: '.page-stage__title',
    file: 'pages.css'
  },
  {
    role: 'Figure',
    at16: '36 / 39.6px, 600',
    css: ['font: 600 var(--stage-figure-size) / 1.1 var(--font-display)', 'font-variant-numeric: tabular-nums lining-nums'],
    selector: '.stage-figure__value',
    file: 'pages.css'
  },
  {
    role: 'Top alerts title (the one larger heading)',
    at16: '36 / 41.4px, 600',
    css: ['font-size: var(--fs-figure)', 'font-weight: 600', 'line-height: 1.15'],
    selector: '.atlas-page .attention__title',
    file: 'atlas.css'
  },
  {
    role: 'Display (the Dashboard on-time rate)',
    at16: '56–88px on 0.86, 600',
    css: ['font: 600 var(--fs-display) / 0.86 var(--font-display)', 'letter-spacing: -0.045em'],
    selector: '.atlas-page .hero__value',
    file: 'atlas.css'
  }
];

const ROLE_COLUMNS: Column<TypeRole>[] = [
  { key: 'role', header: 'Role', render: (r) => r.role },
  { key: 'at16', header: 'At 16px', render: (r) => r.at16 },
  { key: 'css', header: 'CSS', render: (r) => r.css.join('; '), wrap: true },
  { key: 'rule', header: 'Rule', render: (r) => `${r.selector} · ${r.file}` }
];

/** DESIGN.md §3: a color means one thing. `paper` and `band` are its WCAG contrast on the paper floor (--color-bg) and on
 *  the band (--stage-bg, where .surface-stage gives the token its dark value); DesignPage.test.tsx recomputes them from
 *  tokens.css. */
interface Swatch {
  token: string;
  name: string;
  meaning: string;
  paper: string;
  band: string;
}

const COLORS: Swatch[] = [
  { token: '--critical', name: 'Critical', meaning: 'late, out of stock or blocking; the only red', paper: '5.5:1', band: '6.2:1' },
  { token: '--warning', name: 'Warning', meaning: 'needs attention soon: low stock, a lane 10–20% delayed; from 20% it is critical', paper: '4.9:1', band: '9.2:1' },
  { token: '--neutral', name: 'Neutral', meaning: 'normal, in progress or unknown', paper: '6.5:1', band: '9.1:1' },
  { token: '--good', name: 'Good', meaning: 'good or done: delivered, healthy, on target', paper: '5.2:1', band: '8.7:1' },
  { token: '--color-accent', name: 'Accent', meaning: 'interaction and information: links, focus, the selected mark', paper: '5.7:1', band: '6.9:1' },
  { token: '--color-text', name: 'Text', meaning: 'titles, body text and figures', paper: '15.2:1', band: '15.9:1' },
  { token: '--color-text-muted', name: 'Muted text', meaning: 'labels, captions and detail lines', paper: '6.5:1', band: '9.1:1' },
  { token: '--color-text-subtle', name: 'Subtle text', meaning: 'the quietest notes', paper: '4.7:1', band: '5.4:1' },
  { token: '--color-border', name: 'Control edge', meaning: "a field's or a button's border", paper: '3.6:1', band: '3.7:1' }
];

/** The surfaces the colors sit on. */
const SURFACES: ReadonlyArray<readonly [token: string, name: string]> = [
  ['--color-bg', 'Paper floor'],
  ['--color-surface', 'Sheet'],
  ['--stage-bg', 'Band and frame']
];

const COLOR_COLUMNS: Column<Swatch>[] = [
  {
    key: 'name',
    header: 'Color',
    render: (c) => (
      <>
        <span className="design-sheet__dot" style={{ background: `var(${c.token})` }} />
        {c.name}
      </>
    )
  },
  { key: 'token', header: 'Token', render: (c) => c.token },
  { key: 'meaning', header: 'Meaning', render: (c) => c.meaning, wrap: true },
  { key: 'paper', header: 'On paper', align: 'right', render: (c) => c.paper },
  {
    key: 'band',
    header: 'On the band',
    render: (c) => (
      <span className="surface-stage design-sheet__on-band">
        <span className="design-sheet__dot" style={{ background: `var(${c.token})` }} />
        {c.band}
      </span>
    )
  }
];

/** DESIGN.md §7: the 4px scale. */
const SPACES: ReadonlyArray<readonly [string, number]> = [
  ['--space-1', 4],
  ['--space-2', 8],
  ['--space-3', 12],
  ['--space-4', 16],
  ['--space-5', 20],
  ['--space-6', 24],
  ['--space-8', 32],
  ['--space-10', 40],
  ['--space-12', 48],
  ['--space-16', 64],
  ['--space-20', 80],
  ['--space-24', 96],
  ['--space-32', 128]
];

const VARIANTS: ReadonlyArray<{ variant: ButtonVariant; name: string }> = [
  { variant: 'primary', name: 'Primary' },
  { variant: 'secondary', name: 'Secondary' },
  { variant: 'ghost', name: 'Ghost' },
  { variant: 'danger', name: 'Danger' },
  { variant: 'link', name: 'Link' }
];

const RANGE_OPTIONS: SelectOption[] = [
  { value: '180d', label: '180d' },
  { value: '30d', label: '30d' }
];

const FIGURES: ReadonlyArray<{ tone: FigureTone; value: string; label: string }> = [
  { tone: 'critical', value: '12', label: 'Critical' },
  { tone: 'warning', value: '20', label: 'Warning' },
  { tone: 'neutral', value: '480', label: 'Neutral' }
];

const BADGES: ReadonlyArray<{ tone: BadgeTone; label: string }> = [
  { tone: 'neutral', label: 'Neutral' },
  { tone: 'info', label: 'Info' },
  { tone: 'good', label: 'Good' },
  { tone: 'warning', label: 'Warning' },
  { tone: 'critical', label: 'Critical' }
];

/** DESIGN.md "Shipment status": the one table of status tones the pages read (statusTones.ts), as a table, its badges and the
 *  status bar. The bar's counts are a sample. */
interface StatusRow {
  status: ShipmentStatus;
  count: number;
}

const STATUS_SAMPLE: StatusRow[] = [
  { status: 'pending', count: 14 },
  { status: 'in_transit', count: 20 },
  { status: 'delivered', count: 433 },
  { status: 'cancelled', count: 13 }
];

const STATUS_COLUMNS: Column<StatusRow>[] = [
  { key: 'status', header: 'Status', render: (r) => statusLabel(r.status) },
  { key: 'tone', header: 'Tone', render: (r) => `--${STATUS_TONE[r.status]}` },
  { key: 'badge', header: 'Badge', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{statusLabel(r.status)}</Badge> }
];

/** The options of the select samples below. */
const RANGE_CHOICES = RANGE_OPTIONS.map((o) => (
  <option key={o.value} value={o.value}>
    {o.label}
  </option>
));

/** A state with no style of its own. */
const SAME = <span className="design-sheet__note">—</span>;

/** One control in its states: at rest (live), static copies of its hover, pressed and focus looks (data-state, design.css),
 *  then unavailable. */
interface StateRow {
  name: string;
  rest: ReactNode;
  hover: ReactNode;
  active: ReactNode;
  focus: ReactNode;
  off: ReactNode;
}

const STATE_ROWS: StateRow[] = [
  ...VARIANTS.map(
    ({ variant, name }): StateRow => ({
      name,
      rest: <Button variant={variant}>{name}</Button>,
      hover: (
        <Button variant={variant} data-state="hover" tabIndex={-1}>
          {name}
        </Button>
      ),
      active: (
        <Button variant={variant} data-state="active" tabIndex={-1}>
          {name}
        </Button>
      ),
      focus: (
        <Button variant={variant} data-state="focus" tabIndex={-1}>
          {name}
        </Button>
      ),
      off: (
        <Button variant={variant} disabled>
          {name}
        </Button>
      )
    })
  ),
  {
    name: 'Select',
    rest: (
      <select className="select-field__control" aria-label="Range" value="180d" onChange={noop}>
        {RANGE_CHOICES}
      </select>
    ),
    hover: (
      <select className="select-field__control" aria-label="Range, hover" value="180d" onChange={noop} data-state="hover" tabIndex={-1}>
        {RANGE_CHOICES}
      </select>
    ),
    active: SAME,
    focus: (
      <select className="select-field__control" aria-label="Range, focus" value="180d" onChange={noop} data-state="focus" tabIndex={-1}>
        {RANGE_CHOICES}
      </select>
    ),
    off: (
      <select className="select-field__control" aria-label="Range, disabled" value="180d" onChange={noop} disabled>
        {RANGE_CHOICES}
      </select>
    )
  }
];

const STATE_COLUMNS: Column<StateRow>[] = [
  { key: 'name', header: 'Control', render: (r) => r.name },
  { key: 'rest', header: 'At rest', render: (r) => r.rest },
  { key: 'hover', header: 'Hover', render: (r) => r.hover },
  { key: 'active', header: 'Pressed', render: (r) => r.active },
  { key: 'focus', header: 'Focus', render: (r) => r.focus },
  { key: 'off', header: 'Unavailable', render: (r) => r.off }
];

/** A few stock rows for the table sample: a unit price keeps its cents, a value rounds to the dollar (DESIGN.md "Money"). */
interface StockRow {
  sku: string;
  product: string;
  qty: number;
  unitCents: number;
}

const STOCK: StockRow[] = [
  { sku: 'ELC-0015', product: 'Barcode scanner', qty: 1240, unitCents: 61707 },
  { sku: 'ELC-0010', product: 'Thermal label printer', qty: 84, unitCents: 24550 },
  { sku: 'APP-0005', product: 'Work gloves', qty: 0, unitCents: 1240 }
];

const STOCK_COLUMNS: Column<StockRow>[] = [
  { key: 'sku', header: 'SKU', sortable: true, render: (r) => <a href="#/_design">{r.sku}</a> },
  { key: 'product', header: 'Product', render: (r) => r.product },
  { key: 'qty', header: 'Qty', sortable: true, align: 'right', render: (r) => formatNumber(r.qty) },
  { key: 'unit', header: 'Unit cost', align: 'right', render: (r) => displayMoneyTable(r.unitCents, 'price') },
  { key: 'value', header: 'Value', align: 'right', render: (r) => displayMoneyTable(r.qty * r.unitCents, 'amount') }
];

/** One part of the system: a section named by its h2. */
function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="design-sheet__block" aria-labelledby={id}>
      <SectionHeader id={id} title={title} />
      {children}
    </section>
  );
}

/** The design reference page. */
export function DesignPage() {
  return (
    <div className="page">
      <PageStage
        title="Design system"
        variant="compact"
        context="The type, color and spacing scales, the grid, and the shared components most pages use, with their states. Development builds only."
      />
      <div className="page-floor">
        <div className="design-sheet">
          <Block id="design-type" title="Type">
            <ul className="design-sheet__list">
              {TYPE_SIZES.map((t) => (
                <li key={t.token}>
                  <span style={{ fontSize: `var(${t.token})` }}>Lanes 32</span>
                  <span className="design-sheet__note">{`${t.token} · ${t.px} · ${t.role}`}</span>
                </li>
              ))}
            </ul>
          </Block>

          <Block id="design-roles" title="Type roles">
            <p className="design-sheet__note">
              No role tokens: each rule sets a size step and, beside it, its line height, weight and tracking. Line heights are rem
              or unitless, never px, so a larger default font grows the line with its text. Each row is checked against its rule.
            </p>
            <DataTable caption="Type roles" columns={ROLE_COLUMNS} rows={TYPE_ROLES} rowKey={(r) => r.selector} />
          </Block>

          <Block id="design-color" title="Color">
            <p className="design-sheet__note">
              A color means one thing. Contrast is WCAG, on the paper floor and on the band, where .surface-stage gives each token
              its dark value (a color with alpha is laid over the background first): text needs 4.5:1, a control&apos;s edge 3:1.
            </p>
            <ul className="design-sheet__list">
              {SURFACES.map(([token, name]) => (
                <li key={token}>
                  <span className="design-sheet__swatch" style={{ background: `var(${token})` }} />
                  <span>{name}</span>
                  <span className="design-sheet__note">{token}</span>
                </li>
              ))}
            </ul>
            <DataTable caption="Colors and their contrast" columns={COLOR_COLUMNS} rows={COLORS} rowKey={(c) => c.token} />
          </Block>

          <Block id="design-spacing" title="Spacing">
            <ul className="design-sheet__list">
              {SPACES.map(([token, px]) => (
                <li key={token}>
                  <span className="design-sheet__bar" style={{ width: `var(${token})` }} />
                  <span className="design-sheet__note">{`${token} · ${px}px`}</span>
                </li>
              ))}
            </ul>
          </Block>

          <Block id="design-grid" title="Grid">
            <p className="design-sheet__note">
              Twelve columns at every width. The gap is --grid-gap (16px, 24px from 1100px); the page is at most --content-max (1280px)
              inside the --gutter (16px, 32px from 768px, 48px from 1100px).
            </p>
            <div className="design-sheet__grid">
              {Array.from({ length: 12 }, (_, i) => (
                <span key={i} className="design-sheet__cell">
                  {i + 1}
                </span>
              ))}
            </div>
          </Block>

          <Block id="design-buttons" title="Buttons">
            <p className="design-sheet__note">
              Each variant at md (36px) and sm (32px): default, unavailable (aria-disabled at opacity 0.45: it keeps the focus and
              ignores clicks) and busy (aria-busy, unavailable too; the caller changes the label). States shows hover, pressed and
              focus.
            </p>
            {VARIANTS.map(({ variant, name }) => (
              <div key={variant} className="design-sheet__row">
                {(['md', 'sm'] as const).map((size) => (
                  <Fragment key={size}>
                    <Button variant={variant} size={size}>
                      {`${name} ${size}`}
                    </Button>
                    <Button variant={variant} size={size} disabled>
                      {`${name} ${size}, disabled`}
                    </Button>
                    <Button variant={variant} size={size} busy>
                      Saving…
                    </Button>
                  </Fragment>
                ))}
              </div>
            ))}
          </Block>

          <Block id="design-states" title="States">
            <p className="design-sheet__note">
              The control at rest is live: hover it, press it, Tab to it. The cells beside it copy its hover, pressed and focus looks
              (data-state, design.css), so one screenshot shows them all; a pressed control is hovered too. Unavailable: a button says
              it with aria-disabled and keeps its focus; a select is disabled. A dash: no style of its own for that state.
            </p>
            <DataTable caption="Interactive states" columns={STATE_COLUMNS} rows={STATE_ROWS} rowKey={(r) => r.name} />
          </Block>

          <Block id="design-fields" title="Fields">
            <div className="filter-bar">
              <SelectField label="Range" value="180d" options={RANGE_OPTIONS} onChange={noop} />
              <SelectField label="Range, disabled" value="180d" options={RANGE_OPTIONS} onChange={noop} disabled />
              <SelectField label="Sort by, label hidden" value="180d" options={RANGE_OPTIONS} onChange={noop} hideLabel />
              <SearchInput label="Search" value="" onChange={noop} placeholder="SKU or product" />
              <SearchInput label="Search, with text" value="ELC-0015" onChange={noop} />
            </div>
            <p className="design-sheet__note">
              Fields sit in a filter bar, as on Inventory, Shipments and Alerts: below 768px it is two columns and a search takes the
              whole row. The third select hides its label from sight only: it stays the accessible name. A search with text offers
              Clear search.
            </p>
          </Block>

          <Block id="design-links" title="Links">
            <p className="design-sheet__note">
              A link goes somewhere and is an a; an action in place is a Button (the link variant, under Buttons). On paper a link is
              .text-link, or the plain accent link of a table cell (under Table). On the Dashboard&apos;s dark map a stand-alone link
              is .dash-link, whose hairline underline darkens on hover. Each shows the focus ring.
            </p>
            <ul className="design-sheet__list">
              <li>
                <a className="text-link" href="#/_design">
                  Download the template
                </a>
                <span className="design-sheet__note">.text-link at rest</span>
              </li>
              <li>
                <a className="text-link" href="#/_design" data-state="focus" tabIndex={-1}>
                  Download the template
                </a>
                <span className="design-sheet__note">.text-link, focus</span>
              </li>
            </ul>
            <div className="atlas-page">
              <div className="scene--dark surface-stage design-sheet__stage">
                <ul className="design-sheet__list">
                  <li>
                    <a className="dash-link" href="#/_design">
                      Explore the lanes
                    </a>
                    <span className="design-sheet__note">.dash-link at rest</span>
                  </li>
                  <li>
                    <a className="dash-link" href="#/_design" data-state="hover" tabIndex={-1}>
                      Explore the lanes
                    </a>
                    <span className="design-sheet__note">.dash-link, hover</span>
                  </li>
                  <li>
                    <a className="dash-link" href="#/_design" data-state="focus" tabIndex={-1}>
                      Explore the lanes
                    </a>
                    <span className="design-sheet__note">.dash-link, focus</span>
                  </li>
                </ul>
              </div>
            </div>
          </Block>

          <Block id="design-table" title="Table">
            <p className="design-sheet__note">
              Number columns align right in tabular figures, header included; a sorted column says its direction (aria-sort) and shows
              its arrow. A unit price keeps its cents, an amount rounds to the dollar. Below 768px the first column stays put while the
              table scrolls sideways; a ledger stacks its rows instead, laid out by its page.
            </p>
            <DataTable
              caption="Stock, a sample"
              columns={STOCK_COLUMNS}
              rows={STOCK}
              rowKey={(r) => r.sku}
              sort={{ key: 'qty', direction: 'desc' }}
              onSortChange={noop}
            />
          </Block>

          <Block id="design-pagination" title="Pagination">
            <Pagination page={1} pageCount={15} pageSize={25} total={360} start={1} end={25} onPageChange={noop} onPageSizeChange={noop} />
            <Pagination page={8} pageCount={15} pageSize={25} total={360} start={176} end={200} onPageChange={noop} onPageSizeChange={noop} />
          </Block>

          <Block id="design-section" title="Section header">
            <SectionHeader title="A section" />
            <SectionHeader title="A section with an action" actions={<Button size="sm">Export</Button>} />
          </Block>

          <Block id="design-empty" title="Empty state">
            <EmptyState title="No alerts — all clear." />
            <EmptyState title="No results match your filters" message="Try another search, or clear the filters." action={<Button>Clear filters</Button>} />
          </Block>

          <Block id="design-loading" title="Loading and error">
            <p className="design-sheet__note">
              While the first data loads, a page shows skeleton figures and rows (a screen reader hears &quot;Loading data…&quot;). If
              loading fails, the error state says so and offers Retry.
            </p>
            <LoadingState rowCount={3} />
            <ErrorState title="Could not load data" message="The server did not answer." onRetry={noop} />
          </Block>

          <Block id="design-figures" title="Figures">
            <div className="surface-stage design-sheet__stage">
              <ul className="figure-stage__figures">
                {FIGURES.map((f) => (
                  <Fragment key={f.tone}>
                    <Figure value={f.value} label={f.label} detail="No link" tone={f.tone} />
                    <Figure value={f.value} label={f.label} detail="A link to its filter" tone={f.tone} href="#/_design" />
                  </Fragment>
                ))}
              </ul>
            </div>
          </Block>

          <Block id="design-badges" title="Badges">
            <div className="design-sheet__row">
              {BADGES.map((b) => (
                <Badge key={b.tone} tone={b.tone}>
                  {b.label}
                </Badge>
              ))}
            </div>
          </Block>

          <Block id="design-status" title="Shipment status">
            <p className="design-sheet__note">
              One table gives each shipment status its tone (statusTones.ts), and every page that draws a status reads it: the badge
              on Shipments, the mark beside a status in the Dashboard&apos;s recent activity and the status bar on Analytics. Pending
              and in transit are neutral (normal, in progress), and so is cancelled (ended, nothing left to do); delivered is good
              (done). Late is a flag, not a status: the Delayed badge is critical.
            </p>
            <DataTable caption="Shipment status tones" columns={STATUS_COLUMNS} rows={STATUS_SAMPLE} rowKey={(r) => r.status} />
            <ShareBar
              data={STATUS_SAMPLE.map((r) => ({ key: r.status, label: statusLabel(r.status), value: r.count, tone: STATUS_TONE[r.status] }))}
              valueFormat={formatNumber}
              ariaLabel="Shipments by status, a sample"
            />
          </Block>

          <Block id="design-band" title="Page band">
            <p className="design-sheet__note">
              This page&apos;s own band is compact, with a context line. A slim band holds only its title, at most 64px (Data Import,
              Page not found). Drawn here with a paragraph for its title, so this page keeps one h1:
            </p>
            <div className="page-stage page-stage--slim surface-stage">
              <div className="page-stage__inner">
                <div className="page-stage__head">
                  <p className="page-stage__title">Data Import</p>
                </div>
              </div>
            </div>
          </Block>

          <Block id="design-chip" title="Chip">
            <div className="surface-stage design-sheet__stage design-sheet__row">
              <span className="topbar__chip">Sample data</span>
              <span className="topbar__chip">Imported data</span>
            </div>
            <p className="design-sheet__note">
              The top bar shows one chip at every width, a button that opens a note. While both sources are the generated sample it
              reads Sample data (this page&apos;s top bar has it); once a file is imported it reads Imported data, and its note names
              each source.
            </p>
          </Block>
        </div>
      </div>
    </div>
  );
}
