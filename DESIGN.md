# Supply Chain Command Center — Design Constitution



> This document defines the visual and interaction language of Supply Chain Command Center (SCC).

> Treat it as a design constraint when creating or modifying UI.

>

> The existing implementation in `src/client/styles/` is the primary source of truth.

> External design references are inspiration only. Do not copy their visual systems wholesale.



---



## 1. Product Identity



SCC is an operational supply-chain command center.



Its interface should feel:



\- operational

\- industrial

\- precise

\- analytical

\- information-dense

\- calm under pressure

\- editorial rather than decorative

\- technical without becoming visually noisy



The UI should help a user answer:



1\. What is happening?

2\. Where is it happening?

3\. What needs attention?

4\. What changed?

5\. What action should I take?



The interface is not a generic SaaS dashboard.



Do not redesign SCC into a card-heavy analytics product.



---



# 2. Core Visual Model



SCC uses a two-surface model.



## Dark Stage



The dark stage is the operational/instrument layer.



Typical uses:



\- sidebar

\- topbar

\- Dashboard Atlas scenes

\- maps

\- operational visualizations

\- dense monitoring surfaces



Core tokens:



\- `--ink-1000`

\- `--stage-bg`

\- `--stage-raised`

\- `--stage-field`

\- `--map-field`

\- `--stage-line`

\- `--stage-line-strong`

\- `--stage-text`

\- `--stage-text-2`

\- `--stage-text-3`



## The page band



Each page has one dark band at the top (`PageStage`):



\- the h1 (`--text-lg` at 600 on a 1.25 line, `--tracking-title`, display face), the only visible title of the page

\- at most one context line

\- at most one row of up to four figures, each 3 of 12 columns from 768px and 6 of 12 below; a fifth number goes into the context line



Height: at most 256px from 768px and 360px below it. The slim band (Data Import, Page not found) is at most 64px.



Never in the band: maps, charts, tables, filters or selects. No radial glow, decorative vertical lines or eyebrow dash. The top bar does not repeat the page title.



The Dashboard's Situation scene is the one exception: its map is the content, so it may be taller. Pages are brought to this rule one by one.



## Warm Light Floor



The light floor is the document/work surface.



Core tokens:



\- `--color-bg`

\- `--color-surface`

\- `--color-field`

\- `--color-border`

\- `--color-border-subtle`

\- `--color-line-strong`



The visual relationship is:



&#x20;   DARK OPERATIONAL FRAME

&#x20;           ↓

&#x20;   WARM PAPER WORK SURFACE

&#x20;           ↓

&#x20;   DATA / TABLE / ANALYSIS



Do not introduce a third major surface language without a strong reason.



---



# 3. Color Philosophy



## Primary Accent



SCC uses one operational blue.



Light surface:



`--color-accent: #2552c4`



Dark stage:



`--color-accent: #6e97ff`



Do not introduce arbitrary accent colors.



Blue communicates:



\- active state

\- interaction

\- information

\- focus

\- operational emphasis



## Semantic Colors



Use semantic colors only for semantic meaning.



### Good



`--good`: good or done (delivered, healthy, on target).



### Warning



`--warning`: needs attention soon (low stock, a lane 10–20% delayed; from 20% it is critical).



### Critical



`--critical`: late, out of stock or blocking. The only red.



### Information



`--info`: interaction and information (the accent). Only what acts or leads somewhere is blue: a route's arrow (→) is muted ink.



### Neutral



`--neutral`: normal, in progress or unknown. An unknown risk is neutral, never a warning.



### Shipment status



One table gives each shipment status its tone (`src/client/components/charts/statusTones.ts`), and every page that draws a status reads it: the badge on Shipments, the mark beside a status in the Dashboard's recent activity and the status bar on Analytics. Pending and in transit are neutral (normal, in progress), and so is cancelled (ended, nothing left to do); delivered is good (done). Late is a flag, not a status: the Delayed badge is critical. The server's statuses do not change; only their tone is chosen here, and #/_design shows the table. The three neutral statuses differ by the form of their mark (`STATUS_MARK`, same file): pending hatched (not moving yet), in transit solid, cancelled hollow (ended); delivered is solid in its own tone. The badge, the Dashboard's activity mark and both the part and the legend square of the Analytics status bar take that form.



## Target tone



A number measured against a target takes one of three looks (`targetFigureTone`, `utilizationTone` in `src/client/lib/targets.ts`), the same on every page:



\- on target: the number in its usual ink (good is not painted green);



\- below the target: `--warning`, on the number only (the on-time rate under 90%, warehouse utilization from 90% full);



\- below the floor: `--critical`, on the number only (the on-time rate under 80%, utilization over 100%).



The label, the detail line, a meter bar and the gauge keep their colours; being below target is also said in words ("below the 90% target"). The gauge under the on-time rate is a 2px track (`--stage-line-strong`), the share in ink (`--stage-text`) and a 2 x 8px `--warning` tick at the target. With nothing to rate the number is "—" in its usual ink and there is no gauge.



## Marks



One mark for a status or a severity: an 8px square with a 1px radius, in its tone. The word beside it tells the levels apart; colour never does it alone. Where states share a tone, the form of the square tells them apart: solid, hatched (2px stripes of the tone) or hollow (a 1px edge). There are no circles and no triangles: the Dashboard's alert and status marks, the badges, chart legends and the status bar all use the square.



Do not use semantic colors merely because they look attractive.



A red element should communicate risk/criticality.



A green element should communicate a positive/healthy state.



There is one red; do not add another. The server decides how severe something is; the UI maps that to these tones and never derives a tone of its own.



---



# 4. Surface Rules



SCC intentionally uses restrained surfaces.



Prefer:



\- hairline borders

\- whitespace

\- typography

\- alignment

\- section rules

\- data hierarchy



Avoid:



\- excessive cards

\- floating containers everywhere

\- large decorative shadows

\- excessive gradients

\- excessive rounded corners

\- decorative glassmorphism

\- unnecessary visual effects



Cards are allowed where they improve information grouping.



However, on `.surface-stage`, cards intentionally become much more minimal:



\- transparent

\- no radius

\- no heavy border

\- hairline separation



This distinction is part of SCC's visual language.



---



# 5. Borders and Lines



Lines are important structural elements.



Preferred:



\- 1px borders

\- subtle hairlines

\- section-top rules

\- section-bottom rules

\- small accent rules



Avoid:



\- thick decorative borders

\- multiple nested borders

\- heavy outlines around every element



Use existing tokens instead of hard-coding new border colors.



One rule per boundary. A section on paper opens with its section header: the h2 over one 1px ink rule. Nothing under it draws a rule at its top (a chart, a formula, an empty or error state, the pagination): items inside a section each close with a hairline under them, and a table's last row closes the table. No rule stands alone under the page band, whose edge already ends it, and two rules never sit within 32px of each other.



The Dashboard keeps its own cut: its scenes are set apart by their surface (dark and paper), and where two paper scenes meet (Top alerts, then Flow) by one rule between them, so its scene titles carry no rule.



---



# 6. Radius



SCC intentionally uses near-square geometry.



Current tokens:



\- `--radius-sm: 2px`

\- `--radius-md: 3px`

\- `--radius-lg: 4px`



Do not introduce large rounded corners such as:



\- 12px

\- 16px

\- 24px



unless a specific interaction requires it.



The interface should feel industrial rather than playful.



---



# 7. Spacing



SCC follows a 4px spacing scale.



Primary tokens:



\- `--space-1: 4px`

\- `--space-2: 8px`

\- `--space-3: 12px`

\- `--space-4: 16px`

\- `--space-5: 20px`

\- `--space-6: 24px`

\- `--space-8: 32px`

\- `--space-10: 40px`

\- `--space-12: 48px`

\- `--space-16: 64px`

\- `--space-20: 80px`

\- `--space-24: 96px`

\- `--space-32: 128px`



Prefer these tokens.



Do not invent arbitrary spacing values unless there is a concrete layout reason.



---



# 8. Typography



SCC uses three primary font roles.



## Sans



`Inter Variable`



Use for:



\- body text

\- controls

\- navigation

\- general UI



## Display



`Archivo Variable`



Use for:



\- major numbers

\- KPI values

\- section titles

\- high-level operational figures

\- display hierarchy



## Monospace



Use the existing `--font-mono`.



Use for:



\- technical identifiers

\- formulas

\- raw/import data

\- technical values

\- code-like information



Do not randomly introduce additional fonts.



## Type scale



Six sizes, in rem so a larger default font still scales them. Do not add a seventh. Line heights are rem or unitless too, never px, so a larger default font grows each line with its text (the design ratchet counts px line heights: 0).



\- `--text-xs`: 0.75rem (12px), line height 1rem

\- `--text-sm`: 0.875rem (14px), line height 1.25rem

\- `--text-md`: 1rem (16px), line height 1.5rem

\- `--text-lg`: 1.5rem (24px), line height 2rem

\- `--text-xl`: 2.25rem (36px), line height 2.5rem

\- `--text-display`: clamp(3.5rem, 2.4vw + 3.2rem, 5.5rem), line height 0.9



Weights are 400, 500 and 600 only.



## Type roles



There are no role tokens. A rule sets its size with a `--text-*` step and, beside it, its line height (a `--leading-*` token, a rem value or a unitless number), its weight (400, 500 or 600) and, on titles and labels, a `--tracking-*` token. A `font` shorthand is fine, but it also resets font-stretch to 100% and font-variant-numeric, so numbers set with one add `font-variant-numeric: tabular-nums` after it. The roles as the stylesheets set them (#/_design shows the same table, checked against the rules):



\- label (field labels, table headers): `--text-xs`, 600, line 1.2, `--tracking-label`

\- control (buttons): `--text-sm`, 500, in a 36px box (a small button: `--text-xs` at 600, 32px)

\- body: `--text-md`, 400

\- table cell: `--text-sm`, 400, line 1.4; a detail line: `--text-sm`, 400

\- section title on paper (h2): `--text-lg`, 500, line 1.25, `--tracking-title`, display face

\- page title (h1): `--text-lg`, 600, line 1.25, `--tracking-title`, display face

\- figure: `--text-xl`, 600, line 1.1, display face, tabular figures

\- the Top alerts title: `--text-xl`, 600, line 1.15

\- display (the Dashboard's on-time rate): `--text-display`, 600, line 0.86, tracking -0.045em, display face



The page h1 is `--text-lg` at 600 (24px) in `--stage-text`. In the page band it sits on a 30px line. The Dashboard has no page band: its h1 heads the map scene, on the same 30px line from 1100px (32px below), so from 1100px the h1 sits on one baseline on every page but the slim band's. A section h2 on paper is lg at 500: it differs from the h1 by weight and place; the line over a table and an empty state's title use the same type. The Top alerts title is the one larger heading (36px, 600). Figures are `--text-xl` (36px).



No heading is smaller than the summary or detail line under it. Figures are the intended exception.



---



# 9. Numeric Data



Numbers are first-class UI elements in SCC.



Use:



`font-variant-numeric: tabular-nums`



when values need vertical alignment or comparison.



Running text keeps the font's proportional figures: no rule sets tabular-nums for the whole page. Tabular figures go where numbers sit in a column or change in place: the number cells of a table, figures, chart axes, counts in a list, the page counter. IDs (SHP-100138, ELC-0015) and names are text: with tabular figures Inter draws their hyphen as wide as a digit.



A date column keeps proportional figures in every table, the Dashboard's recent activity included: a date is read, not compared down a column.



A measured percent has one decimal everywhere, in a share column and an accessible description too (`90.2%`, `2.9%`); a target or a threshold is written whole (`the 90% target`, `20% or more`).



Important numeric values should have strong hierarchy.



Examples:



\- inventory quantity

\- shipment count

\- utilization

\- risk count

\- route metrics

\- analytical values



Do not make every number huge.



Large numbers are reserved for important hierarchy.



## Number formats



One way to write each kind of number (#/_design "Number formats" draws each with the function the pages call):



\- Money, a summary: `$32.6M`, `$600.1K` (see Money).



\- Money in a table: `$765,167`.



\- A price (one unit, one shipment's cost, the average per shipment): `$617.07`, `avg $1,285.04 per shipment`.



\- A percent: `90.2%` measured, `90%` for a target.



\- A duration: `3.1 days`.



\- A date: `Oct 7, 2026`.



\- No value: `—` in `--color-text-subtle`; a screen reader hears "No value" (visually hidden text: an aria-label on a plain span is not read).



\- The month to date: `Oct*` on a chart axis, the note "Oct* is month to date (Oct 1–7)." under the chart ("(Oct 1)" on the first day), `Oct 2026*` in a data table and "Oct 2026, month to date" in a tooltip (`src/client/lib/monthLabels.ts`). A range without the current month has no asterisk and no note.



## Money



Every money string of the client comes from one module, `src/client/lib/displayMoney.ts`. The snapshot's cents never change; only their rounding on screen does.



\- Summary (a figure and its detail line, the line over a table, money at risk in Top alerts, the labels and tooltips of the Dashboard cost chart): compact with one decimal from $10,000 (`$32.6M`, `$165.4K`, the `$8.0M` rack), whole dollars below. $9,999.50 is below the threshold and reads `$10,000`.

\- Amount in a table (a value, a total, every chart data table, the Analytics chart tooltips): whole dollars (`$1,403,217`).

\- Price (one unit, one shipment, or an average of those), in a table and on a figure: to the cent (`$617.07`, `$545.08`, `$1,996.73`, `avg $1,285.04 per shipment`). The cost of one shipment is a price, so the Cost column of a shipment table keeps its cents. What one shipment was billed above typical, in Top alerts, is a price too under $10,000 (`$517.07`): the Alerts page gives its cost and the typical cost to the cent. A sum over several shipments, or $10,000 and more, is a summary.

\- Chart axes keep their short format (`formatCentsAxis` in `src/shared/format.ts`). A value that rounds to zero reads `$0`, never `-$0`.



One place differs on purpose: the Dashboard cost chart labels a month as a summary (`$105.0K`) while its data table gives that month as an amount (`$105,031`). An average per shipment is a price wherever it is shown: `avg $1,285.04 per shipment` on the Dashboard and Analytics figures, `avg $1,996.73` for a lane.



Rounded cells need not add up to the rounded total: each Value cell rounds to the dollar on its own, while the line over the table rounds the exact sum.



---



# 10. Labels



Small labels use:



\- sentence case (never uppercase)

\- compact typography

\- increased letter spacing

\- muted color



Do not use uppercase or `text-transform: uppercase` for labels. The Dashboard is tested for zero uppercase text, and the rest of SCC follows the same rule as pages are revised.



Existing token:



`--tracking-label: 0.005em`



The technical/editorial feel comes from size, weight, color and alignment, not from capitals.



---



# 11. Dashboard Atlas



The Dashboard V2 Atlas is a central part of SCC's visual identity.



The Dashboard is organized around five conceptual scenes:



1\. Situation

2\. Attention

3\. Flow

4\. Nodes

5\. Movement



The dashboard uses a 12-column layout.



Its visual language emphasizes:



\- 1px rules

\- operational typography

\- large figures

\- visualization

\- dark stage surfaces

\- restrained color

\- information hierarchy



Do not convert Atlas into a conventional grid of identical cards.



The Dashboard should read as one operational scene rather than a collection of unrelated widgets.



---



# 12. Data Tables



Tables are core operational components.



Preferred characteristics:



\- compact rows

\- clear column hierarchy

\- sentence-case, muted headers (never uppercase)

\- hairline row separators

\- strong alignment

\- number columns right-aligned in tabular figures, header included (a stacked record keeps its numbers at the left, under their labels)

\- restrained hover states



Do not add:



\- excessive row shadows

\- rounded table containers everywhere

\- decorative gradients

\- oversized controls



Long free-text cells may wrap when necessary.



On mobile, tables should use the existing responsive strategies rather than simply shrinking everything.



## Table variants



`DataTable` has one look and three uses:



\- Default: a table to work in. Sortable columns say their direction (aria-sort) and a row lights up under the pointer.



\- Static (`variant="static"`): a table to read, such as the Dashboard's recent activity. No sort button, even on a sortable column, and no row hover.



\- Compact (`density="compact"`): 32px rows, cells 4px above and below and 8px beside, for a short list inside a card.



An ID is a link (accent, underlined on hover) only where it opens a detail. SCC has no detail pages yet, so an ID is text kept on one line (`IdText`), in every table.



## Stacked rows



Below 768px a table with `stackedRows` becomes records: the first cell alone on the first line at 14/600; then each label (its column header, 12/600, `--color-text-muted`) beside its value (14, tabular for numbers), 12px between the pairs; 16px and a 1px `--color-border-subtle` rule between the records. From 768px it is the table. The header row stays for assistive tech (explicit ARIA roles), and the visible labels are not read twice. An empty cell reads `—` and "No value". Pages adopt it in place of their own stacked layouts.



---



# 13. KPI Cards



KPI cards have two modes.



## Light Floor



They may behave as compact cards/sheets.



## Dark Stage



They should become visually lighter:



\- minimal or no border

\- no rounded container

\- large figure

\- hairline structure



KPI hierarchy matters more than decoration.



Use:



\- label

\- primary value

\- supporting detail

\- semantic state where appropriate



Do not add icons merely to fill empty space.



## Figures with a link



A figure that links to the filter it counts shows it at rest: its label carries a 1px underline in `--stage-line-strong`, 3px under the text, that turns to the label's ink (`--stage-text`) on hover and keyboard focus, with the pointer cursor. A figure without a link has no underline.



---



# 14. Buttons



Buttons should remain compact and functional.



Existing baseline:



\- approximately 36px height

\- restrained radius

\- thin border

\- clear text hierarchy



Primary buttons use the operational accent.



Ghost buttons remain quiet.



Danger buttons use the critical semantic color.



Do not turn every action into a primary button.



Hierarchy should communicate importance.



## Fields on the band



On the dark band (the Range on Analytics, the Routes filters, Refresh, "Show all 25 lanes") a select, a search and a secondary button keep their shape: the `--stage-field` fill, the band's field edge (`--color-border` there, 3.6:1 or more), 36px tall (32px for a small button). Their hover, focus and unavailable looks are the paper ones with the band's inks; #/_design shows all four.



## Filter bar



A filter bar sits on the 12-column grid (`.filter-bar--grid`): each field fills the columns of its cell (`.filter-bar__select`, `.filter-bar__search`) and has no width of its own. A select spans 2 columns and a search 4 from 1100px, 3 and 6 from 768px, 6 and the whole row below 768px.



---



# 15. Badges and Status



Badges are semantic UI.



They should communicate state, not decoration.



Existing statuses:



\- neutral

\- info

\- good

\- warning

\- critical



Status indicators use the one mark (see Marks): the 8px square, solid, hatched or hollow (`mark`).



A badge has a `title` only where its words are cut short or are a term ("MTD"); a badge that says it all has none.



Text must still communicate the meaning.



Do not rely on color alone.



---



# 16. Maps and Operational Visualizations



Maps are treated as instruments.



Route maps may use:



\- dark map field

\- grid

\- routes

\- nodes

\- endpoint markers

\- warning/critical routes

\- restrained halos



Do not turn operational maps into decorative illustrations.



Visualization should answer an operational question.



---



# 17. Charts



Charts should prioritize:



1\. readability

2\. comparison

3\. operational meaning

4\. consistency with tokens



Use the existing chart palette.



Do not introduce random colors for individual charts.



Chart geometry and data logic must remain separate from visual styling.



Do not change chart data/geometry merely to make a chart look prettier.



## Chart card



A chart card (`ChartFrame`) has a one-line header: the title (16/600) takes the room, and the toggle, the one word "Table" with aria-pressed, keeps its width and never pushes the title onto a second line. One subtitle line is kept whether or not there is a subtitle, so the charts of a row start level; a subtitle says what the range means ("Last 180 days").



Axis text is 12px `--color-text-muted`; the axis is a 1px `--color-line-strong` line; gridlines are horizontal only, 1px dotted `--color-border-subtle`. Bars are one ink (`--chart-1`); colour appears only where it means something (red is late, the status tones). Up to three series are named on the chart at the end of each series; from four, one legend row of 8px squares sits above the plot. Statuses that share the neutral tone keep their mark forms; `--chart-6` is a third neutral tint, so no colour has two names.



---



# 18. Motion



Motion is restrained.



Existing motion tokens:



\- `--dur-1`: 120ms (hover, small state changes)

\- `--dur-2`: 200ms (larger state changes, the drawer)

\- `--dur-draw`: 800ms (drawing data the first time: lanes, chart bars, gauges; off with reduced motion)

\- `--ease-out`



UI transitions use 120ms or 200ms only. A meter that moves to a new value (the Analytics warehouse utilization bars) is feedback, not drawing: it uses `--dur-2`. The loading skeleton (a 1.8s loop) is the one exception, and reduced motion stops it: each block is then one flat --color-border-subtle (the loop's first stop is the paper itself).



Use motion for:



\- hover feedback

\- state transitions

\- visualization movement

\- progressive reveal when useful



Do not animate:



\- ordinary text unnecessarily

\- every component

\- critical information

\- large decorative effects



Operational interfaces should feel stable.



---



# 19. Responsive Design



Responsive behavior is part of the design, not an afterthought.



Do not simply shrink desktop UI.



When necessary:



\- tables scroll

\- records transform into stacked layouts

\- controls wrap

\- grids collapse

\- navigation changes behavior

\- information hierarchy is preserved



Mobile should preserve meaning even when the layout changes substantially.



Existing SCC CSS contains explicit mobile transformations for tables, import mapping, and other dense operational interfaces.



Reuse those patterns.



---



# 20. Accessibility



Accessibility is part of the visual system.



Maintain:



\- visible focus states

\- semantic HTML

\- readable contrast

\- meaningful status text

\- keyboard-accessible controls

\- non-color-only status communication



Do not remove focus indicators for aesthetic reasons.



---



# 21. Component Reuse



Before creating a new component style:



1\. Search existing components.

2\. Search existing CSS primitives.

3\. Reuse existing tokens.

4\. Reuse an existing pattern if possible.

5\. Only introduce a new pattern when the existing system genuinely cannot express the requirement.



Avoid creating:



\- duplicate buttons

\- duplicate cards

\- duplicate badges

\- duplicate table styles

\- duplicate spacing systems

\- duplicate colors



## Section header



`SectionHeader` is the one section heading on paper: the h2 at 24/500 over a 1px `--color-text` rule, 12px above it and 24px before the content; actions at the right end of the rule; at most one subtitle (`subtitle`), under the rule and before the content, 14px `--color-text-muted`, at most 72ch. A results title over a table (`.table-summary`, "360 items · $32.6M") says what the table holds in the type of the h2.



## Explanation line and terms



When a number differs from the same name on another page, one line under it says why: 14px `--color-text-muted`, starting "Differs from {Page}:" ("Differs from Shipments: last 180 days only, cancelled excluded."). When the reason does not fit one clause: "{Page} shows {X} because it {reason}."



A term (`Term`) is an abbreviation (`<abbr>`) with a 1px dotted `--color-text-subtle` underline, in the Tab order. Its meaning opens in a tooltip (at most 280px, 14px) on hover and on keyboard focus; the pointer can move onto it without closing it, and Escape closes it. Each meaning stays under 120 characters:



\- DIO: "Days inventory outstanding: how many days today's stock lasts at the recorded usage rate (365 ÷ turnover)."



\- ETA: "Estimated arrival date. Delivered after it counts as late; still open after it counts as overdue."



\- MTD: "Month to date: {Mon} 1–{d} only, so it isn't comparable with full months."



## Display names



One name for each thing, from one map in the client (`src/client/lib/displayNames.ts`); the data's codes do not change.



\- A warehouse: its full name in a list or a table from 768px ("Dallas-Fort Worth DC"); its code on a chart axis and at phone width ("DFW", with the full name as its title). Never "WH-DFW" on screen.



\- A route: "ATL → BOS" everywhere; the full label ("Atlanta DC → Boston, MA") only in a tooltip or an accessible name. An unmapped end keeps its place name.



\- The KPIs: On-time rate, Shipping cost, Avg delivery time, Shipments, Inventory turnover, Days inventory outstanding (DIO).



## Frame



The frame around every page: the sidebar (a link at rest in `--color-sidebar-text`, hovered on a faint fill, current with a 2px accent line at its left and 600), the top bar (the date, one chip, Refresh), the target gauge (see Target tone) and the disclosure ("How these are counted"): a `<details>` closed by default, its summary 14/500 with a chevron that turns a quarter on opening, its content indented 16px. The sidebar's foot (the author and two outside links) sits outside the Main navigation landmark. A banner keeps its role when its state changes; an error it reports goes to a live region that is there from the first render.



---



# 22. CSS Rules



Prefer existing variables.



Good:



```css

color: var(--color-text-muted);

border-color: var(--color-border-subtle);

gap: var(--space-4);

border-radius: var(--radius-md);


