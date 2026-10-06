# Limits of the universal import

Source of truth in code: `src/shared/ingest/limits.ts` (`LIMIT_DEFAULTS`, `LIMIT_CEILINGS`, `resolveLimits`, `limitsForAdapter`,
the error builders), the texts in `src/shared/ingest/messages.ts`, and the server side in `src/server/ingestLimits.ts`.
Every number below was checked against those files.

## 1. Rules

* Six layers, (a) to (f), each with its own name, default, ceiling and message.
* **Effective value = min(hard ceiling, configured value or default).** An adapter may declare `resourceHints` that can only
  **lower** a limit (`limitsForAdapter`); nothing can raise a value above its ceiling.
* **Phase 0 + 1a changed no production default.** The effective defaults equal the values the application had before:
  2,097,152 bytes, 20,000 rows, 50 columns, 500 errors returned, 30,000 ms request timeout. They are pinned by tests
  (`tests/shared/ingest/limits.test.ts`, `tests/server/ingestLimits.test.ts`) and by the hash guard over `constants.ts`.
* The existing 2 MiB / 20,000 rows / 50 columns / 500 errors are the limits of the **canonical payload** the server accepts
  (layer (e)). They are not the limit of a source file, and a source file is stopped with its own layer's text.
* Changing a **default** (not a ceiling) needs the measurements of section 5 and an explicit user decision.

## 2. The layers

| Layer | Name (in `LIMIT_DEFAULTS`) | Default | Hard ceiling | Text when exceeded (code) |
|---|---|---|---|---|
| (a) source file, per family | `payloadBytes` is the default of the delimited family (`resolveLimits().sourceBytes`) | 2,097,152 B | 10 MiB (`sourceBytesFamily`) | "File is X MB; the limit is Y MB. Split the file, remove columns you do not need, or choose fewer rows." (`LIMIT_SOURCE_BYTES`; a family hint gives `LIMIT_SOURCE_BYTES_FAMILY`) |
| (a) global | `sourceBytesGlobal` | 100 MiB | 100 MiB | "This file is too large to import (maximum 100 MB). Split it into smaller files." (`LIMIT_SOURCE_GLOBAL`) |
| (b) expansion | `expandedEntryBytes`, `expandedTotalBytes`, `expansionRatio`, `archiveEntries` | 64 MiB, 100 MiB, 200:1, 1,000 | same (cannot be raised) | "The file expands to more than N MB, which is too much to process safely. Export a smaller file or split it." (`LIMIT_EXPANDED`); "The file looks like a decompression bomb and was not opened. ..." (`LIMIT_RATIO`) |
| (c) rows | `maxDataRows` (equals the payload rows) | 20,000 | 100,000 | "The file has more than 20000 data rows. Split the file or filter the rows, or ask your administrator to raise SCC_MAX_IMPORT_ROWS." (`LIMIT_ROWS`) |
| (c) scan rows | `maxScanRows` (raw rows scanned) | 200,000 | 1,000,000 | "This file has too many rows to scan (more than N). Choose another table or export the data range only." (`LIMIT_SCAN_ROWS`) |
| (c) columns | `maxColumns` | 50 | 1,000 | "Line N has more than 50 columns. Remove columns you do not need and try again." (`LIMIT_COLUMNS`) |
| (c) complexity | `maxCells`, `maxTables`, `maxDepth`, `maxNodes`, `maxTextNode` | 2,000,000; 64; 32; 5,000,000; 1 MiB | 8,000,000; 256; 32; 20,000,000; 4 MiB | "This file is too complex to read safely ... Export a simpler or smaller version." (`LIMIT_COMPLEXITY`) |
| (d) time | `parseBudgetMs`, `validateBudgetMs` | 20,000 ms, 10,000 ms | 120,000 ms, 60,000 ms | "Reading this file took too long and was stopped. ..." (`LIMIT_PARSE_TIME`); "Checking this file took too long and was stopped. Try fewer rows." (`LIMIT_VALIDATE_TIME`) |
| (d) memory | none (a worker's heap cannot be capped); bounded by (a), (b), (c); the watchdog terminates the worker | n/a | n/a | "Your browser ran out of memory reading this file. Try a smaller file." (`LIMIT_MEMORY`) |
| (e) payload bytes | `payloadBytes` | 2,097,152 B | 10 MiB | server 413 "The file exceeds the X MB upload limit." (`FILE_TOO_LARGE`); client, before upload: "After conversion the data is X MB but the server accepts at most Y MB per import. Use fewer rows or columns, import one sheet at a time, or ask your administrator to raise SCC_MAX_UPLOAD_BYTES." (`LIMIT_PAYLOAD_BYTES`) |
| (e) payload rows | `maxImportRows` | 20,000 | 100,000 | server 422 "The file has more than N data rows."; client: "After conversion the data has N rows but the server accepts at most M rows per import. Use fewer rows, or ask your administrator to raise SCC_MAX_IMPORT_ROWS." (`LIMIT_PAYLOAD_ROWS`) |
| (e) fixed | `maxImportColumns`, `maxErrorsReturned`, `requestTimeoutMs` | 50, 500, 30,000 ms | same | existing texts; not configurable |
| (f) delivery above (e) | not needed | n/a | n/a | the (e) messages |

Every text above names a concrete next step (`limits.test.ts`, `messages.test.ts`, criterion 32). Values that come from the file
(sizes, counts) are numbers; file text is never placed in a limit message.

## 3. Environment variables and where the values come from

| Variable | Read by | Meaning | Range and behaviour |
|---|---|---|---|
| `SCC_MAX_UPLOAD_BYTES` | `src/server/config.ts` (unchanged) | canonical payload bytes (layer (e)), also the source limit of the delimited family | integer 1,024 to 10,485,760, default 2,097,152; invalid values stop the server with `Invalid SCC_MAX_UPLOAD_BYTES "x": expected an integer between 1024 and 10485760.` |
| `SCC_MAX_IMPORT_ROWS` | `src/server/ingestLimits.ts` (new) | maximum data rows of one import (layers (c) and (e)) | integer 1 to 100,000, default 20,000; empty or unset means the default; spaces are trimmed; anything else stops the server at start-up with `Invalid SCC_MAX_IMPORT_ROWS "x": expected an integer between 1 and 100000.`; a value above 20,000 prints a warning: "SCC_MAX_IMPORT_ROWS is N, above 20000: imports of more than 20000 rows are not performance-validated and import work runs on the single server thread." |
| `VITE_SCC_INGEST_*` | `limitConfigFromEnv` in `limits.ts` | build-time overrides: `MAX_SCAN_ROWS`, `PARSE_BUDGET_MS`, `VALIDATE_BUDGET_MS`, `SOURCE_BYTES_<ADAPTER_ID>` | parsed and tested, **but the application does not call it yet**: nothing reads these variables today (see section 6) |

How the client learns the server's limits: the existing `GET /api/snapshot` field `limits: { maxUploadBytes, maxRows }`. Its
`maxRows` is now the effective value (`SCC_MAX_IMPORT_ROWS`, default 20,000) instead of the literal 20000; the type did not
change. `useIngestFlow` passes `{ payloadBytes: limits.maxUploadBytes, maxImportRows: limits.maxRows }` as the pipeline's
`limitConfig`, so a converted payload that the server would refuse is stopped in the browser with the (e) text, **before**
any upload. `src/server/api.ts` passes `{ maxRows, maxColumns }` to the V1 importers (their optional `limits` argument), so
the server enforces the same value; the byte limit (413) and the row limit (422) stay separate layers.

`config.ts` and the `AppConfig` type were not modified.

## 4. Behaviour at the boundaries (tested)

* 20,000 rows pass; 20,001 get the layer (c)/(e) text; with `SCC_MAX_IMPORT_ROWS=30000` 25,000 pass and 30,001 do not, and
  `snapshot.limits.maxRows` shows 30,000 (`tests/server/ingestLimits.test.ts`, `hostilePack.test.ts`).
* 50 columns pass; 51 are refused naming the line.
* A source one byte over its limit is refused with the layer (a) text; exactly at the limit it is read.
* gzip: the compressed file is checked against (a); the expansion against the ratio cap (200:1, applied from 1 MiB of output) and
  against the **inner family's** source limit, so gzip never bypasses (a) (`LIMIT_EXPANDED`, `LIMIT_RATIO`).
* More than 500 problems: the first 500 are returned with the true `totalErrors`.

## 5. Raising a limit later: what must happen first (not done in this phase)

Measured on the development machine in this phase: a 1.89 MB file with 19,000 inventory rows ran detect, read, structure,
map, normalize, canonical build, V1 dry run and preview in about 0.9 s end to end (budget 2 s); format detection about 1 ms; encoding and
separator detection on 1.9 MB about 8 ms; mapping of 50 columns about 9 ms; Cancel took effect immediately. Those numbers are
for today's limits only. **Nothing above 20,000 rows or 2 MiB was measured, and none is promised.**

Before any default is raised, a later phase must: measure 50k, 100k and 250k rows (peak memory, longest event-loop block, total
time, snapshot build time, UI responsiveness; proposed acceptance: peak RSS under 512 MB, no event-loop block above 500 ms, end to
end under 30 s); decide between a single bigger request (reading, decoding and validating on the one server thread blocks every
other request and keeps the old and new dataset alive at once) and a streaming validator; change protected server and CSV files
(needs the user's approval); build the canonical CSV as chunks instead of one string; add determinate progress and abort of the
upload; add boundary tests for every raised ceiling. Until then `SCC_MAX_IMPORT_ROWS` above 20,000 is an operator's informed risk
and prints its warning.

## 6. Known gaps (honest list)

* `limitConfigFromEnv` (`VITE_SCC_INGEST_*`) and `AdapterRegistry.setDisabled` are implemented and unit-tested but not wired into the
  application: the client limits come only from the server's snapshot, and no format is disabled.
* Layer (a) values for families that do not exist yet (Excel, JSON, XML, HTML, PDF) are not defined; they are proposals for their own
  phases and must be validated then.
* The memory layer is indirect (no browser API caps a worker's heap).
* Request timeout (30 s), maximum columns (50) and errors returned (500) are fixed constants of the existing server.
