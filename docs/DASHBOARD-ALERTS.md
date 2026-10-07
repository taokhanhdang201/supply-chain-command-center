# Dashboard: Top alerts (the redesign first shipped as "Do these first")

Status: **built** (approved 2026-10-07 with the seven recommended options and four adjustments, section 8): `a2aba22` the
queue as pure functions (`src/client/lib/attention.ts`), `9183987` the Alerts page `kind=` filter, `071ebf2` the Dashboard
scene. Measured on the seed-42 sample dated 2026-10-07 with the code at `630d2b9` (a temporary probe, deleted after use).
The same evening the block moved to paper and took the title "Top alerts" again (section 9).
Goal: a manager sees in five seconds what to do first this morning. One sentence per row, no table, no jargon.

## 1. What the code does today (checked)

- **Order.** `buildAlerts` sorts by severity, then by a fixed type order (`low_stock` first), then by entity id
  (`src/shared/domain/alerts.ts:146-152`). The Dashboard shows the first five (`DashboardPage.tsx:158`). On seed 42 the
  top five are all "Out of stock", in SKU order: APP-0005, ELC-0001, ELC-0008, HLB-0002, HOM-0008.
- **Variety.** 20 alerts are critical: 6 out of stock, 6 shipments overdue 7+ days, 8 unusual costs. Because stock comes
  first in the type order, an overdue shipment or an unusual cost can never reach the top five while 5 stock items are
  critical.
- **Words.** Each row states a fact ("has 0 units (reorder point 377)"): no cost of the problem, no next step.
- **Numbers.** The big 20 / 37 / 10 repeats the KPI above it: 20 + 37 = 57 = "Alerts needing attention 57".
- **Links.** The five rows are **not links at all** (`DashboardPage.tsx:279-290`: a `<li>` with two paragraphs), so
  "looks unclickable" is literal. The Alerts page does link each alert to its record (`AlertsPage.tsx:75-82`).
- **All 67 alerts on seed 42:** stock 6 out + 14 low; shipments delayed 6 critical + 6 warning (overdue) + 6 info
  (delivered late); cost anomaly 8; missing info 13 (9 warning, 4 info); invalid data 8; over capacity 0.
- **"Need attention"** means critical + warning everywhere: the KPI tile (`DashboardPage.tsx:162`) and the sidebar badge
  (`AppLayout.tsx:92-95`) both count 57. Info alerts ask for no action (`AlertsPage.tsx:43`).

## 2. Alert types: data, damage, action

Money is valued at the unit cost SCC holds; SCC has **no selling price, no order value and no goods value per shipment**, so
no row claims lost revenue or profit. The main row stays short; the valuation and the formula are in the explanation under
the list ("How these are counted").

| Alert (today) | Data SCC has | Damage (formula) | What to do (derived) |
|---|---|---|---|
| Out of stock (`low_stock`, critical) | on hand, reorder point, avg daily usage, lead time, unit cost, the same SKU in other warehouses | **Short before restock** = N × unit cost, N = ⌈usage × lead time⌉ (on hand is 0) | Move or reorder N (section 3.2) |
| Low stock (`low_stock`, warning) | same, plus days of supply | **Short before restock** = N × unit cost, N = ⌈max(0, usage × lead time − on hand)⌉; zero when stock lasts until a reorder placed today arrives | Move or reorder N; the row also says "runs out in D days", D = whole days of supply, rounded down |
| Overdue shipment (`shipment_delayed`, critical ≥ 7 days, warning < 7) | carrier, route, days late; freight cost | **None in money.** Freight is not a loss and SCC has no goods value; the row says how many shipments and how late | **Ask for new dates** (one call per carrier) |
| Unusual cost (`cost_anomaly`) | shipping cost, typical cost (baseline), carrier | **Billed above typical** = Σ (shipping cost − typical cost) per carrier | **Check the invoices** |
| Delivered late (`shipment_delayed`, info), missing usage (`missing_info`, info) | | none | not in the queue (info: no action) |
| Missing dates (`missing_info`, warning), data issues (`invalid_data`) | which field is empty or wrong | none | not in the queue; counted as "incomplete or wrong records" |
| Over capacity (`invalid_data`, warehouse) | units vs capacity | none | not in the queue; counted as "warehouses over capacity" (none on seed 42) |

Not alerts today: lanes with 20%+ late shipments (7 on seed 42). They stay on the map and the Routes page.

## 3. The queue

### 3.1 Rows and order

1. **Money rows:** one per stock item with damage above zero, one per carrier with unusual costs, sorted by damage.
2. **At most 3 stock rows** while any other row exists; the cap gives way only when nothing else is left to show.
3. **Late row:** the carrier with the most shipments overdue 7+ days takes the **last slot** when any exists.
4. Five rows at most: up to 4 money rows plus the late row, or 5 money rows when no shipment is 7+ days overdue.
5. **Ties** (fixed): money rows: larger damage → critical before warning → fewer days of supply (carrier rows count as
   none) → more shipments → key A→Z, numeric-aware (`SKU@warehouse` or the carrier name; the compare `alerts.ts` uses).
   Late row: more shipments 7+ days late → oldest days late → carrier name A→Z.
6. An out-of-stock item with no usage data has no damage figure; it fills a free slot before the late row:
   "… is out of stock in X · usage unknown · Reorder N".
7. Empty: "Nothing needs action today."
8. **Colour = the alert's own severity** (red critical, amber warning), never the damage; the order is the damage. A carrier
   row is critical when any of its shipments is critical.

### 3.2 Move or reorder (adjustment 1, then the accuracy fix of the same day)

- **N = the whole units short before restock** = daily usage × lead time − on hand, rounded up (computed in hundredths of a
  unit, so 26.9 × 10 is 269, never 270). The money on the row is **N × unit cost**, and the action covers **exactly N**, so
  doing it ends the shortage the row prices. (First build: N was reorder point − on hand and the money used the fractional
  shortage; on seed 42 they only agreed by chance, 292 vs 291.7.) An item without usage data has no shortage figure; its N
  is reorder point − on hand. "Reorder now" when N is 0.
- **Can give** at another warehouse X holding the same SKU = X's on hand − X's own reorder point − 1: after giving it, X is
  still **above** its reorder point, so a move never creates a low-stock alert (low stock is "at or below the reorder point").
- **Source:** the warehouse that can give the most; equal → warehouse code A→Z.
- **It can give all of N:** "Move N from X".
- **It can give some (A < N):** "Move A from X, reorder B", with A + B = N. Never a bare "Move" that looks complete.
  Chosen over "Reorder N" because it says what helps before restock and what still has to be ordered, with both numbers.
- **None can give any:** "Reorder N".

### 3.3 Seed 42 (2026-10-07): new five vs current five

| # | New queue | Damage | The old Top alerts list | Its damage (same formula) |
|---|---|---|---|---|
| 1 | Compact Docking Station, Chicago: runs out in 12 days, restock takes 21 (amber) | $165,388.80 short (292 × $566.40) | Out of stock: APP-0005 (Classic Denim Jeans, Chicago) | $39,265 |
| 2 | Compact Webcam, Newark: out of stock (red) | $118,621 | Out of stock: ELC-0001 (Rugged Barcode Scanner, Chicago) | $91,795 |
| 3 | Rugged Barcode Scanner, Chicago: out of stock (red) | $91,795 | Out of stock: ELC-0008 (Compact Webcam, Newark) | $118,621 |
| 4 | Cascade Carriers: 4 shipments billed above typical (red) | $25,254 above typical | Out of stock: HLB-0002 (Enhanced Face Mask Pack, Chicago) | $5,089 (14th of 20 stock items) |
| 5 | Cascade Carriers: 4 shipments 7 to 20 days late (red) | no money figure | Out of stock: HOM-0008 (Heavy-Duty Cutting Board, Dallas) | $46,983 |

Actions: Docking Station is short 292 (34.7 × 21 − 437 = 291.7, rounded up); Atlanta can give 776 and Dallas-Fort Worth
309, so "Move 292 from Atlanta". Webcam is short 269 (26.9 × 10); Dallas-Fort Worth can give 681: "Move 269 from
Dallas-Fort Worth". Barcode Scanner is short 220 (22 × 10); Newark can give 560: "Move 220 from Newark". Each row's money is
N × unit cost: $165,388.80, $118,620.93 (269 × $440.97), $91,795.00 (220 × $417.25). SCC has no transfer time, so the row
says "Move", never "fixes". (Current-column damages above use the first build's formula.)

## 4. Copy (adjustment 2: short rows)

Pattern: **what · where** · **damage** · **action**, then the arrow. Money uses the Dashboard's compact format
(`formatCentsCompact`: $165.4K); the record shows the exact figure. Target: every row at most 2 lines at 1440 px.

- Out of stock: "Compact Webcam is out of stock in Newark · $118.6K short before restock · Move 269 from Dallas-Fort Worth"
- Low stock: "Compact Docking Station runs out in Chicago in 12 days · $165.4K short before restock · Move 292 from Atlanta"
- Another warehouse can give part: "… · Move 150 from Atlanta, reorder 142"
- Nothing to move: "… · Reorder 269"
- Unusual costs, several: "Cascade Carriers billed $25.3K above typical on 4 shipments · Check the invoices"
- Unusual cost, one: "BlueLine Logistics billed $11.3K above typical on SHP-100232 · Check the invoice"
- Late, several: "Cascade Carriers has 4 shipments 7 to 20 days late · Ask for new dates"
- Late, one: "Summit Express: SHP-100119 is 9 days late · Ask for a new date"
- No usage: "<Product> is out of stock in <warehouse> · usage unknown · Reorder <N>"
- Empty: "Nothing needs action today."
- Warehouse names drop " DC" ("Chicago DC" reads "Chicago").

**How these are counted** (a closed disclosure under the list; the valuation and formulas live here, not in the rows):
"Short before restock: the whole units usage will ask for before a reorder placed today can arrive, minus what is on hand
(daily usage × lead time − on hand, rounded up), valued at unit cost. SCC has no selling prices, so this is not lost revenue.
The action covers exactly those units: moved from another warehouse that keeps more than its own reorder point, and
reordered when no warehouse can give them all. Billed above typical: the cost over the usual cost for the same route and
carrier. Late deliveries have no money figure. Rows are ordered by money, with at most three stock rows; the carrier with the
most shipments 7 or more days late comes last. Colour shows severity."

On the Alerts page the kinds are the **Problem** filter (next to Severity and Type), so the reason a list is filtered is
always visible and Clear filters removes it.

## 5. Kinds line and the counts (adjustments 3 and 4)

The Attention block counts **only alerts that need attention** (critical + warning), the same 57 as the KPI tile and the
sidebar badge, so the screen never shows two totals for one thing. Info alerts (10 on seed 42: 6 delivered late, 4 missing
usage) ask for no action and stay on the Alerts page.

Kinds, in this order, each shown only when its count is above zero, each a link to the Alerts page filtered by `kind=`:

| Kind | Alerts | Label | Seed 42 |
|---|---|---|---|
| `out_of_stock` | `low_stock`, critical | out of stock | 6 |
| `low_stock` | `low_stock`, warning | low stock | 14 |
| `overdue` | `shipment_delayed`, critical or warning | overdue | 12 |
| `unusual_cost` | `cost_anomaly` | unusual cost(s) | 8 |
| `over_capacity` | `invalid_data` on a warehouse | warehouse(s) over capacity | 0 |
| `records` | `missing_info` or `invalid_data` on a shipment or item, critical or warning | incomplete or wrong record(s) | 17 (9 missing dates, 8 data issues) |

Seed 42: "6 out of stock · 14 low stock · 12 overdue · 8 unusual costs · 17 incomplete or wrong records" = 57. The link under
it reads **"View all alerts (57 need attention)"**: it opens all 67, and the number it names is the same 57 as the tile, the
badge and the line. ("27 to check" mixed actionable records with info alerts; it is gone.)

## 6. Mockup

Real Dashboard, real stage colours and fonts, seed 42, the section replaced in the browser for the screenshot (not app
code), reviewed before approval. Final screenshots come from the built app.

## 7. Files and tests

| File | Change | Core? |
|---|---|---|
| `src/client/lib/attention.ts` (new) | pure functions: `kindOf(alert)`, `kindCounts(alerts)`, `buildQueue(snapshot)` and the copy | no |
| `src/client/pages/DashboardPage.tsx` | the Top alerts scene: title, kinds line, the link rows, "How these are counted"; the 20/37/10 block goes | no |
| `src/client/pages/AlertsPage.tsx` | `?kind=` through the same `kindOf`, so a kind's count equals its rows | no |
| `src/client/styles/atlas.css`, `pages.css` | rows, hover, focus, kinds line, disclosure; `.alert-counts` removed | no |
| `src/shared/*` (incl. `domain/alerts.ts`) | **unchanged**, read only | core, not touched |

New tests: `tests/client/lib/attention.test.ts` (the seed-42 rows; each formula; every tie-break; carrier grouping; the
3-row stock cap and when it gives way; the reserved late slot; move vs reorder: spare exactly enough, spare short, several
warehouses with spare and equal spare; no usage; empty; kinds and the 57 total), Alerts page `kind=` filter, Dashboard rows
as links, and browser checks (each row at most 2 lines at 1440, rows focusable, 390 without sideways scroll, contrast).
Updated with the reason: `DashboardAtlas.design.test.tsx`, `DashboardAtlas.test.tsx`, `DashboardPage.test.tsx`,
`v16.ui.browser.test.ts`.

## 8. Decisions (approved by the owner, 2026-10-07)

1. Stock damage: short before a reorder placed today can arrive (option A).
2. Late shipments: the worst carrier takes the last slot (A).
3. Stock action: move when another warehouse can spare it, else reorder (B), with adjustment 1 (section 3.2).
4. One row per carrier (A).
5. At most 3 stock rows (A).
6. Kinds line linked to a `kind=` filter on the Alerts page (A), with adjustments 3 and 4 (section 5).
7. Title "Do these first" (A); renamed "Top alerts" the same evening, when the block moved to paper (section 9).

Adjustments: (1) move only from real spare, never below the source's own reorder point, fixed choice rule, tested;
(2) "$165.2K short before restock" in the row, the valuation and formula in "How these are counted", rows at most 2 lines at
1440 px; (3) "27 to check" replaced by labels that name the problem; (4) one count for "need attention" (57) across the
tile, the badge, the kinds line and the link.

Accuracy fix before the first push (owner, 2026-10-07): a source must stay **above** its reorder point after a move (no new
alert); N in the action is the whole units short before restock, the row's money is N × unit cost, and when no warehouse
can give all of N the action reads "Move A from X, reorder B" (A + B = N) or "Reorder N" (section 3.2). On seed 42 the
Docking Station row moved from $165.2K to $165.4K (292 whole units instead of 291.7); the actions did not change.

## 9. Top alerts on paper (owner, 2026-10-07 evening)

The four figures with "Shipments by status" and this block were two dark scenes in a row, joined with no gap
(`.scene--dark + .scene--dark`), so they read as one block. Three mockups on the built app (seed 42, CSS overridden in the
browser), at 1440 and 390 px, all at AA: A, a large gap and a full-width rule; B, A plus the eyebrow the other pages use;
C, the block on paper. The owner chose C, because dark is the situation and paper is what to act on.

- **On paper.** The block is a paper scene (`scene--paper`), the floor colour the Inventory and Shipments tables sit on.
  "Shipments by status" sits 24 px under the figures from 1100 px (was 32 px) and is the last line of the dark scene, so
  it reads as part of the figures.
- **Title "Top alerts"**, also the region's name (was "Attention"), the same size as the other section titles (31.52 px at
  1440, 24 px at 390). Code, tests and the README use the new name; "Do these first" stays only in this history.
- **Flow follows, also on paper:** one 1 px full-width rule (`--color-line-strong`) between the two; atlas.css now allows a
  rule between two paper scenes.
- **Colours: existing paper tokens, no new token.** Ink `--color-text`; the sentence, the separators, the info ring and the
  explanation `--color-text-muted` (#4a5360; `--color-text-subtle` #5f6875 fell to 4.11:1 on the 7% hover tint); actions,
  arrows and focus rings `--color-accent` and `--color-focus` (#2552c4); glyphs `--signal` (#b42318) and `--warning`
  (#9a5200).
- **Measured on paper #ecebe6** (on the hover tint #dddcd8 in brackets): action link 5.71 (4.96), red dot 5.51 (4.79),
  amber triangle 4.91 (4.27; a graphic needs 3:1), muted text and separators 6.52 (5.67). Tab through all 12 stops (five
  kinds, "View all alerts", five rows, "How these are counted"): every ring solid 2 px #2552c4, 5.71:1. "How these are
  counted" open: summary 15.21, text 6.52. No sideways scroll at 390.
- **Tests.** New: the block is paper (`DashboardAtlas.test.tsx`), paper inks only and the rule above Flow
  (`atlasCss.test.ts`), focus rings at 3:1 and text at AA, hovered and open (`v16.ui.browser.test.ts`). Updated with the
  reason: the h2 list and the region names (renamed), and the browser test's scene order (now dark, paper, paper, dark,
  paper).

## 10. The head of Top alerts (owner, 2026-10-07 night)

- **Title a step up.** The figure size from the type scale (`--fs-figure`: 38.4 px at 1440, 32 px at 390; the other
  section titles are `--fs-h2`, 31.52 px and 24 px), weight 600, never wraps. Under it, in muted ink: "Ranked by money at
  risk."
- **The kinds as a list.** One row each, label left in sentence case agreeing with the count ("Unusual costs", "Unusual
  cost" for one), the count right in one tabular column, ink like the label (severity is the five rows' job), no dots;
  21 rem wide so the eye's trip from label to count stays short. Each row is the Alerts page filtered to its kind
  (`kind=`), the whole row a link, 40 px tall (44 px on phones), named "Out of stock, 6, view in Alerts".
- **The total row** under a rule, in 600: "Need attention 57 →". It replaces "View all alerts (57 need attention)" and is
  named "57 need attention, view in Alerts"; 57 is the sum of the kind rows (tested). First drafted as "All alerts 57",
  renamed before shipping: the KPI tile right above says "67 total · 10 info", so "All alerts 57" said the wrong thing.
  It opens the Alerts page with `kind=any` ("Any problem" in its Problem filter): every kind together, exactly the 57,
  none of the 10 info alerts (`#/alerts` alone shows all 67). The "Alerts needing attention" KPI tile opens the same
  filter (it opened `#/alerts`, 67 rows under a "57"); both clicks are tested in a real browser.
- **One line per kind at every width.** From 1100 px the head spans five grid columns (it was four) and a row's gaps are
  8 px: with four columns "Incomplete or wrong records" wrapped below 1440 px (the 1280 px demo video showed it). The
  rows still start on column 6. Tested at 1440, 1280, 1100 and 390.
- **No rule between the kinds**, so no line sits level with a rule of the five rows beside them (the two lists do not
  match row for row); at 1440 the total's rule sits 40 px from the nearest row rule (tested: more than 8 px).
- **Measured** on paper: focus rings on all 12 stops solid 2 px #2552c4, 5.71:1; labels and counts ink 15.21:1; the
  muted line 6.52:1; no sideways scroll at 390.
- **Code.** `KindCount.text` ("6 out of stock") became `label` ("Out of stock"); the count stays `count`. Tests updated
  with the reason (the kind labels, the kinds list, the total link's name) and added (the total equals the sum of the
  kinds; the head's layout in a real browser).
