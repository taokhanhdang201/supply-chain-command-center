// The design reference (Phase 1 spec §10): the six type sizes, the colours and what they mean, the spacing scale, the
// twelve-column grid, and every component in every state, on one page for screenshots and review. Development builds
// only: AppLayout loads it at #/_design when import.meta.env.DEV, so neither this module nor design.css reaches the
// production bundle (tests/tester/designPage.browser.test.ts reads dist/). It is not one of ROUTES, reads no data, and its
// controls change nothing.

import { Fragment, type ReactNode } from 'react';
import { PageStage } from '../components/layout/PageStage';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Button, type ButtonVariant } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Figure, type FigureTone } from '../components/ui/Figure';
import { Pagination } from '../components/ui/Pagination';
import { SearchInput } from '../components/ui/SearchInput';
import { SectionHeader } from '../components/ui/SectionHeader';
import { SelectField, type SelectOption } from '../components/ui/SelectField';
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

/** DESIGN.md §3: a colour means one thing. */
const TONES: ReadonlyArray<{ token: string; name: string; meaning: string }> = [
  { token: '--critical', name: 'Critical', meaning: 'late, out of stock or blocking; the only red' },
  { token: '--warning', name: 'Warning', meaning: 'needs attention soon: low stock, a lane 10–19% delayed' },
  { token: '--neutral', name: 'Neutral', meaning: 'normal, in progress or unknown' },
  { token: '--good', name: 'Good', meaning: 'good or done: delivered, healthy, on target' },
  { token: '--color-accent', name: 'Accent', meaning: 'interaction and information: links, focus, the selected mark' }
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
      <PageStage title="Design system" variant="compact" context="Every token and component, in every state. Development builds only." />
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

          <Block id="design-color" title="Color">
            <ul className="design-sheet__list">
              {TONES.map((t) => (
                <li key={t.token}>
                  <span className="design-sheet__swatch" style={{ background: `var(${t.token})` }} />
                  <span>{t.name}</span>
                  <span className="design-sheet__note">{`${t.token} · ${t.meaning}`}</span>
                </li>
              ))}
            </ul>
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
              Each variant at md (36px) and sm (32px): default, disabled (opacity 0.45) and busy (aria-busy and disabled; the caller
              changes the label). Hover takes the fill one step darker (a link changes its ink); active goes one step further and never
              moves the button; focus shows the ring.
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

          <Block id="design-fields" title="Fields">
            <div className="design-sheet__row">
              <SelectField label="Range" value="180d" options={RANGE_OPTIONS} onChange={noop} />
              <SelectField label="Range, disabled" value="180d" options={RANGE_OPTIONS} onChange={noop} disabled />
              <SelectField label="Sort by, label hidden" value="180d" options={RANGE_OPTIONS} onChange={noop} hideLabel />
              <SearchInput label="Search" value="" onChange={noop} placeholder="SKU or product" />
              <SearchInput label="Search, with text" value="ELC-0015" onChange={noop} />
            </div>
            <p className="design-sheet__note">The third select hides its label from sight only: it stays the accessible name. A search with text offers Clear search.</p>
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

          <Block id="design-band" title="Page band">
            <p className="design-sheet__note">This page's own band is compact, with a context line. A slim band holds only its title, at most 64px (Data Import, Page not found):</p>
            <PageStage title="Data Import" variant="slim" />
          </Block>

          <Block id="design-chip" title="Chip">
            <div className="surface-stage design-sheet__stage design-sheet__row">
              <span className="topbar__chip">Sample data</span>
              <span className="topbar__chip">Inventory: carrier-export.csv</span>
            </div>
            <p className="design-sheet__note">
              While both sources are the generated sample, the top bar shows one Sample data chip that opens a note (this page's top bar
              has it). Once a file is imported, each source keeps its own chip.
            </p>
          </Block>
        </div>
      </div>
    </div>
  );
}
