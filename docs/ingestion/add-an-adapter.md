# How to add a file format (an adapter)

A format is added by touching **three places and nothing else**: the adapter module, its test fixtures, and one line in
`src/shared/ingest/adapters/index.ts`. No change to the detector, pipeline, structure detector, mapper, normalizers,
canonical builder, limits module, runner, worker entry, Import page or any other UI file. This is proven, not promised: the
toy adapter of section 4 is registered **from a test only**, and the whole pipeline then detects, reads, maps, previews,
validates and imports its files (`tests/shared/ingest/pipelineAdapters.test.ts`, "T-DUMMY").

## 1. The recipe

1. **Write the adapter**: `src/shared/ingest/adapters/<id>/adapter.ts` (and helper files in the same folder). It exports a
   `FormatAdapter` (`src/shared/ingest/types.ts`): a `descriptor`, and the functions `detect`, `probe`, `read`.
2. **Write the fixtures**: `tests/fixtures/ingest/adapters/<id>/corpus.ts` exporting `corpora: AdapterCorpus[]` (invented data
   only): files the adapter must read (`valid`) and hostile files it must survive without throwing (`hostile`: truncated,
   oversized, malformed, bombs where relevant). See `tests/fixtures/ingest/adapters/delimited-text/corpus.ts`.
3. **Register it**: add one line to `builtinAdapters` in `src/shared/ingest/adapters/index.ts`.
4. **Run the tests**: `npm test -- tests/shared/ingest --testTimeout=60000`. `tests/shared/ingest/conformance.test.ts` finds
   your corpus with `import.meta.glob('../../fixtures/ingest/adapters/*/corpus.ts')`, so registering is what enrolls the
   adapter in the conformance kit; it also fails if a registered adapter has no corpus.
5. Add golden outputs for the pipeline (a test like the T-DUMMY one: file in, canonical CSV and source references out).

## 2. What the adapter must provide

### 2.1 The descriptor
```ts
const descriptor: AdapterDescriptor = {
  id: 'my-format',                // /^[a-z0-9][a-z0-9-]{1,39}$/, unique
  version: '1.0.0',               // x.y.z
  family: 'My format',            // used in every generated message
  status: 'stable',               // 'stable' | 'experimental' | 'refusal'
  hints: { extensions: ['.myf'], mimeTypes: ['text/x-myf'] },   // lowercase, with the dot; advisory only
  signatures: [{ offset: 0, bytes: [/* magic bytes */] }],   // 1..32 bytes, offset 0..4096; an optional mask has the same length
  contentSniff: false,            // true: always asked to vote (needed when there is no magic)
  yields: ['tables'],             // 'tables' | 'records' | 'positioned-text' | 'images-only'
  multiTable: false, hierarchical: false, typedCells: false,
  streaming: 'none',              // 'none' | 'incremental'
  sourceRefKind: ['line'],        // which SourceRef kinds origin() returns
  wrappable: false,               // can read bytes that come out of a wrapper such as gzip
  resourceHints: { needsWorker: false },   // optional: sourceBytes, expandedBytes, ratio, maxDepth, maxRecords (they can only LOWER a limit)
  messages: {}                    // optional: refuse texts keyed by code
};
```
`validateDescriptor` (`registry.ts`) rejects an invalid descriptor at registration with a `RegistryError` that lists every problem.
An adapter needs signatures or `contentSniff`, or it is never asked to vote.

### 2.2 The three functions
* `detect(head, hints)`: **pure, total, bounded** (it receives at most `HEAD_BYTES` = 64 KiB). Return a `DetectionVote`
  `{ confidence 0..1, evidenceClass, evidence[] }` or `NO_VOTE`. Use `magic` for fixed signatures, `container` for a verified
  container, `sniff` for content heuristics. An extension is only a `hint`; never decide on it. A throwing `detect` is treated
  as an abstention.
* `probe(src, ctx, options)`: cheap. Return `{ tables, choices, evidence, notices, facts }`. Add an `AdapterChoice` for anything
  the user may need to confirm (`status: 'detected' | 'needs-confirmation' | 'choose'`); set `blocksRead: true` when the
  file cannot be read at all until the user answers.
* `read(src, selection, { maxRows }, ctx)`: return `{ ok: true, value: ExtractionResult }`. For tables: `RawTable` with
  `rows`, `rowCount`, `colCount`, `truncated` (never silent), `origin(rowIndex, colIndex?)` returning a `SourceRef` of a kind
  listed in `sourceRefKind`, and `notes`. Cell values `v` are **always strings**.

### 2.3 Rules every adapter follows
* Never throw for user data. Return `{ ok: false, error }` built with `ingestError(code, stage, params?)`.
  The code must be a key of `MESSAGE_CATALOGUE` (`src/shared/ingest/messages.ts`); the kit fails otherwise. If an existing code
  fits but you need a more specific sentence, pass it as `ingestError(code, stage, params, { message })`. A genuinely new class of
  message is the one case that needs an edit outside the three places (the catalogue), and it is a normal, reviewed change.
* Check `ctx.signal.aborted` between chunks and return `CANCELLED`.
* Honour the limits in `ctx.limits` (`ResolvedLimits`): the source size with `sourceTooLarge(ctx.limits, descriptor, size)`,
  rows with `maxRows`, columns, cells, depth. Hints in the descriptor may only lower a limit.
* Do not mutate `src` bytes; produce identical output for identical input.
* A wrapper (like gzip) reads its inner format through `ctx.registry` and may never output more than the inner family's own
  source limit allows, so a wrapper can never bypass limit (a).
* Binary parsers belong in the worker: set `resourceHints.needsWorker: true` (the inline runner then refuses the file in
  environments without a Worker instead of parsing on the page thread).
* Nothing file-derived is logged, ever (`securityGuards.test.ts` scans for `console` in the ingestion code).
* No `eval`, `new Function`, `WebAssembly`, network access or new dependency (`securityGuards.test.ts`); keys that come from
  the file live in `Map`s or arrays of pairs, never as plain-object keys (`RecordNode.entries` is an array of pairs).

## 3. What you get for free

Registering the adapter changes, without editing any message file: the supported-format sentence ("You can import Delimited
text (.csv, .tsv, .txt), ..."), the unsupported-type text, the file picker `accept` attribute, and detection arbitration.
Structure detection, column mapping (all five languages), number and date presets, value maps, the canonical CSV, the dry run,
the preview with source references, cancellation, the worker, and the whole UI work on your `RawTable`s unchanged.

## 4. Worked example: the dummy adapter (T-DUMMY)

The toy format is a magic line followed by `key=value;key=value` records. It lives only in
`tests/ingest-kit/fakeAdapters.ts` (it is **not** under `src/`):

```ts
export const TOY_MAGIC = '#TOYFMT1\n';

const TOY_DESCRIPTOR = baseDescriptor({
  id: 'toy-kv',
  family: 'Toy key-value text',
  hints: { extensions: ['.toy'], mimeTypes: ['text/x-toy'] },
  signatures: [{ offset: 0, bytes: asciiBytes(TOY_MAGIC) }],
  yields: ['tables'],
  sourceRefKind: ['line']
});

export const toyAdapter: FormatAdapter = {
  descriptor: TOY_DESCRIPTOR,
  detect: magicDetect(TOY_MAGIC, 'toy format header line'),       // magic evidence class
  async probe(src, ctx) { /* check abort and size, return one table "Toy" with a row estimate */ },
  async read(src, _sel, opts, ctx) {
    /* check abort and size, split lines, `key=value` pairs -> a table whose columns are the keys, one RawCell
       per value ({ v, t: 'text' }), and origin(r) -> { kind: 'line', line } (the physical line in the file) */
  }
};
```
The test (`pipelineAdapters.test.ts`, "T-DUMMY") does this, with no edit under `src/`:

1. builds a toy file from invented inventory rows (`encodeToy`);
2. **before** registering, the same bytes are read as plain delimited text by the generic reader (not as an inventory file);
3. `registry.register(toyAdapter)` on a registry the test created (`createDefaultRegistry()` plus one line);
4. the file is now detected as `toy-kv` with the evidence "toy format header line"; the structure step finds the header;
   the mapper proposes all seven inventory fields MATCHED with evidence; the preview shows raw versus canonical rows with
   `line N` references; the canonical CSV equals the golden text;
5. the canonical CSV is posted through the real endpoint (`serverHarness.ts`) and the dataset is replaced;
6. the supported-format text now lists "Toy key-value text";
7. the hashes of the core modules are unchanged by the test.

The three other fake adapters in the same file prove the contracts are not CSV-shaped: a **multi-table typed-cell** source
(`fake-multi`: hidden table, merged-fill note, date-typed cells, `cell` references), a **nested-record** source (`path`
references, child tables) and a **positioned-text** source (`page` references, a test-local table-inference step, images-only
refusal). Their corpora are in `tests/shared/ingest/fakeCorpora.ts`.

## 5. Making your adapter production-ready (checklist)

- [ ] Descriptor valid; family name reads well in "This looks like a <family>."
- [ ] `detect` is total on random bytes and cheap (conformance kit checks determinism and mutations).
- [ ] Every error uses a catalogue code; every limit text names a next step.
- [ ] Hostile corpus: truncated, corrupted, oversized, expansion bombs, hostile text, prototype-like keys.
- [ ] `sourceRefKind` lists every kind `origin()` returns, including for each row and column.
- [ ] Source size limit hint set if the family needs a different limit than the 2 MiB payload default (the limits layer
      clamps it; a higher default for a new family is an approved, measured decision: see `limits.md`).
- [ ] Golden test: file to canonical CSV, plus a validation problem translated to the user's own cell or line.
- [ ] `npm test`, `npm run typecheck` and `npm run build` pass; the hash guard and import-direction tests are untouched.

## 6. The conformance kit

`tests/ingest-kit/conformance.ts` exports `runAdapterConformance(adapter, corpus, registry)`. For any adapter it asserts:
descriptor validity; `detect` is total, bounded and deterministic on random bytes and on mutations of its own fixtures;
`probe` and `read` never throw and return structured catalogue errors; limits, `maxRows` and `AbortSignal` are honoured;
outputs satisfy the `RawCell` / `RawTable` / `ExtractionResult` invariants (string values, `origin()` defined for every row,
`SourceRef.kind` declared in the descriptor); input is not mutated; identical input gives identical output; the hostile pack
is handled; the generated messages mention the family. The helpers for building test input (UTF-16, Windows-1252, gzip,
a deterministic PRNG, a context factory) are in `tests/ingest-kit/corpus.ts`.

## 6a. Disabling a format

`AdapterRegistry.setDisabled(ids)` marks adapters as recognized-but-not-enabled ("This file type is not enabled"). It is
implemented and tested but not wired to any build-time setting in this phase.

## 7. Limits of this phase

Only the delimited-text adapter, the gzip wrapper and the refusal adapters are real. Excel, JSON, XML, HTML and PDF are
refused (`refuse-zip`, `refuse-json`, `refuse-xml`, `refuse-html`, `refuse-pdf`, ...). A reader for them is added exactly like
the toy adapter above, plus its own approved limits (`limits.md`) and dependencies, if any, which need the user's approval.
