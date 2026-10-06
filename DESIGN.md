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



`--good`



### Warning



`--warning`



### Critical



`--critical`



### Information



`--info`



### Neutral



`--neutral`



Do not use semantic colors merely because they look attractive.



A red element should communicate risk/criticality.



A green element should communicate a positive/healthy state.



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



---



# 9. Numeric Data



Numbers are first-class UI elements in SCC.



Use:



`font-variant-numeric: tabular-nums`



when values need vertical alignment or comparison.



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

\- uppercase/muted headers

\- hairline row separators

\- strong alignment

\- tabular numbers

\- restrained hover states



Do not add:



\- excessive row shadows

\- rounded table containers everywhere

\- decorative gradients

\- oversized controls



Long free-text cells may wrap when necessary.



On mobile, tables should use the existing responsive strategies rather than simply shrinking everything.



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



Status indicators may use the small square marker already defined by the component system.



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



---



# 18. Motion



Motion is restrained.



Existing motion tokens:



\- `--dur-1`

\- `--dur-2`

\- `--dur-3`

\- `--ease-out`



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



---



# 22. CSS Rules



Prefer existing variables.



Good:



```css

color: var(--color-text-muted);

border-color: var(--color-border-subtle);

gap: var(--space-4);

border-radius: var(--radius-md);


