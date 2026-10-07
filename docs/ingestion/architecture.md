# Universal import: architecture

Status: Phase 0 + 1a (delimited text, gzip, refusals). Everything below was checked against the source at the end of this
phase; file paths are relative to the repository root.

## 1. What it is, in one paragraph

The Import page can read a file whose format, separator, encoding, column names and number/date formats are not the ones
SCC's CSV importer expects. The file is read **in the browser** by a pipeline that knows no file format. It detects what
the file is, finds the table, matches its columns to SCC fields, converts values, builds a **canonical CSV** (exact SCC
headers, UTF-8, comma, ISO dates, dot decimals), validates it with the unchanged V1 importers, and shows a preview. Only
after the user confirms is the canonical CSV sent through the **unchanged** `POST /api/import/<kind>` endpoint. The server
never sees the original file and its contract did not change.

```
bytes -> detect -> probe -> read -> structure -> map -> normalize -> canonical CSV -> dry run -> preview -> Confirm -> importCsv(kind, file)
         |         |        |        |            |      |            |                |
         adapters (format knowledge)  core (no format knowledge)                        unchanged V1 importers and endpoint
```

## 2. Layout of the code

| Path | Role |
|---|---|
| `src/shared/ingest/types.ts` | The contracts: `SourceRef`, `RawCell`, `RawTable`, `ExtractionResult`, `AdapterDescriptor`, `FormatAdapter`, `Ctx`, `AdapterChoice`, `IngestError`, `Result<T>`. |
| `src/shared/ingest/registry.ts` | `AdapterRegistry`, `createRegistry`, `registerAdapter`, `validateDescriptor`. No global instance. |
| `src/shared/ingest/adapters/index.ts` | **The only list of adapters** (`builtinAdapters`, `createDefaultRegistry`). |
| `src/shared/ingest/adapters/delimited/`, `gzip/`, `refusals/` | The three built-in adapter groups (1 delimited-text adapter, 1 gzip wrapper, 15 refusal adapters). |
| `src/shared/ingest/detect/` | `arbiter.ts` (`detectFormat`, `makeHints`), `bytes.ts` (generic byte helpers, `HEAD_BYTES` = 64 KiB). |
| `src/shared/ingest/pipeline.ts` | `analyzeFile(input, env)`: the stage orchestration. |
| `src/shared/ingest/structure/` | `detectStructure.ts` (header row, banner, repeated header, total and footer rows), `profile.ts` (column profiles). |
| `src/shared/ingest/mapping/` | `normalizeHeader.ts`, `score.ts`, `assign.ts`, `report.ts`, `valueMaps.ts`, `suggester.ts` (interface only), `dictionary/` (see `dictionary-guide.md`). |
| `src/shared/ingest/normalize/` | `numbers.ts`, `dates.ts`, `detectPreset.ts`, `text.ts`: number and date presets and their detection. |
| `src/shared/ingest/canonical/` | `schemaRegistry.ts` (read-only view of the V1 column specs), `buildCsv.ts` (canonical CSV and `lineToSource`). |
| `src/shared/ingest/validate/dryRun.ts` | Runs the unchanged V1 importers on the canonical CSV and translates their issues to the user's own rows. |
| `src/shared/ingest/preview/` | `model.ts` (the `PreviewModel` the UI renders), `sourceRef.ts` (formatting of `SourceRef`). |
| `src/shared/ingest/flatten/` | `records.ts` (nested records to tables), `positioned.ts` (hook for table inference over positioned text). |
| `src/shared/ingest/limits.ts`, `messages.ts` | The limit layers and the message catalogue (see `limits.md`). |
| `src/client/ingest/` | `runner.ts` (`WorkerRunner`, `InlineRunner`, `routeFile`), `ingest.worker.ts` (worker entry), `useIngestFlow.ts` (UI state machine), `importStory.ts` (the words of the seven states). |
| `src/client/components/import/` | `UniversalImportCard.tsx` (the seven states) and its panels. |
| `src/client/import/sampleFiles.ts` | The demo files built in the browser: `carrier-export.csv` ("No file? Try one."), the inventory file and the file with errors. |
| `src/server/ingestLimits.ts` | `SCC_MAX_IMPORT_ROWS` (the only server addition). |

Dependency rules, enforced by tests (`tests/shared/ingest/importDirection.test.ts`, `coreScan.test.ts`):
no protected module imports ingestion code; the core never imports `adapters/**`; shared code never imports the client or
the server; the client never imports the server. The core also contains no delimiter, extension or format name.

## 3. The contracts

### 3.1 `RawTable` and `SourceRef`
Every adapter that yields tables returns `RawTable`s: `rows: RawCell[][]` where `RawCell = { v: string; t: CellType; src? }`
(`v` is always a string; `t` is `'text' | 'number' | 'date' | 'bool' | 'error' | 'empty'`), `columns?` when the source names
its own columns, `truncated`, `notes`, and `origin(rowIndex, colIndex?)` which returns a `SourceRef` telling where the value
came from in the **user's** file:

```
{ kind: 'line', line, column? } | { kind: 'cell', sheet, row, col } | { kind: 'path', path, index? }
| { kind: 'page', page, bbox? } | { kind: 'segment', index, element? } | { kind: 'record', index }
```
`preview/sourceRef.ts` formats them ("line 57", "Sheet 'Loads', row 57"). Every validation issue is shown with that
reference, never with a line number of the generated CSV.

### 3.2 `ExtractionResult`
A union: `tables`, `records` (nested data; the core flattens it with path columns), `positioned-text` (pages of text runs; a
registered table-inference step turns it into tables; no reference implementation exists yet), `images-only` (the core
refuses it with the "no readable text" message).

### 3.3 `FormatAdapter`
```ts
interface FormatAdapter {
  descriptor: AdapterDescriptor;
  detect(head: Uint8Array, hints: Hints): DetectionVote;                       // pure, total, bounded
  probe(src: ByteSource, ctx: Ctx, options?: Record<string, string>): Promise<Result<ProbeResult>>;   // tables list, choices, evidence
  read(src: ByteSource, sel: Selection, opts: ReadOptions, ctx: Ctx): Promise<Result<ExtractionResult>>;
}
```
`AdapterDescriptor` (see `types.ts`): `id`, `version`, `family`, `status` (`stable | experimental | refusal`), `hints`
(extensions with the dot, MIME types; advisory only), `signatures`, `contentSniff`, `yields`, `multiTable`, `hierarchical`,
`typedCells`, `streaming`, `sourceRefKind`, `wrappable`, `resourceHints` (can only lower limits), `messages`.
Adapters never throw for user data: they return `{ ok: false, error }` with a code from the message catalogue.

### 3.4 `IngestError`
`{ code, stage, message, source?, limit? }`. `code` is a key of `MESSAGE_CATALOGUE` (`messages.ts`); `stage` is one of
`detect | probe | read | structure | map | normalize | validate | limits`. The conformance kit fails an adapter that returns
a code that is not in the catalogue.

## 4. The registry and detection

`createRegistry()` returns an empty `AdapterRegistry`; `register(adapter)` validates the descriptor (`validateDescriptor`:
id format, version, extensions, MIME types, signatures, `yields`, `sourceRefKind`, resource hints inside the core ceilings)
and rejects duplicate ids with a `RegistryError`. Methods: `list`, `get`, `adaptersForSignature`, `supportedFamilies`,
`refusalFamilies`, `setDisabled`/`isDisabled`, `unregister`.

`detectFormat(head, hints, registry, size)` asks every adapter whose signature matches the head (and every adapter with
`contentSniff`) to vote, then ranks votes by **evidence class**: `magic > container > sniff > hint`. A file extension or MIME
type is a hint only: it breaks exact ties and produces a notice when it disagrees with the content ("This file is named
.xlsx but its content looks like ..."), it never decides. Outcomes: `chosen`, `refused` (a refusal adapter matched),
`ambiguous` (a polyglot), `unknown`, `empty`, `disabled`. There is no `switch` on an extension anywhere in the core.

The texts shown for supported and unsupported types are **generated from the registry** (`supportedFormatsText`,
`unsupportedTypeMessage`, `acceptAttribute` in `messages.ts`), so registering an adapter changes them without editing a message
file. Tests: `registry.test.ts`, `arbiter.test.ts`, `messages.test.ts`.

## 5. The pipeline (`analyzeFile`)

`analyzeFile({ bytes, fileName, mimeType?, current?, decisions?, limitConfig? }, { registry, signal?, progress?, clock?, inference? })`
returns `Result<Analysis>` where `Analysis = { preview, canonical, kind }`.

1. **detect**: source size against the global limit, `detectFormat`, the adapter's source limit.
2. **probe**: the adapter lists tables and **choices** (`AdapterChoice`: encoding, separator ...). A choice is `detected`,
   `needs-confirmation` or `choose`. A choice the file cannot be read without (`blocksRead`, for example a guessed Windows-1252
   encoding) stops the pipeline until the user answers; the preview then holds only the format panel and the blockers.
3. **read**: `adapter.read` with the user's choices; records and positioned text are converted to tables.
4. **structure**: header row (the user can override with "Header is on row N"), banner rows above it, repeated header, total
   and footer rows. Those structural rows are listed and are excluded **only after the user confirms** them; blank rows are skipped.
5. **map**: column profiles, then the deterministic mapper (see `dictionary-guide.md`): each column becomes MATCHED, CHECK or
   CHOOSE with evidence; dataset (inventory or shipments) detection; the user's assignments are applied on top.
6. **normalize**: one number preset and one date preset per file (`detectPreset`: unique, equivalent, ambiguous, mixed, none);
   currency refusal for money columns; status and warehouse value maps; file-wide constants for the allowed fields.
7. **canonical CSV** (`buildCanonicalCsv`): schema-ordered headers, normalized values, `lineToSource[]` obtained by parsing the
   produced CSV.
8. **payload limits**: the converted payload against the server's bytes and rows.
9. **dry run** (`dryRun`): the unchanged `importInventoryCsv` / `importShipmentsCsv`; issues are translated to the user's rows.
10. **preview model** (`PreviewModel`): file and evidence, choices, tables, structure, dataset, columns with evidence, fields,
    presets, value maps, constants, "not imported", raw versus canonical sample rows (10) and problem rows (up to 10),
    counts, validation result (at most 500 issues, with the true total), the destructive restatement sentence, `blockers`,
    `canConfirm`, `confirmBlockedReason`.

Fatal problems (unknown type, a limit, an unreadable file) come back as an `IngestError`. Everything the user can still
resolve is a **blocker** in the preview; Confirm stays disabled until there are none. Nothing is ambiguous-by-default: no
choice is preselected when the answer is genuinely open.

`Decisions` (plain data; `Map`s survive structured cloning): `options`, `acknowledgedChoices`, `tableIndex`, `headerRow`,
`excludedRows`, `kind`, `assignments`, `acknowledgedColumns`, `numberPreset`, `datePreset`, `statusChoices`,
`warehouseChoices`, `constants`. The pipeline is a pure function of `(bytes, hints, registry, decisions, limits)`: same input,
same output (`pipelineDeterminism.test.ts`). Cancellation is an `AbortSignal` checked between stages; the optional `clock`
enforces the parse and validation budgets.

## 6. Running it: worker and runners (`src/client/ingest/`)

* `WorkerRunner` runs `analyzeFile` in a fresh same-origin **module Worker** (`ingest.worker.ts`, built by Vite;
  `vite.config.ts` has `worker: { format: 'es' }`; no `blob:` or `data:` workers, so the existing CSP is unchanged). A watchdog
  terminates the worker when the wall-clock budget is exceeded; Cancel terminates it.
* `InlineRunner` runs the same code in the calling thread. It is used only where there is no Worker (the jsdom tests), and it
  refuses adapters that declare `needsWorker: true` (gzip does).
* Both return the same result for the same job (`tests/client/ingest/runner.test.ts`).
* `routeFile(bytes, fileName)` is the **legacy-first gate**: files that the V1 flow handles keep going through the unchanged
  per-kind cards; others are handed to the universal card.

## 7. The UI (`UniversalImportCard`: seven states, then the panels)

The card shows one state at a time, each with one sentence, one line, one main action and one small link (G1): waiting
(the drop area; its line is generated from the registry and the size limit), reading (Cancel), a question, has errors,
cannot import, ready ("480 shipments. Ready." with the effect on the on-time rate or low-stock count) and done (Open Dashboard, with Undo as its link). The
state is derived from the flow (`viewOf`), never stored. `src/client/ingest/importStory.ts` holds the words, as pure
functions of the preview: `questionFor` turns the first open blocker into one question whose answers are the buttons
(each answer is a decision: a date preset for one column, a status or warehouse mapping, a dataset, a column assignment,
an option); `fixesOf` lists what SCC settled on its own ("What I fixed (n)", with the value that proves each date column's
format); `impactLine`, `errorsText`, `problemsCsv` (the rows to fix, saved as a `data:` URL) and `cannotLine`. Blockers no
answer can resolve (currency, too large, no rows) are "cannot import". Red marks only what stops the import (cannot,
rejected, has errors, a failed Undo), amber a question.

Behind the state's small link sit the panels, unchanged: format (detected format, evidence, encoding and separator
choices, number and date format), table picker, structure, dataset choice and column mapping (MATCHED / CHECK / CHOOSE
badges with "Why?"), value mapping and constants, review (raw versus canonical rows, problems, counts, restatement and its
own Import button). Under "More": the other samples, paste, templates, the Column guide with the two per-kind cards, and
Restore sample data.

`useIngestFlow` keeps the user's decisions as data and re-runs the analysis after every decision (the previous review stays
visible, marked busy, until the new one arrives; a failed re-run keeps it but makes it unconfirmable). It reads
`snapshot.limits` for the server's payload bytes and rows. After an import it keeps the version the server returned, and
`undo()` sends it to `POST /api/undo`; a stale version is refused and said so (decision e).

Focus goes to the state's sentence on every new state (unless the user is working in the details or under More, except
when a new file starts); a file SCC cannot take is a `role="alert"`. Panel headings stay focusable (`tabIndex -1`) and
the other accessibility rules (`aria-describedby` for the Confirm reason, evidence expanders with
`aria-expanded`/`aria-controls`, fieldset/legend radio groups, text plus icon for confidence) are tested in
`tests/client/ingest/accessibility.test.tsx`; each state in `tests/client/import/sevenStates.test.tsx`. All file-derived
text is rendered as React text and truncated; nothing uses `dangerouslySetInnerHTML` or object URLs
(`securityGuards.test.ts`).

Upload: `importCsv(kind, canonicalFile)` with the original file name (two arguments).

## 8. What did not change

`src/shared/types.ts`, the domain, the CSV importers and parsers, the V1.5 alias mapper, the reference and sample data, the
server (except `ingestLimits.ts` and two small edits in `api.ts` and `index.ts`), the API client and the data context. A
SHA-256 list of the protected files is checked by `tests/shared/ingest/hashGuard.test.ts`.

## 9. Known limitations (honest list)

* Only delimited text (comma, semicolon, tab, pipe; UTF-8, UTF-16 with BOM, Windows-1252 after confirmation), gzip around
  one of those, and 15 refusal adapters exist. Excel, ODS, JSON, XML, HTML and PDF are recognized and refused with a clear
  message; reading them is a later phase.
* The mapper dictionaries were written by the same author as the held-out accuracy corpus; the 99% recall figure is an upper
  estimate. All five dictionaries are marked "needs native review".
* V1.5 treats `delivery date` and `delivered date` as unique aliases of `actual_delivery`; the pipeline keeps that
  (STRONG) although the design table listed `delivery date` as MEDIUM. Compatibility with V1.5 wins (criterion 14).
* Not implemented: hidden rows/columns choice; two-row headers; transposed tables; splitting composite columns; a "no header
  row" option and a six-row peek in the header selector; two datasets from one file (the bundle endpoint is Phase 2); saved
  mapping templates; evidence suggestions inside the V1.5 mapping panel.
* The per-kind cards treat a name ending in `.csv` as before (they never refuse it client-side); the server stays the
  authority for what is inside it.
* `limitConfigFromEnv` (`VITE_SCC_INGEST_*`) and `AdapterRegistry.setDisabled` exist and are tested, but the application does
  not call them yet: the client limits come from the server through `snapshot.limits`, and no adapter is disabled.
* The `Suggester` interface is an extension point with no implementation and no production import.
* Location rewrites (`DFW` to `WH-DFW`) are computed by `summarizeLocations` but are not applied or shown; shipment locations
  stay free text and the preview shows recognized versus unmapped routes.
* Larger sources than today's limits are not promised: 20,000 rows and 2 MiB are the defaults, `SCC_MAX_IMPORT_ROWS` above
  20,000 is not performance-validated (`limits.md`).
