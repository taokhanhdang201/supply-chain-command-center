# Supply Chain Command Center (SCC)

A single-process, full-stack TypeScript app for monitoring inventory, shipments, routes and supply-chain KPIs.
The server is the single source of truth: it generates deterministic sample data, accepts CSV imports, derives
every business flag (stock status, delivery state, cost anomalies, alerts) and serves a JSON snapshot that a
React SPA renders. Nothing sensitive or destructive happens client-side — the browser never sends structured
data rows, only raw CSV text for imports.

## Features

- **Dashboard** with KPI cards, a date-range selector, shipment-status/cost/on-time charts, and recent-activity
  and top-alert panels.
- **Inventory** table with search, warehouse/category/stock-status/stockout-risk filters, sorting and pagination.
- **Shipments** table with search, status/carrier/flag filters (delayed, missing dates, unusual cost, data
  issues), sorting and pagination.
- **Routes** page with a schematic US route map (warehouses and cities, color/width-coded lanes), a route list,
  a selected-route detail panel, and an "unmapped routes" table.
- **Analytics** page with warehouse/category/status/cost/on-time/route charts, computed supply-chain metrics
  (turnover, DIO, utilization, stockout risk), and a "how these are calculated" formula reference.
- **Alerts** page listing every derived alert (low stock, delayed shipments, cost anomalies, data issues,
  missing info) with severity/type/search filters and links back to the source record.
- **CSV import** for inventory and shipments, with server-side validation, an all-or-nothing replace policy, and
  row/column-level error reporting.
- **Deterministic sample data** (360 inventory records, 480 shipments) with intentionally injected anomalies so
  every alert and edge case is exercised out of the box.
- **Accessible, responsive UI**: keyboard-operable charts and route map, off-canvas nav drawer below 1024px,
  hand-written SVG charts and map (no chart/mapping dependency), and hash-linked filters that survive navigation.
- **Security-first design**: server-authoritative validation, strict CSP, no CORS, same-origin checks on every
  mutating request, and no runtime dependencies beyond React.

## Architecture

```
Browser (React SPA, hash routing)  --HTTP JSON / raw text/csv-->  Node server (node:http, no framework)
        |  renders + filters/sorts server-derived data                |  source of truth, in-memory store
        |  NEVER computes business flags                              |  parses + validates CSV, derives flags,
        v                                                             v  alerts, KPIs, metrics
               src/shared  (pure TypeScript domain: parsing, validation, rules, analytics, sample data)
```

- **`src/shared/`** — pure, framework-free, deterministic functions. No `Date.now()`, no I/O; "today" is always
  a parameter, so every rule is fully unit-testable in Node.
- **`src/server/`** — a `node:http` server (no Express/Fastify — five endpoints don't justify a framework's
  dependency surface). Holds the dataset in memory, exposes a small JSON API, accepts CSV uploads as raw
  `text/csv` bodies, re-validates everything server-side, and builds a `Snapshot` (rows + derived flags + alerts
  + KPIs + metrics). In dev it mounts Vite in middleware mode (one process, one port); in production it serves
  the built SPA from `dist/client`.
- **`src/client/`** — a React 19 SPA that fetches the `Snapshot` and renders it. Table search/filter/sort/
  pagination and chart date-range aggregation run client-side over already server-derived rows (the dataset is
  capped at 20,000 rows per type, so this is cheap and never duplicates business logic).

**Trust boundary:** the backend is authoritative and the browser is untrusted. All CSV parsing, validation,
derivation of flags, alerts and metrics happen on the server. Client-side checks on upload (extension, size,
emptiness) are UX conveniences only — the server repeats every one of them. Mutating endpoints are protected
against cross-site requests with a custom header plus an `Origin` check (see Security notes below).

**Persistence:** in-memory only. On start the server generates deterministic sample data; an import replaces the
corresponding dataset (inventory or shipments) in memory; a restart resets to sample data. See Known limitations.

## Tech stack

| Concern | Choice | Justification |
|---|---|---|
| Language | TypeScript (strict) | Type safety across the whole stack. |
| Runtime | Node 22, ESM | Given environment; developed against Windows as the primary desktop target. |
| HTTP server | `node:http` (built-in) | Five endpoints; a framework adds dependency surface for no real gain. |
| UI | `react`, `react-dom` | The only two runtime dependencies. A component model for a reusable UI. |
| Routing | Hand-written hash router | Seven static routes; hash routing needs no server-side fallback route. |
| Charts | Hand-written SVG components | Avoids a heavy chart library; full control of accessibility and CSP. |
| Map | Hand-written SVG schematic (lat/lon → x/y) | No API key required, works fully offline. |
| CSV parsing | Hand-written RFC 4180 parser | Small, linear-time, fully testable, no unsafe regex/eval features. |
| Styles | Plain CSS with custom properties | No Tailwind/CSS-in-JS dependency; CSP-friendly (no inline styles needed). |
| Build/dev | `vite`, `@vitejs/plugin-react` | Fast dev server + production bundle; also bundles the server. |
| TS runner (dev) | `tsx` | Runs `src/server/index.ts` directly with watch mode, cross-platform. |
| Tests | `vitest`, `jsdom`, Testing Library (`react`/`dom`/`user-event`/`jest-dom`) | Fast, Vite-native test stack. |
| Types | `typescript`, `@types/node`, `@types/react`, `@types/react-dom` | Static typechecking. |

No other packages are used. There is no ESLint; `tsc --noEmit` is the static gate.

## Requirements

- Node.js 22 or later
- npm (bundled with Node)

## Installation

```
npm install
```

## Running

### Development

```
npm run dev
```

Starts the server with Vite mounted in middleware mode (hot reload) at **http://127.0.0.1:3000**.

### Production

```
npm run build
npm start
```

`npm run build` typechecks, builds the client bundle to `dist/client`, and bundles the server to
`dist/server/index.js`. `npm start` runs the built server (defaults to http://127.0.0.1:3000).

### Environment variables

All are optional; copy `.env.example` to `.env` to override any of them, or set them directly in your shell.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | TCP port (1–65535). |
| `HOST` | `127.0.0.1` | Bind address. Requests are only answered for the `Host` names listed under "Host allowlist" in Security notes; with `HOST=0.0.0.0` you must browse to `0.0.0.0:<port>` itself, so other machines on your LAN get `421` (see below). |
| `SCC_SEED` | `42` | PRNG seed for generated sample data. |
| `SCC_TODAY` | (server's local date) | Fixes "today" (`YYYY-MM-DD`) for demos/tests. |
| `SCC_MAX_UPLOAD_BYTES` | `2097152` (2 MiB) | Max CSV upload size in bytes (1024–10,485,760). |

**PowerShell:**

```powershell
$env:PORT=4000; npm start
```

**Windows cmd:**

```cmd
set "PORT=4000" && npm start
```

(Quote the whole `NAME=value` assignment. Without the quotes, cmd.exe includes the space before `&&` in the
value — `PORT` becomes `"4000 "` with a trailing space — which fails validation and crashes the server.)

**`.env` file** (any OS): copy `.env.example` to `.env` and edit the values; the server loads it automatically
on startup if present.

## Running tests

```
npm test           # run once (CI mode)
npm run test:watch # watch mode
npm run typecheck  # tsc --noEmit only
```

The test suite covers: date/money/formatting edge cases (leap years, timezone-safety, rejected numeric/date
forms); the hand-written CSV parser and every field validator and its exact error codes/messages; every pure
domain rule (stock status, stockout risk, location resolution, delivery state, cost-anomaly scoring, KPIs,
metrics, alerts, analytics series, snapshot assembly); deterministic sample-data generation; the HTTP server
(config, security headers, same-origin checks, all five endpoints, static file serving including path-traversal
attempts); and the client (table/router helpers, UI primitives, charts, the app shell, and every page).

## CSV format

Imports are **all-or-nothing**: if any row or file-level error is found, nothing is imported, the existing
dataset is left untouched, and every error is reported back (up to 500, with a total count). A successful
import **replaces** the entire dataset of that kind (inventory or shipments) — it does not merge or upsert.

Numbers must be plain digits with an optional decimal point (no thousands separators, currency symbols,
scientific notation, or leading `+`). Dates must be `YYYY-MM-DD` and a real calendar date between 2000 and 2100.

> **Excel warning:** opening a CSV in Excel and saving it again rewrites `2026-08-15` as `8/15/2026` (on US
> Windows). Such files are rejected. The error for each slash date says Excel likely changed it and shows the
> `YYYY-MM-DD` equivalent. Upload the original file, or save dates as text in `YYYY-MM-DD`.

### Flexible column mapping (V1.5)

Files that already use SCC's column names import exactly as before, with no extra step (matching ignores case,
spaces and hyphens, and unknown extra columns are still ignored with a warning). Otherwise the Import page opens a
mapping step before anything is uploaded:

- Suggestions come from a fixed alias list (below). Matching is an **exact** match after normalizing case, spaces and
  punctuation. There is no fuzzy matching, and nothing is guessed.
- **Ambiguous** headers (`Cost`, `Avg Usage`; for shipments also `Date` and `Location`) are never auto-mapped: you
  must choose the SCC field. Two columns that both suggest the same field are also left for you to decide.
- You can change any mapping with the dropdown next to each column, and see a preview of the mapped rows.
- A **duplicate** mapping, a missing **required** field, or a column still undecided blocks the import.
- Columns set to "Do not import" are ignored (with an `Ignored unmapped column(s)` warning) and never read.
- Values are never changed: mapping only decides which column feeds which SCC field.
- All existing validation still runs, in the browser preview and again on the server, including the Excel
  `M/D/YYYY` date check.
- Shipments still require all nine columns (`estimated_delivery` and `actual_delivery` may have blank values).
- The mapping is used for that one upload and is not stored.

Inventory aliases (each canonical name is also accepted, e.g. `Unit Cost`, `unit-cost`):

| SCC field | Accepted alternative headers |
|---|---|
| `sku` | Item Code, Product ID, Material Number, Material Code |
| `product_name` | Product, Item Description, Product Description |
| `category` | Product Category |
| `warehouse` | WH, Plant, Plant Code, Location |
| `quantity` | Qty, On Hand, On Hand Qty, Available Qty, Stock Qty, Inventory Balance, Available Stock |
| `reorder_point` | Reorder Level, ROP |
| `unit_cost` | Unit Price, Price, Standard Cost |
| `avg_daily_usage` | Daily Usage, Daily Consumption, Average Daily Demand, Average Daily Usage |
| `lead_time_days` | Lead Time, Supplier Lead Time |

Shipment aliases:

| SCC field | Accepted alternative headers |
|---|---|
| `shipment_id` | Shipment Number, Load ID |
| `origin` | Origin Location, From |
| `destination` | Destination Location, To |
| `carrier` | Transporter, Logistics Provider |
| `status` | Shipment Status |
| `ship_date` | Shipping Date, Dispatch Date |
| `estimated_delivery` | ETA, Expected Delivery |
| `actual_delivery` | Delivery Date, Delivered Date |
| `shipping_cost` | Freight Cost, Transport Cost |

### Inventory columns (`public/templates/inventory-template.csv`)

| Column | Required | Format | Example |
|---|---|---|---|
| sku | yes | letters, digits or hyphens (3–32 chars) | `ELC-9001` |
| product_name | yes | text, up to 120 characters | `Wireless Barcode Scanner` |
| category | yes | text, up to 60 characters | `Electronics` |
| warehouse | yes | a known warehouse code | `WH-DFW` |
| quantity | yes | whole number, 0–10,000,000 | `120` |
| reorder_point | yes | whole number, 0–10,000,000 | `40` |
| unit_cost | yes | decimal dollars, 0–1,000,000.00 | `89.50` |
| avg_daily_usage | optional | decimal, 0–1,000,000, up to 2 decimals | `6.5` |
| lead_time_days | optional (default 14) | whole number, 1–365 | `14` |

Duplicate `SKU + warehouse` pairs are rejected; the same SKU in different warehouses is allowed.

### Shipment columns (`public/templates/shipments-template.csv`)

| Column | Required | Format | Example |
|---|---|---|---|
| shipment_id | yes | letters, digits or hyphens (3–32 chars) | `SHP-900001` |
| origin | yes | text, up to 64 characters | `WH-DFW` |
| destination | yes | text, up to 64 characters | `HOU` |
| carrier | yes | text, up to 60 characters | `Northstar Freight` |
| status | yes | `pending`, `in_transit`, `delivered` or `cancelled` | `delivered` |
| ship_date | yes | date, `YYYY-MM-DD` | `2026-03-02` |
| estimated_delivery | optional | date, `YYYY-MM-DD` | `2026-03-05` |
| actual_delivery | optional | date, `YYYY-MM-DD` | `2026-03-04` |
| shipping_cost | yes | decimal dollars, 0–1,000,000.00 | `812.40` |

Duplicate `shipment_id` values (case-insensitive) are rejected. Logically inconsistent rows (e.g. an actual
delivery date before the ship date) are **accepted** on import — they surface as `invalid_data` alerts instead
of being silently dropped, so bad data stays visible.

### Example error messages

```
Line 4, column quantity: "1,234" is not a valid number. Use digits with an optional decimal point, e.g. 1250.50
(no currency symbols, thousands separators or spaces).
Line 7, column warehouse: Unknown warehouse "WH-XXX". Valid codes: WH-ATL, WH-DFW, WH-EWR, WH-LAX, WH-ORD.
Line 1: Missing required column(s): sku. Found columns: product_name, category, warehouse.
Line 9, column sku: Duplicate SKU + warehouse "ELC-9001 @ WH-DFW" (first seen on line 2).
```

Limits: 20,000 data rows and 50 columns per file, 2 MiB upload by default (configurable), and at most 500
errors returned (the response also reports the true total count).

## Analytics formulas

All money is stored as integer cents; ratios are `0..1` displayed as percentages.

- **Inventory value** = `quantity × unit cost`. **Stock status**: `out_of_stock` at quantity 0, `low_stock` at
  or below the reorder point, else `in_stock`. **Days of supply** = `quantity / avgDailyUsage` (`null` when
  usage is unknown or 0). **Stockout risk**, evaluated in this order: `high` at zero quantity (regardless of
  usage); `unknown` when usage is unknown; `low` when usage is exactly 0 but the item is in stock; otherwise
  from days of supply vs. lead time — `high` when days of supply is under the lead time, `medium` within a
  7-day safety buffer of the lead time, `low` otherwise.
- **Delivery state**: `on_time` when a delivered shipment arrived on or before its ETA, `late` when it arrived
  after; an open shipment past its ETA (vs. today) is `overdue`; missing dates or an actual delivery before the
  ship date make the state `unknown` (excluded from on-time accounting). Comparisons are whole-day granular —
  arriving exactly on the ETA day counts as on time.
- **Cost anomaly** uses a **modified z-score (Iglewicz–Hoaglin)** on median and MAD, upper-tail only (flagging
  only abnormally *expensive* shipments). Shipments are grouped by **route + carrier** first (different carriers
  can legitimately charge quite different per-mile rates on the same route, so mixing carriers into one peer
  group could flag a shipment as anomalous just for using a pricier carrier); a route/carrier pair with fewer
  than 8 shipments falls back to the route alone, and a route with fewer than 8 shipments falls back to a
  per-mile peer group; when even that is too small, no assessment is made. When MAD is 0 the score falls back to
  a mean-absolute-deviation scale. A shipment is flagged only when **both** its score is above 3.5 **and** its
  cost is at least **1.5× the peer median** (`COST_ANOMALY_MIN_RATIO` in `src/shared/constants.ts`; per-mile
  rate for the per-mile group). The second condition matters because a very tight peer group makes even a few
  percent of excess look statistically extreme: without it, ordinary ±10% price noise would be reported as
  "abnormally expensive" on roughly one dataset in three.
- **On-time delivery rate** = `onTime / (onTime + late)`, restricted to delivered shipments with a known
  on-time/late state; `null` when there is no denominator. **Average shipping cost/delivery time** exclude
  cancelled shipments and are `null` with zero eligible shipments.
- **Inventory turnover (annualized, estimated)** = `Σ(avgDailyUsage × 365 × unitCost) / Σ(inventory value)`,
  counting only items with recorded usage in the numerator, but **the whole inventory's value in the
  denominator** (not just the items with usage). This is an **honest approximation**: COGS is estimated from
  currently recorded daily usage at the current unit cost (not true historical cost of goods sold), and the
  current snapshot's inventory value stands in for average inventory, since no inventory history is stored. One
  consequence of the denominator's broader scope: when usage-data coverage is below 100%, the reported number
  reads lower than a turnover computed only over usage-covered items would. The Analytics page always shows the
  usage-data coverage ("n of m items") alongside the number so this is never a hidden discrepancy.
  **Days inventory outstanding** = `365 / turnover` (`null` when turnover is `null` or 0).
- **Warehouse utilization** = `units stored / warehouse capacity` (capacity from the static reference location
  list); it can exceed 100%, which is flagged both as a metric tone and as an `invalid_data` alert.
- **Time-series charts & recent activity**: "Shipping cost over time" and "Recent shipment activity" only ever
  show activity that has actually happened as of `today` — a delivered shipment's date is its `actualDelivery`,
  an in-transit shipment's is its `shipDate`, and a pending shipment only counts once its (possibly
  future-scheduled) `shipDate` has arrived. Future-dated shipments never appear, and the cost-over-time series
  never emits a month later than `today`'s; the current month is labeled "(MTD)" since it is necessarily partial (on chart axes it is shown as "Sep*" with a note under the chart).

## Alert rules

Every alert has a severity (`critical`/`warning`/`info`), a type, a title, a message, and a link back to its
source entity. Rules, in brief:

- **Low stock**: `critical` when a SKU@warehouse record is out of stock, `warning` when at or below its
  reorder point.
- **Shipment delayed**: `critical` when overdue by 7+ days, else `warning`; a shipment delivered late within the
  last 14 days gets an `info` "delivered late" alert.
- **Cost anomaly**: `critical` when the actual cost is 3× or more the expected baseline, else `warning`.
- **Missing info**: `warning` for a missing estimated or actual delivery date, `info` for inventory with no
  recorded average daily usage (excluded from stockout risk and turnover).
- **Invalid data**: one `warning` per data-consistency issue found on a shipment (e.g. actual delivery before
  ship date, same origin and destination, a $0 cost on a non-cancelled shipment), plus a `warning` for any
  warehouse over 100% utilization.

## Sample data & intentional anomalies

On first start (and on "restore sample data") the server deterministically generates 360 inventory records
across 5 warehouses/6 categories and 480 shipments across 30 fixed lanes, seeded by `SCC_SEED` (default 42).
Generation never depends on the current date — only the dates it produces shift with "today," so the same seed
always produces the same quantities, costs, carriers and anomaly placements.

Each lane has a single carrier (assigned deterministically per lane, not per shipment), because real lanes are
mostly single-carrier; drawing a carrier per shipment would let differences between carriers' per-mile rates
masquerade as cost anomalies. Shipments are spread evenly over the 30 lanes (15-16 each), so the "Top shipping
routes" chart by shipment count shows near-equal bars; that evenness is an artifact of the generator, not of real
data.

Per-shipment cost carries plain random variation of about ±10% around the lane's rate, and it is left as
generated: no step adjusts the sample data to keep the cost detector quiet. The detector itself is what keeps
that variation from being reported (a flagged shipment must also cost at least 1.5× its peers, see Analytics
formulas), and a test checks that seeds 0-999 produce no cost alerts beyond the injected ones.

A fixed set of anomalies is injected on top of that distribution so every alert type and edge case is
exercised out of the box: out-of-stock and low-stock items, items with no usage data, misconfigured reorder
points, overdue shipments (a mix of critical/warning), unusually expensive shipments, shipments missing an
actual or estimated delivery date, an actual-delivery-before-ship-date inconsistency, an in-transit shipment
that already has an actual delivery date, a $0-cost shipment, a same-origin-destination route, and two shipments
to unmapped locations (so the Routes page's "unmapped routes" table is never empty by default).

## Security notes

- **Trust boundary**: the server is authoritative; the client never sends structured data rows, only raw CSV
  text for imports, optionally with an `X-SCC-Column-Map` header (a comma list of canonical field names,
  whitelisted, 1024-char cap, never JSON) that only selects which column feeds which field; all values are then
  validated server-side exactly as before, regardless of what the client already checked.
- **Uploads**: raw request body, never written to disk or executed; `Content-Type` must be `text/csv`; size is
  enforced both by a `Content-Length` precheck and a streaming byte counter; strict UTF-8 decoding with NUL-byte
  rejection; row (20,000) and column (50) caps; per-field length caps; the filename is only ever used as a
  sanitized display label.
- **Parsing safety**: a hand-written linear-time CSV parser; all validation regexes are anchored with no nested
  quantifiers (no ReDoS); numbers are parsed via a whitelist regex plus integer-string arithmetic — never
  `eval`/`Function`; header-to-index mapping uses a `Map` (no prototype pollution risk).
- **XSS/injection**: React renders all text; there is no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or
  `new Function` anywhere in `src/` (checked by grep on every build/release). A strict
  Content-Security-Policy, `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` are sent on every
  production response.
- **CSV/formula injection**: the app has no CSV export today; the bundled templates are static files we author.
  Any future export feature must prefix cells starting with `= + - @ \t \r` with a leading `'`.
- **Cross-site requests**: the server binds to `127.0.0.1` by default; every mutating endpoint requires a
  custom `X-SCC-Request: 1` header (which forces a CORS preflight that always fails, since no CORS headers are
  ever sent) plus a matching `Origin` header when one is present.
- **Host allowlist (DNS rebinding)**: before routing, every request's `Host` header must be `127.0.0.1:<port>`,
  `localhost:<port>`, `[::1]:<port>`, or exactly the configured `HOST:<port>`; anything else gets a JSON `421`.
  Consequence: if you bind to all interfaces (`HOST=0.0.0.0`), the app is only reachable using the address you
  configured (`0.0.0.0:<port>`); a browser on another machine that sends `Host: 192.168.x.y:<port>` is refused
  with `421`. The check is strict, not a bug: it is what stops a malicious web page from reaching the local
  server through a rebound DNS name. Also, `Host` must include the port, so a server on port 80 needs the
  port to be explicit, and names are compared as-is (lowercase).
- **Static files**: path traversal is prevented by resolving and prefix-checking every requested path, and
  rejecting NUL bytes, backslashes and non-regular-file targets.
- **Errors**: unexpected failures return a generic 500 body; stack traces are only ever logged server-side.
  Validation error messages echo at most 40 characters of the offending value.
- **Dependencies**: the only runtime dependencies are `react` and `react-dom`.
- **Browser storage**: none is used anywhere in the app.

## Project structure

```
public/                       favicon, CSV import templates
src/
  shared/                     pure domain logic (parsing, validation, rules, analytics, sample data)
    csv/                      RFC 4180 parser, column schemas, field parsers, import functions
    mapping/                  column alias dictionary, mapping suggestions/validation
    domain/                   inventory/shipment enrichment, cost anomaly, metrics, alerts, analytics, snapshot
    reference/                warehouse/city/carrier/lane reference data, US outline polygon
    sample/                   PRNG and deterministic sample-data generator
  server/                     node:http server: config, http helpers, in-memory store, API, static files, app
  client/                     React SPA
    api/                      HTTP API client
    components/               layout, UI primitives, charts, the route map
    hooks/, lib/               table state helpers
    pages/                    the seven routed pages
    state/                    DataContext (snapshot loading/refresh)
    styles/                   design tokens, base styles, layout, component styles
tests/                         mirrors src/ (shared, server, client) plus shared test helpers
```

## Known limitations

- Data is in-memory only; it resets to freshly generated sample data on every restart.
- Single-user, no authentication — intended as a local tool bound to `127.0.0.1`.
- Inventory turnover is estimated from a current usage snapshot, not true historical cost of goods sold.
- The route map is a coarse schematic of the continental US; locations outside the reference list are listed
  separately as "unmapped" rather than drawn.
- Importing a file replaces the entire dataset of that kind rather than merging or upserting rows.
- All table search/filter/sort/pagination runs client-side over an already-capped dataset (20,000 rows/type).
- There is no CSV export feature.

## Future improvements

- A persistent database (SQLite or Postgres) instead of the in-memory store.
- Authentication and role-based access.
- Server-side pagination for very large datasets.
- Historical inventory snapshots to compute true turnover instead of a current-snapshot proxy.
- Merge/upsert import semantics as an alternative to full replace.
- CSV export, with formula-injection escaping for spreadsheet-unsafe leading characters.
- Per-lane carrier SLA tracking.
- Optional AI-assisted mapping suggestions behind the `MappingSuggester` interface (human confirmation and server validation still required).
- Real geocoding instead of the static reference location list.
