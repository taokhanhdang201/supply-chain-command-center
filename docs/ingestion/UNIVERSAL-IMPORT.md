# Universal Import: audit and design (G0)

Status: **G1 is built** (dates per column, Undo, the seven states, More, "No file? Try one."); section 11 says what was
built and where it differs from this design. G2 and G3 are design only and were cut down after G1; G4 is deferred
(section 12 is the current scope and overrides the phases named elsewhere in this file). Baseline of the audit: `main` at
`bd820d6`. Code is the source of truth; where
the existing docs say something else, section 1.2 lists it. "Probe" below means the current engine run on synthetic files
(`analyzeFile` with the default registry) during G0; the probe was a temporary test and is not part of the repository.

Supreme rules this design follows: act when sure, suggest when fairly sure, ask one plain question when unsure, never guess
silently; "not imported but right" beats "imported but wrong"; the same file always gives the same result; formats are
recognized from bytes, encoding and structure, never from the file name.

## 1. Audit: what the engine does today

### 1.1 Capabilities

| Capability | Status | Where (file → function) | Notes |
|---|---|---|---|
| Format detection by content | Done | `detect/arbiter.ts` → `detectFormat` | Evidence ranks `magic > container > sniff > hint`; the extension is a hint only. Probe: JSON renamed to `.csv` is still recognized as JSON. |
| Adapter registry and contracts | Done | `registry.ts`, `types.ts` (`FormatAdapter.detect/probe/read`), `adapters/index.ts` | One list of adapters: 1 delimited-text, 1 gzip, 15 refusals. |
| Common form (`RawTable`, `ExtractionResult`) | Done | `types.ts`; `flatten/records.ts` | Union of `tables`, `records` (flattened by the core), `positioned-text` (no implementation yet), `images-only`. |
| Delimited text | Done | `adapters/delimited/` (`sniff.ts`: comma, semicolon, tab, pipe) | Probe: a pasted Excel range (tab) and a pipe file read with no question. |
| Encodings | Done | `adapters/delimited/encoding.ts` | UTF-8 with or without BOM, UTF-16 LE/BE with BOM, Windows-1252 after the user confirms. UTF-16 without BOM and UTF-32 are refused. |
| gzip | Done | `adapters/gzip/adapter.ts` | `DecompressionStream('gzip')`, ratio cap 200:1, runs in the Worker only. |
| Refusals | Done | `adapters/refusals/index.ts` | image, SQLite, Parquet, program, ZIP family (XLSX, ODS, DOCX), legacy Office (XLS), PDF, RTF, archives, UTF-32, UTF-16 without BOM, binary, JSON, HTML, XML. |
| Header and structure | Done | `structure/detectStructure.ts` | Header row, banner, repeated header, totals, footer; structural rows are dropped only after the user confirms. |
| Column to field mapping | Done | `mapping/` (dictionaries en, de, es, fr, vi; `score.ts`, `assign.ts`) | Probe: "Load ID", "From", "To", "Transporter", "Freight Cost" matched. |
| Inventory or shipments | Done | pipeline map stage, `preview.dataset.scores` | |
| Data that is not SCC data (orders, invoices) | **Missing** | none | Probe: a purchase order file stops at `choose-dataset`, asking the user to pick Inventory or Shipments. This invites forcing wrong data in. |
| Number formats | Done, one per file | `normalize/numbers.ts` (`plain`, `us`, `eu`, `fr`), `normalize/detectPreset.ts` | Probe: EU numbers ask a question (`choose-number-format`). |
| Dates | **Partial** | `normalize/dates.ts` (`iso`, `ymd_slash`, `mdy_slash`, `dmy_slash`, `dmy_dot`), one preset per file | Ambiguous dates ask (correct). Mixed styles in one file stop with "choose a date format" (probe), even when every value is unambiguous. No month names ("Mar 5, 2026"), no Excel serial dates. |
| Currency | Partial | `normalize/numbers.ts` → `scanCurrency`, `decideCurrency` | A foreign or mixed currency is refused (correct: never convert silently). |
| Units | Missing | none | SCC has no weight or volume field; matters for EDI quantities (EA, CS) later. |
| Duplicates | Partial | V1 importers (`src/shared/csv/`) | Duplicate `shipment_id` or `sku + warehouse` is a validation error; exact duplicate rows are not offered for removal. |
| Value synonyms | Partial | `mapping/valueMaps.ts` (status, warehouse) | Carrier synonyms (DHL vs DHL SC) are not handled; `summarizeLocations` is computed but not applied. |
| File-wide constants | Done, limited | `canonical/schemaRegistry.ts` → `CONSTANT_ALLOWED` | Only `carrier`, `warehouse`, `origin`, `destination`, `category`, `status`, `lead_time_days`. |
| Server re-validation | Done | `src/server/api.ts` → `importShipmentsCsv` / `importInventoryCsv` on the canonical CSV | The browser result is never trusted. |
| All or nothing | Done | V1 importers; `api.ts` 422 "No data was changed" | |
| Limits | Done | `limits.ts` (layers a to f), `src/server/config.ts` | Defaults 2 MiB and 20,000 rows; `SCC_MAX_UPLOAD_BYTES` ceiling 10,485,760 bytes. |
| Determinism | Done | `tests/shared/ingest/pipelineDeterminism.test.ts` | |
| Worker, cancel, time budgets | Done | `src/client/ingest/runner.ts`, `ingest.worker.ts` | |
| Confidence and reason per step | Partial | column evidence (MATCHED, CHECK, CHOOSE), choice evidence | No single per-file decision "act / ask / stop" with one sentence of reason. |
| Post-import check | Partial | success banner with the row count | The snapshot after import is not compared with what was sent. |
| Undo | **Missing** | `src/client/api/apiClient.ts` has `getSnapshot`, `importCsv`, `resetSampleData` only | |
| X12 EDI, fixed-width text | **Missing and misread** | `adapters/delimited/sniff.ts` | Probe: both are taken as "Delimited text" with "no separator gives two or more columns", and the user is asked to choose comma, semicolon, tab or pipe: a question with no right answer. |
| XLSX, XLS, JSON, JSONL, XML, ZIP of several files, PDF | Missing (refused politely) | refusal adapters | |
| Paste from a spreadsheet | Done | `components/import/PasteBox.tsx` | |

### 1.2 Where the existing docs differ from the code

1. `architecture.md` section 7 describes visible panels and a "Confirm" button. Since the redesign the flow starts when a
   file is chosen, shows a steps bar, folds the panels under "Show how the file was read", and the button reads
   "Import N shipments".
2. The docs do not mention "Try a sample" (`src/client/import/sampleFiles.ts`) or that the Column guide hosts the two
   per-kind V1 upload cards, routed by `routeFile` (`ImportPage.tsx`).
3. `limits.md` matches the code (defaults, ceilings, `SCC_MAX_IMPORT_ROWS`).

## 2. Format matrix

"How common" is an estimate from industry practice, not a measurement. "Accuracy" is what the design can reach without
guessing.

| Format | How common | Today | Accuracy reachable | Maps to | Library | Main risks | Phase |
|---|---|---|---|---|---|---|---|
| CSV, TSV, TXT; `;` and `\|` | Very high | Read | High | Shipments, Inventory | No | Excel rewrites dates; quoting quirks | done (G1: UI) |
| Pasted from Excel | High | Read (tab) | High | both | No | | done |
| XLSX | Very high | Refused | High for plain sheets | both | No: ZIP directory + `DecompressionStream('deflate-raw')` + own XML tokenizer | Dates are numbers with a date format; formulas (use the cached value); merged cells; several sheets (ask) | G2 |
| XLS (binary, pre-2007) | Medium, falling | Refused | Medium | both | Realistically yes | Large binary format, password files | keep the refusal (decision c) |
| JSON | High in TMS and API exports | Refused | High for arrays of flat objects; nested data flattened by `flatten/records.ts` | both | No (`JSON.parse`) | Deep nesting, very large numbers, duplicate keys | deferred (§12) |
| JSONL | Medium | Refused | High | both | No | Lines with different shapes | deferred (§12) |
| XML (generic) | High in ERP and TMS | Refused | Medium | both | No: own tokenizer, no DTD, no entities | Entity expansion, namespaces | deferred (§12) |
| cXML | High in procurement | Refused | High for recognition | Orders and invoices: nothing (polite refusal); ship notices: shipments (later) | No | | deferred (§12) |
| GS1 XML (despatch advice) | Medium in retail | Refused | Medium | Shipments | No | Depth of the schema | deferred (§12) |
| Fixed-width text | Medium (legacy reports) | Misread | Medium: column edges from blank columns shared by every line, then confirm | both | No | Ambiguous edges (ask) | deferred (§12) |
| X12 214 status | Very high (carriers) | Misread | High | Shipment status updates (decision a) | No | Partner variations; carrier codes (SCAC) instead of names | G3 |
| X12 856 ship notice | Very high | Misread | High to read; no cost (decision b) | Shipments | No | HL hierarchy | deferred (§12) |
| X12 846 inventory | High | Misread | High to read; no price, category, reorder point (decision b) | Inventory quantities | No | Quantity qualifiers and units | deferred (§12) |
| X12 945 warehouse ship advice | High (3PLs) | Misread | High to read; no cost | Shipments | No | | deferred (§12) |
| X12 850, 810, 997 and others | Very high | Misread | Certain recognition, then a polite refusal | none | No | | G3 |
| EDIFACT (IFTSTA, DESADV, INVRPT) | High outside the US | Not recognized | | | No | | later (document only) |
| ZIP with several files | Medium | Refused | Per-file result | both | No (same ZIP reader as XLSX) | Zip bombs (limit layer b exists), file names | deferred (§12) |
| gzip | Low | Read | High | both | No | | done |
| PDF with text | High (bills of lading, PODs) | Refused | Low to medium | some | Yes (pdf.js) | Tables in PDF have no structure | later |
| Scans and photos (OCR) | High | Refused | Low | | Yes | | not doing |

## 3. X12: how to read it

### 3.1 Envelope and separators
* **Recognize** a file whose first non-blank bytes are `ISA`. The ISA segment has fixed element lengths
  (ISA01 to ISA16: 2, 10, 2, 10, 2, 15, 2, 15, 6, 4, 1, 5, 9, 1, 1, 1; source: Stedi's X12 ISA reference). So the element
  separator is the byte at offset 3, and it must appear again at offsets 6, 17, 20, 31, 34, 50, 53, 69, 76, 81, 83, 89, 99,
  101 and 103. All 16 positions holding the same byte is the **magic signature**: certain, and independent of the file name.
* **ISA16** (offset 104) is the component separator; the **segment terminator** is the byte at offset 105; CR and LF after a
  terminator are ignored. **ISA11** (offset 82) is the repetition separator in newer versions (in 00401 it holds `U`); it
  must differ from the other separators.
* Then split segments by the terminator and elements by the separator, and check the envelope before using any data:
  ISA13 = IEA02, GS06 = GE02, ST02 = SE02; IEA01 = number of GS groups; GE01 = number of ST sets in the group;
  SE01 = number of segments in the set, ST and SE included. Any mismatch: "This EDI file is incomplete or damaged.
  Nothing was imported." No partial reading.
* The document type comes from **ST01** (214, 856, 846, 945, 850 ...), cross-checked with the GS01 functional group.

### 3.2 What maps where (element details to verify against implementation guides in G3)
The segment order below is confirmed (Stedi's transaction-set pages); element positions and qualifier codes are from
common usage and **must be verified in G3** before any code relies on them.

| Set | Segments used | SCC field |
|---|---|---|
| 214 | B10 (carrier reference, shipment identification, SCAC); AT7 in loop 1100 (status code, date, time); MS1 (location); N1, N4 in loop 1200 | `shipment_id` from the shipment identification; `status` from the AT7 status code (delivered vs in transit, table to verify); `actual_delivery` from the AT7 date when delivered; `carrier` from the SCAC (ask the name once per code); `origin` and `destination` from the N1/N4 parties |
| 856 | BSN (shipment ID, date); HL hierarchy (shipment, order, pack, item); DTM (shipped, estimated delivery); TD5 (carrier SCAC); N1/N4 (ship-from, ship-to); LIN, SN1 (items, not stored) | `shipment_id`, `ship_date`, `estimated_delivery`, `carrier`, `origin`, `destination`. **No cost** (decision b). |
| 846 | BIA; N1 (warehouse); LIN (item ID); PID (description); QTY (quantity with a qualifier); CTP (price, when present) | `sku`, `product_name`, `quantity`, `warehouse` (ask the SCC code), `unit_cost` only from CTP. **No category, no reorder point** (decision b). |
| 945 | W06 (depositor order, date, shipment ID); W27 (carrier); N1/N4; G62 (dates); W12 (shipped lines, not stored) | `shipment_id`, `ship_date`, `carrier`, `origin`, `destination`. **No cost.** |
| 850, 810, 997 and any other set | ST01 only | Nothing. "This is an EDI 850 purchase order. SCC tracks shipments and inventory, so there is nothing to import." |

## 4. The Import page: keep, move to "More", or remove

| Element today | Decision | Why |
|---|---|---|
| Stage figures "Current data sources" | Remove | The top bar already shows each source; "Ready" says what will be replaced. |
| Card title "Import any file" | Remove | The page title already says Data Import. |
| Steps bar (Choose file, Columns, Preview, Import) | Remove | Rule: no step bar. |
| Format sentence ("SCC reads the file in your browser ... You can import ...") | Replace | One line: "Spreadsheet, CSV or EDI. Up to 10 MB." (still generated from the registry). |
| Drop zone | Keep, larger | The one action: "Drop your file". |
| "Choose CSV file" button | Keep as "Choose a file" | Main button of state 1. |
| "Try a sample" menu (3 files) | Split | Main screen: one link "No file? Try one." (the demo file, section 6). "Try a file with errors" and, in G3, "Try an EDI file" go to More. |
| "Download templates" menu | More | Secondary. |
| "Paste data instead" | More | Secondary ("Paste rows from a spreadsheet"). |
| File name and size line | Remove | State 2 names the file. |
| "All N columns matched" and "Show how the file was read" (format, structure, mapping and value panels) | Behind "What I fixed (n)" | Details on demand; anything that needs an answer becomes one question (state 4). |
| Preview headline, "N rows read" banner, "All rows pass validation" banner | Replace | State 3: one sentence and one impact line. |
| First 5 rows table | Behind "Show the first 5 rows" | Inside the details. |
| "This will REPLACE the entire ... dataset" warning | Keep, shorter | The impact line of state 3: "Replaces the 480 sample shipments." |
| "Import N shipments" button | Keep as "Use this data" | Main button of state 3. |
| "Start over" | Inside the details | One small link per state; dropping another file also starts over. |
| Errors grouped by column, "Show every problem" | Replace | State 5: one sentence, one fixing button, "See every problem". |
| Success links (View shipments, View inventory, Back to dashboard) | Replace | State 7: "Undo" and "Open Dashboard". |
| Column guide with the two per-kind V1 upload cards | More ("Column guide", columns only); remove the per-kind upload cards | The universal flow covers both; two more upload buttons break "one action". Their tests are updated in G1, with the reason. |
| "Restore sample data" card | More | Secondary; also a fallback for Undo. |

## 5. Copy for the seven states

Rule per state: one main sentence, one line, one main button, one small link. English, shortest sentence, verb first,
real numbers. Mockups (1440 px and 390 px) were reviewed as screenshots in G0.

| State | Main sentence | Line | Main button | Small link |
|---|---|---|---|---|
| 1 Waiting | Drop your file | Spreadsheet, CSV or EDI. Up to 10 MB. | Choose a file | No file? Try one. |
| 2 Reading | Reading carrier-export.csv | Matching 9 columns to shipments. | (none) | Cancel |
| 3 Understood | 480 shipments. Ready. (EDI: "EDI 214 · 312 shipment updates. Ready.") | On-time rate moves from 85.6% to 91.0%. Replaces the 480 sample shipments. | Use this data | What I fixed (4) |
| 4 Not sure | Is 04/03/2026 April 3 or March 4? | Delivered Date, row 18. The other dates do not tell. | April 3 / March 4 (the answers are the buttons) | Show the row |
| 5 Has errors | 3 rows have no shipment ID. | Rows 14, 27 and 88. Nothing was imported. | Download the 3 rows to fix | See every problem |
| 6 Cannot import | This is a purchase order file. | SCC tracks shipments and inventory, so there is nothing to import. | Choose another file | What SCC can read |
| 7 Done | Done. Dashboard updated. | 480 shipments from carrier-export.csv. | Undo | Open Dashboard |

"What I fixed (4)" opens a numbered list, for example: Read "Load ID" as the shipment ID, "Transporter" as the carrier;
Removed spaces around 4,320 values; Read 3/15/2026 as March 15: 15 can only be a day; Read "$1,812.40" as 1812.40 US
dollars. Questions come one at a time. Colors follow DESIGN.md: red only for critical, amber for warnings, gray for neutral.

## 6. Demo: "No file? Try one."

A file built in the browser (like `sampleFiles.ts`), slightly dirty so the engine visibly understands it:
`carrier-export.csv`, 480 shipments, headers `Load ID, From, To, Transporter, Shipment Status, Dispatch Date, ETA,
Delivered Date, Freight Cost`, spaces around values, money as `"$1,812.40"`, and three date styles in three columns:
ISO in Dispatch Date, `15.03.2026` in ETA, `3/15/2026` in Delivered Date. Delivered Date also holds `04/03/2026`; under the
approved rule (one style per column, inferred from its unambiguous values) the column's other values settle it as April 3,
and "What I fixed" says so. Some in-transit rows carry the carrier word "Arrived", which the engine already treats as
ambiguous (`AMBIGUOUS_STATUS_WORDS` in `mapping/valueMaps.ts`): it can mean in transit or delivered, so SCC asks.

Flow, 3 clicks: (1) "No file? Try one." → reading → (2) "What does "Arrived" mean for these 6 shipments?" →
**In transit** → "480 shipments. Ready." → (3) **Use this data** → "Done. Dashboard updated." with Undo.

Why the question changed from the G0 draft: a date that its own column settles is not ambiguous under the approved rule,
and a 480-row column whose every value is ambiguous does not occur naturally. The date question (state 4) stays covered by
tests and appears for any column whose values are all ambiguous.

**Engine prerequisite (approved for G1):** dates are one preset per file today, and mixed styles stop the flow (probe). G1
gives each date column its own preset, inferred from its unambiguous values; a column whose values prove two different
orders stops and asks, it never picks. Files: `src/shared/ingest/normalize/` and the pipeline's normalize stage.

In More, from G3: **Try an EDI file**: a 214 that updates statuses of shipments in the sample, so the Dashboard changes.

## 7. Measuring accuracy

Each format gets a golden set: clean, dirty and trick files (same header with a different meaning, broken EDI envelope, a
file renamed to another extension). Metrics per format: share read; field-mapping accuracy; **wrong mappings (target 0)**;
share that needed a question. Existing corpora to build on: `tests/fixtures/ingest/corpus45.ts`, `heldoutCorpus.ts`,
`tests/shared/ingest/mapperAccuracy.test.ts`.

## 8. Decisions (approved by the owner after G0)

### a. EDI 214 and 945 are status updates → update import on the server (G3)
A new endpoint applies update rows to the current shipments atomically. A file that names a shipment ID SCC does not hold
stops as a whole and says which IDs, never skipped silently. Files: `src/server/api.ts`, a new shared update validator,
`src/client/api/apiClient.ts` (protected; listed in the G3 plan), tests. The EDI sample under More must use shipment IDs of
the seed 42 sample.

### b. A file lacks a required SCC field → ask for one value only when the file truly has one; update existing records only
* Ask for one value for the whole file only for fields in `CONSTANT_ALLOWED`, and only when the file really belongs to one
  warehouse or one carrier. The chosen value appears in the summary sentence and can be undone.
* 846 updates the quantity of SKUs SCC already tracks; an SKU SCC does not have stops the import and is named, no row is
  skipped.
* Otherwise refuse and list what is missing. Nothing is ever filled in silently.

### c. XLSX: own reader, no library; XLS keeps its polite refusal (G2)
Required: Excel serial dates, both date systems (1900 and 1904), and the cell's number format to tell which numbers are
dates. Golden files for both date systems.

### d. 10 MB source files, 2 MB payload to the server (G2)
Raise the source-file limit to 10 MB (10,485,760 bytes) in `src/shared/ingest/limits.ts`; keep the 2 MB canonical payload.
Compute the payload size as soon as the file is read; when it is over, say so early **in rows** (how many rows fit), instead
of running the whole flow and refusing at the end.

### e. Undo on the server, one step, version checked (G1)
At each import the server keeps the previous dataset and the store version after the import. `POST /api/undo` sends that
version back; when the data changed since (another import, a restore, the daily sample refresh), it says plainly that the
import can no longer be undone. Files: `src/server/api.ts`, `src/client/api/apiClient.ts` (protected; listed in the G1 plan).

### Dates (G1)
One date style per column, inferred from the column's unambiguous values. A column whose values prove two different orders
stops and asks; SCC never picks. Tests: a column whose values are all ambiguous, a column with conflicting evidence, several
columns with different styles.

## 9. Later, and not doing

Later (documented only): EDIFACT; PDF with text; cross-checking several files; an optional LLM suggester behind the
existing `Suggester` interface, only after golden sets, a wrong-mapping rate of 0 without it, explicit opt-in, and a
review of where file content would be sent. Not doing: OCR, partial imports, long-term import history.

## 10. G1 plan: files and reasons

Small commits, in this order. Core files are named; nothing else in the core lists is touched.

1. **Dates per column** (approved): `src/shared/ingest/normalize/` (per-column detection and its outcome), the normalize stage
   of `src/shared/ingest/pipeline.ts`, the date part of `src/shared/ingest/preview/model.ts` and of the `Decisions` type
   (one answer per column). New tests: all-ambiguous column, conflicting evidence, several columns with different styles.
   Existing tests that change behaviour are updated with the reason.
2. **Undo** (decision e): `src/server/api.ts` (`POST /api/undo`, the version returned by an import),
   **`src/client/api/apiClient.ts`** (protected: `undoImport`, the version on `ImportSuccess`) and its entry in
   `tests/fixtures/ingest/protected-hashes.json` in the same commit; server and client tests.
3. **Seven states, More, demo**: `src/client/pages/ImportPage.tsx`, `src/client/components/import/` (the card becomes the
   seven states; panels move behind "What I fixed"), `src/client/ingest/useIngestFlow.ts` (Undo, one question at a time),
   `src/client/import/sampleFiles.ts` (the `carrier-export.csv` demo), styles. One test per state; existing UI tests whose
   labels or structure change are updated with the reason.
4. **Docs**: README "Try it in 3 clicks" (EN and VI) and the Data Import screenshot; this file; `architecture.md` section 7.

Not in G1: recognizing orders and invoices (state 6 covers what SCC cannot read today; recognizing other document types
needs mapping changes and is proposed for G2); 10 MB, XLSX and JSON (G2); EDI (G3).

## 11. G1: what was built, and where it differs from the design

Commits: `e5093f7` (dates per column), `81b8fbe` (Undo), `aafdf7b` (seven states, More, demo), then these docs.

Built as designed: one state at a time with one sentence, one line, one main action and one small link; questions one at a
time with the answers as buttons; "What I fixed (n)" with the value that proves each date column's format; the demo in
three clicks (Try one, **In transit**, **Use this data**: on-time 85.6% to 91.0%, delayed 73 to 50 on the seed-42 sample);
Undo with a version check; "Download the N rows to fix"; red only for what stops the import, amber for a question.

Different from the design, and why:

| Design | Built | Why |
|---|---|---|
| Waiting line "Spreadsheet, CSV or EDI. Up to 10 MB." | "CSV, TSV, TXT or GZ file. Up to 2 MB." | The line is generated from the registry and the limit, so it says only what G1 reads; it grows with G2 (XLSX, 10 MB) and G3 (EDI). |
| Remove the per-kind V1 upload cards | Kept, under More, in the Column guide tabs | Their tests (V1.5 mapping panel, legacy routing, focus after a failed mapped import) stay as they are; removing them is a separate decision. |
| The review's "Import N shipments" button replaced by "Use this data" | Both exist: "Use this data" in the state, the review keeps its own button behind the small link | The review is unchanged behind the link; both buttons confirm the same canonical file. |
| Reading line "Matching 9 columns to shipments." | The pipeline stage and its progress, for example "Matching columns (60%)…" | The stage is known while reading; the column count is not known until mapping ends. |
| "Cannot import" line from the catalogue | The refusal's own hint only; the list of formats sits behind "What SCC can read" | The catalogue text is several sentences; the state allows one line. |
| "Current data sources" figures removed | Removed; the top bar now reads a sample file as "Sample data (seed 7)" | That label used to be shown only on the removed figures. |

After the owner's review of G1: the answers to a question all look the same (no answer is the main button, so none is
hinted); in Done the main action is **Open Dashboard** and Undo is the small link; the date question's line reads "No other
date in this column tells us which."; "has errors" names "Rows" (a file line is its spreadsheet row); the dark stage of
Data Import is a slim band (`PageStage variant="slim"`), since it holds only the title.

Known limits of G1: Undo lives in the card, so it is gone once the user leaves Data Import (Restore sample data stays the
fallback); the rows-to-fix file lists at most the first 500 problems (`MAX_ERRORS_RETURNED`); the date question names the
column, not the row.

## 12. Scope after G1 (owner decision, 2026-10-07)

**Why:** fewer formats, each read with complete accuracy. A format SCC reads must never import a wrong value; a format it
does not read yet is refused politely, which is the safe outcome ("not imported but right" beats "imported but wrong").
Every format left out below stays refused as it is today. This section overrides the phases in sections 2, 3 and 10; the
design notes for the deferred formats stay in this file for later.

| Phase | In scope | Deferred |
|---|---|---|
| G2 | The adapter foundation (registry entries for container formats, shared ZIP directory and `deflate-raw` reading); **XLSX** (own reader, decision c, golden files for the 1900 and 1904 date systems); source files up to **10 MB** (decision d) | JSON, JSONL |
| G3 | **EDI X12 214** only: status updates through the update endpoint (decision a), with an EDI sample whose shipment IDs match the seed-42 sample; certain recognition and a polite refusal for **850, 810 and 997** | 856, 846, 945 |
| G4 | Nothing | All of it: generic XML, cXML, GS1 XML, fixed-width text, ZIP with several files |

Consequences: decision (b) about 846 (unknown SKUs stop the file) waits with 846; the 846 and 945 rows of section 3.2 are
design notes only.

**Decided for G3 (owner, 2026-10-07): two kinds of polite refusal.** Every X12 file is recognized by the same ISA envelope
check and its ST01, so none is ever misread as plain text; what SCC says depends on whether the document is about data SCC
keeps.

| Sets | Meaning | Text (state 6: sentence, then line) |
|---|---|---|
| 850, 810, 997 and any other unrelated set | Not about shipments or inventory | "This is an EDI 850 purchase order." / "SCC tracks shipments and inventory, so there is nothing to import." |
| 856, 846, 945 | About shipments or inventory, not supported yet | "This is an EDI 856 ship notice." / "SCC reads EDI 214 status updates today; ship notices are not supported yet." (846: "inventory reports"; 945: "warehouse shipping advices") |

Both name the document type from ST01 and import nothing; the second says what SCC reads today, so the user knows which
EDI file to send instead. Tests in G3: one per set listed here, plus an unknown set.

### Engineering note: time-limited tests (done)

The test "2 MB single token" in `tests/shared/ingest/pipelineLimits.test.ts` (5 s limit; 5.1 to 5.4 s seen under load
during G1, under 4 s alone) and the conformance kit's "handles the hostile pack" (`tests/ingest-kit/conformance.ts`, 15 s
limit; 18.3 s seen once under load) passed their limits when the rest of the suite kept the machine busy. Their two files
now run after the parallel group, one file at a time (`vitest.config.ts`, the `timing` project, group 1), before the
performance budgets (group 2). No check, limit or timeout changed. A few jsdom UI tests also slowed under load during G1;
they stayed within their limits in the five full runs that verified this change.
