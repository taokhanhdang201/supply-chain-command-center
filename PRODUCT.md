# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences, one product:

- **Supply-chain operators** (inventory planners, transport coordinators) who check the app daily to see what is late, short, or anomalous and decide what to handle first. SCC is designed as a real tool for them.
- **Recruiters and technical reviewers** who meet SCC as a portfolio project through the live demo, the public repository, or a LinkedIn post, and judge it in a few minutes.

Design for the operator's job; the reviewer is convinced by seeing that job done well.

## Product Purpose

SCC monitors inventory, shipments, routes, and supply-chain KPIs in one place. The server is the single source of truth: it generates deterministic sample data, accepts imports, derives every business flag (stock status, delivery state, cost anomalies, alerts), and serves a snapshot the React SPA renders.

Success means an operator can open SCC and answer quickly: what needs attention, where, and what to do first, and a reviewer can see that answer on the first screen.

## Positioning

- **Import any shape of data.** Imports are not limited to one fixed template: SCC recognises columns, maps them to its model, and reports errors per column before anything is replaced (see `docs/ingestion/`).
- **"Do these first."** The dashboard ranks the work that needs action instead of only showing numbers (today: the Top alerts list, ranked by money at risk; README.md:13).

## Operating Context

- Pages: Dashboard, Inventory, Shipments, Routes, Analytics, Alerts, Import (`src/client/pages/`).
- Imports: the user chooses or drops a file, or tries a built-in sample; SCC reviews it, previews it, then imports all or nothing.
- Demo runs use a fixed seed and date (`SCC_SEED`, `SCC_TODAY`; README.md:123-124) so screenshots and recordings are reproducible.

## Capabilities and Constraints

- Server-authoritative: all parsing, validation, flags, alerts, and metrics are computed on the server; the browser never computes business flags.
- In-memory persistence; a restart resets to sample data.
- Only runtime dependencies are React and React DOM; charts and the route map are hand-written SVG and work offline.
- Strict CSP, same-origin checks on mutating requests, no CORS.
- Project rules: no new packages, no lint/format tools, no edits to `package.json`, `package-lock.json`, `tsconfig.json`, or the protected files listed in `tests/fixtures/ingest/protected-hashes.json`.
- Undecided: which additional import formats ship next (XLSX, EDI 214) is tracked in `docs/ingestion/`, not here.

## Brand Commitments

- Name: Supply Chain Command Center (SCC).
- Interface copy is English. The README is bilingual English–Vietnamese.

## Evidence on Hand

- Deterministic sample dataset only: 360 inventory records across 5 warehouses and 6 categories, 480 shipments across 30 fixed lanes, seeded by `SCC_SEED` (default 42), with intentionally injected anomalies (README.md:64).
- There are no real customers, users, testimonials, usage metrics, or production data. Future work must not invent them, and must not load real data.

## Product Principles

1. **Action before inventory.** Lead with what needs attention and what to do next; supporting numbers come after.
2. **The server decides.** Every flag, alert, and number shown is derived on the server; the UI never reinterprets business rules.
3. **Meet data where it is.** Accept the files operators already have and explain problems per column instead of rejecting the whole file vaguely.
4. **Honest demo.** Show only the sample data and capabilities that exist; no fabricated proof.
