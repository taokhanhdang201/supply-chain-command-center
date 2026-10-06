# Dictionary guide: how column names are matched, and how to add phrases or a language

The mapper that matches a file's column names to SCC fields is **deterministic and explainable**: no model, no network, no
clock, no randomness (a test stubs those to throw). The same file always gives the same mapping report, and every decision
carries human-readable evidence. The synonym data is plain TypeScript data in
`src/shared/ingest/mapping/dictionary/` (`en.ts`, `vi.ts`, `es.ts`, `de.ts`, `fr.ts`) with the loader in `index.ts`.

## 1. How a header is matched (short version)

1. **Normalization** (`mapping/normalizeHeader.ts`): NFKC, lowercase, diacritics folded (plus the d-stroke, sharp s, o-slash and
   ligatures), camelCase and snake_case split, punctuation and digits separated, whitespace collapsed, unit and currency
   markers moved to a separate hint, stop words dropped, light plural stemming. Dictionary phrases, canonical field names and
   the file's headers all go through the **same** function (`keyOf`), so both sides always agree.
2. **Header evidence** (`mapping/score.ts`, E1-E4 and E7; the best one counts, they are not summed): exact canonical name or
   exact dictionary phrase (strength `strong` 0.92, `medium` 0.75, `weak` 0.55; an exact canonical field name 1.0), token-set
   similarity (cap 0.6, minimum 0.5), spelling tolerance word by word (cap 0.55), a known ambiguous phrase.
3. **Value evidence** (E5, `structure/profile.ts`): does the column's content look like the field (ids, integers, decimals,
   money, dates, statuses, warehouse codes, locations)?
4. **Composition**: `C = 0.6 * header + 0.4 * profile` (`WEIGHT_HEADER`, `WEIGHT_PROFILE`), with penalties when a strong header meets
   values that do not fit (`MISMATCH_*`) and a cap when only the values speak (`PROFILE_ONLY_CAP` 0.7).
5. **One-to-one assignment** (`mapping/assign.ts`): an exact maximum-weight matching (at most 9 fields per dataset); a column
   feeds at most one field and a field at most one column.
6. **State** (`MATCH_MIN_CONFIDENCE` 0.85 with a margin of 0.25 over the next best, `CHECK_MIN_CONFIDENCE` 0.55,
   `COMPETING_WINDOW` 0.15):
   * **MATCHED**: shown with its evidence; no extra step.
   * **CHECK**: preselected but needs the user's "Looks right" (or another choice) before Confirm is enabled.
   * **CHOOSE**: nothing preselected; the user chooses a field or "Do not import". Competing columns, columns that fit two fields
     equally well, and every header that V1.5 treats as ambiguous (`Date`, `Cost`, `Location`, `Avg Usage` ...) are CHOOSE.
   * "Not imported": no evidence at all.

All thresholds are named constants at the top of `score.ts` and `assign.ts`, unit-tested at their boundaries
(`mapper.test.ts`, `mapperInvariants.test.ts`). Compatibility with V1.5 is a hard rule (criterion 14, `v15compat.test.ts`): a
header that V1.5 assigns uniquely stays MATCHED with the same field, a V1.5-ambiguous header stays CHOOSE with the same
candidates.

## 2. The data format

Each language file exports a `DictionaryFile`:

```ts
export const es: DictionaryFile = {
  language: 'es',
  reviewStatus: 'needs native review',   // the ONLY allowed value today; see section 5
  version: '1.0.0',
  groups: [
    { kind: 'inventory', field: 'sku',
      strong: [['código de artículo', 'Código de Artículo'], ...],     // [phrase, example]
      medium: [['código', 'Código']],
      weak: [...],
      note: 'optional: why a weak or medium phrase is not trusted more' },
    ...
  ],
  ambiguous: [{ kind: 'inventory', phrase: 'costo', example: 'Costo', candidates: ['unit_cost'] }]
};
```
* `phrase` is how a person writes the header, **already normalized**: lowercase, trimmed, single spaces, NFC (the validator rejects
  anything else). Accents may be kept; they are folded when matching.
* `example` is a real-looking header that **contains** the phrase (the corpus example). The test resolves the example through
  the mapper and checks that it lands on the same field.
* `strong` = this phrase means this field (a header that contains it is MATCHED when the values agree); `medium` = usually, but
  the profile must agree; `weak` = may be this field (CHECK at most; use `note` to say why). Put a phrase in `ambiguous`
  when it can mean several fields: it will always be CHOOSE with the listed candidates.

## 3. Adding phrases to an existing language

1. Open the language file and the group of the field (`kind` + `field`; field names are those of `INVENTORY_COLUMNS` and
   `SHIPMENT_COLUMNS` in `src/shared/csv/schemas.ts`).
2. Add `[phrase, example]` to `strong`, `medium` or `weak`. Choose the weakest strength that is honest: a wrong MATCHED is
   worse than a CHECK.
3. Run `npm test -- tests/shared/ingest/dictionary.test.ts tests/shared/ingest/mapperAccuracy.test.ts tests/shared/ingest/v15compat.test.ts --testTimeout=60000`.

`validateDictionary` (`dictionary/index.ts`, run by `dictionary.test.ts`, criterion 50) rejects: a phrase that is not normalized;
a missing or non-matching example; a phrase defined for two fields (also after diacritic folding); a phrase that is STRONG
for two fields; a phrase that is both ambiguous and mapped; a canonical field name that is also a phrase of another field;
an unknown field or candidate; a language file whose `reviewStatus` is not "needs native review".

**Do not tune the held-out corpus** (`tests/fixtures/ingest/heldoutCorpus.ts`): it exists to measure the dictionary honestly.
Put new real-world examples in the tuning corpus (`tests/fixtures/ingest/corpus45.ts` and the generated cases used by
`mapperAccuracy.test.ts`).

## 4. Adding a language

1. Create `src/shared/ingest/mapping/dictionary/<code>.ts` exporting a `DictionaryFile` as above, `reviewStatus: 'needs native review'`.
2. Add the code to `LanguageCode` and `LANGUAGE_ORDER` and the file to `DICTIONARY_FILES` in `dictionary/index.ts`
   (order matters only for deterministic tie-breaking; the build sorts entries so insertion order never changes the result).
3. Cover at least every required field of both datasets with a `strong` phrase and the ambiguous headers of that language.
4. Add a held-out style case (headers a person from that country would see in an export) and a tuning case, and run the
   accuracy tests. Thresholds enforced by `mapperAccuracy.test.ts`: wrong MATCHED = 0, junk columns MATCHED = 0, known-ambiguous
   headers never MATCHED, recall (MATCHED + CHECK) at least 95% on the tuning set and at least 80% on the held-out set, at most 10%
   of CHECK suggestions with a wrong top field.
5. The round-trip tests (`roundTrip*.test.ts`) pick headers per language from the dictionary; a language with no `strong`
   examples for a field falls back to any strong example.

## 5. Review status and honest limits

* **All five dictionaries are machine-drafted and flagged "needs native review"** (`reviewStatus`). A native speaker must review
  them before anyone relies on them in production. The validator forbids any other status, so promoting a file to "reviewed"
  is a deliberate code change that needs the user's decision.
* **The held-out corpus was written by the same author (the Coder) who then wrote the dictionaries.** It was written first and
  never used to tune, but some overlap of vocabulary is unavoidable, so the measured recall (99.2% on the held-out set, 14 cases,
  148 columns, five languages) is an **upper estimate**. An independent corpus written by someone else is the real test.
* **V1.5 compatibility deviation:** V1.5 makes `delivery date` and `delivered date` unique aliases of `actual_delivery`.
  The design table listed `delivery date` as MEDIUM. The dictionary keeps them STRONG because compatibility with V1.5 wins.
* Anonymous date columns are "Not imported" (no CHOOSE or CHECK from the order of dates); two-row headers, transposed
  tables and composite columns are not handled.
* The `Suggester` interface (`mapping/suggester.ts`) is only an extension point. It has no implementation, no production import
  and is not wired into the pipeline (a test scans for that).
