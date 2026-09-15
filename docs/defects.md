# Defects - JupyterLab Tabular Data Viewer Extension

`[ ]` open, `[x]` fixed. Dated notes under each track how it evolved.

## Authors

- `@kj` Konrad Jelen

## Document loading `LOAD`

how a file reaches the viewer - document model, content fetch, file type registration

- [x] `DEF-LOAD-1` **large database never opens - whole file base64-encoded before the widget runs** - MAJOR; opening a 507.6 MB SQLite database takes an enormous time and ultimately fails; cause: `src/index.ts` registers every binary tabular type with `fileFormat: 'base64'` and both widget factories with `modelName: 'base64'`, so `Context` fetches the entire file through `/api/contents` and base64-encodes it before the widget renders - content `TabularDataWidgetFactory.createNewWidget` never reads, since it uses only `context.path`; at 507.6 MB the base64 string is 676,800,000 chars against V8 `MAX_STRING_LENGTH` 536,870,888, i.e. 1.26x the hard limit, so the string cannot be constructed at all; fix: register a no-content model factory with `fileFormat: null`, which makes `Context` request `content: false`; `src/index.ts`
  - log: 2026-08-09T00:00:00Z @kj reported: "reading sqlite db chats.db takes enormous amount of time and fails ultimately"
  - log: 2026-08-09T00:00:00Z @kj measured: `dbstat` puts 299 MB in `profile_photos`, 110 MB in `media`, 81 MB in `feed_scan`; `.nodeenv/bin/node` reports `MAX_STRING_LENGTH` 536,870,888 vs a 676,800,000-char payload
  - log: 2026-08-09T00:00:00Z @kj mechanism confirmed: `node_modules/@jupyterlab/docregistry/lib/context.js:561` gates the content fetch on `content: this._factory.fileFormat !== null`
  - log: 2026-08-09T00:00:00Z @kj prior history: the same discarded-content fetch was measured at ~19 s for a 44 KB database during the v1.7.5 galata work and deferred as a follow-up rather than fixed
  - log: 2026-08-09T00:00:00Z @kj fixed: closed - NoContentModelFactory with fileFormat null; galata asserts on the wire that opening a .db issues no content=1 /api/contents request
- [x] `DEF-LOAD-5` **Ctrl+S on an open viewer now raises a File Save Error dialog** - MINOR; with `fileFormat: null` the context builds save options `{type:'file', format:null, content:''}` and the contents API rejects them with 'Must specify format of file contents', so Ctrl+S on a viewer tab pops an error dialog where the base64/text models previously round-tripped silently; the file is byte-unchanged and no data is lost, and silently rewriting a 500 MB database from a discarded round-trip was arguably the worse behaviour; `src/index.ts`
  - evidence: galata 'should not raise a save error on Ctrl+S' green - no .jp-Dialog after Ctrl+S and the file's last_modified unchanged; 28/28 galata on the installed wheel
  - test-tags: E2E
  - repro: open any tabular file, press Ctrl+S
  - log: 2026-08-09T00:00:00Z @kj reported: found by bug-hunter review; verified server-side - LargeFileManager.save with format None raises HTTP 400 and leaves the file at 216 B unchanged. Not verified in a live browser
  - log: 2026-08-09T00:00:00Z @kj not fixed in this change - the widget factory already declares readOnly: true but the save command gates on contentsModel.writable, so suppressing the dialog needs a UI-level change with its own risk; deliberately deferred rather than bundled into the cache round
  - log: 2026-08-09T00:00:00Z @kj unverified suspicion carried over from the review: a third-party contents manager that does not validate `format` could take `content: ''` literally and truncate the file; the stock manager rejects it. Settling test is running the same save against whichever non-default manager is supported
  - log: 2026-08-09T00:00:00Z @kj scope note from architect round 2: NoContentModelFactory now passes collaborative=false, which flows into Context.canSave, so under an RTC deployment this dialog appears where the base64 factory's collaborative=true previously suppressed it. Keeping false anyway - a ydoc session over a model that by construction holds no content is the worse option
  - log: 2026-09-14T20:50:34Z @kj edited repro (added) and test-tags (added)
  - log: 2026-09-14T20:50:34Z @kj closed: fixed: TabularDataWidgetFactory.createNewWidget replaces context.save with a no-op - the model holds no content, so there is nothing to write
- [x] `DEF-LOAD-20` **a clock-time or elapsed-time column returns 500 on the data request** - MEDIUM; pre-existing; a column arriving as arrow `time64` or `duration` - an Excel cell formatted as a time or an elapsed time - makes the rows request fail with a 500 and a traceback, while the statistics request on the same column succeeds; cause: `convert_to_json_serializable` (`routes.py:34`) handles `date`, `datetime`, `Decimal` and `bytes` but not `datetime.time` or `datetime.timedelta`, neither of which subclasses `date`, so the value reaches `json.dumps` and raises `TypeError`; measured identical at HEAD with pandas (`time64[us]`, `duration[us]`, same `TypeError`), so it is not a polars regression and sits outside DEF-4; `routes.py`
  - evidence: test_clock_time_and_elapsed_time_columns_reach_the_grid green on data/typed_columns.parquet; the time branch mutated kills it; 172 pytest
  - test-tags: INTEGRATION, E2E
  - repro: open a parquet holding a time64 or duration column, request rows
  - log: 2026-08-11T00:00:00Z @kj reported: surfaced by the round-4 adjudication as a candidate regression and disproved as one: reproduced against v1.7.11's pandas cascade on the same fixture. Recorded on the user's call because the round-4 tests now advertise time and timedelta cells, so a later probe would hit it and misattribute it to the polars swap
  - log: 2026-09-14T20:43:05Z @kj edited repro (added) and test-tags (added)
  - log: 2026-09-14T20:43:05Z @kj closed: fixed: convert_to_json_serializable renders datetime.time as isoformat and timedelta as str
- [x] `DEF-LOAD-24` **a pandas-categorical parquet column 500s on statistics, sorting and a numeric filter** - MEDIUM; pre-existing; a parquet column written from a pandas Categorical stores `dictionary<values=string, indices=int8>`; metadata, rows and unique-values answer 200, but the statistics request, a header sort and typing a number into that column's filter each return 500 - `count_distinct`, `sort_indices` and `equal` have no kernel for a dictionary type, and the frontend's numeric-type test substring-matches `int8` inside `indices=int8` so it offers a number filter for a string column; cause: the parquet reader returns `pq.read_table` output with only null columns recast, leaving dictionary columns as the file wrote them; fix candidate: decode dictionary columns to their value type beside the existing null recast; `readers.py`
  - evidence: test_dictionary_column_sorts_and_reports_statistics green - metadata says string, statistics 200 with 3 unique, sort ascending leads with blue; reader decode and metadata mapping each mutation-killed
  - test-tags: INTEGRATION, E2E
  - repro: open a parquet holding a dictionary<string> column, sort it or open its statistics
  - log: 2026-08-11T00:00:00Z @kj reported: surfaced by the round-6 bug-hunter review, measured on a pandas-written categorical parquet. NOT fixed in this change - it is outside DEF-4 (the same 500s occur at HEAD with the pandas reader) and the decode needs its own verification across dictionary index widths
  - log: 2026-09-14T20:43:05Z @kj edited repro (added) and test-tags (added)
  - log: 2026-09-14T20:43:06Z @kj closed: fixed: the parquet read decodes a dictionary column to its value type and the metadata fast path reports that type
- [x] `DEF-LOAD-26` **nested parquet column returns 500 on sort, filter, statistics and unique values** - MAJOR; a parquet column of type list, struct or map renders in the grid, but a header sort, a text filter, column statistics and unique values each answer 500 with a traceback
  - evidence: test_nested_parquet_columns_sort_filter_and_report_statistics green - metadata, sort, text filter, statistics and unique values all 200; reverting the change fails it; 178 pytest
  - repro: parquet with a list<int64> column, click its header to sort
  - test-tags: INTEGRATION
  - root-cause: 2026-09-14T22:52:53Z @kj arrow has no sort, cast-to-text or count_distinct kernel for a nested type, and the parquet reader recast only null and dictionary columns
  - log: 2026-09-14T22:52:53Z @kj added
  - log: 2026-09-14T22:55:05Z @kj closed: fixed: \_served_type serves a nested parquet column as JSON text on read, and metadata reports it as string
  - log: 2026-09-14T23:21:35Z @kj round-2 review: the JSON text escaped non-ASCII characters, so a text filter for Zürich inside a nested cell found 0 rows; \_json_text now keeps them as written; the test gained a city column and fails when the change is reverted

## SQLite reader `SQLITE`

reading SQLite databases - table listing, BLOB handling, storage classes

- [x] `DEF-SQLITE-2` **BLOB bytes read into memory only to be replaced by placeholders** - MAJOR; `_read_sqlite` issues `SELECT * FROM "t"` and then maps `_blob_placeholder` over object columns in pandas, so every BLOB is fully materialised before being discarded; on the reported database that is ~410 MB of pointless I/O per request for `profile_photos` and `media`; fix: build the select list from `PRAGMA table_xinfo` filtered on `hidden != 1` and wrap each column so the placeholder is produced in SQL, leaving the bytes in SQLite; `jupyterlab_tabular_data_viewer_extension/readers.py`
  - log: 2026-08-09T00:00:00Z @kj reported: user directive "do not bring blobs to frontent just put placeholder"
  - log: 2026-08-09T00:00:00Z @kj measured: arrow output for `profile_photos` is 319,717 bytes from a 299 MB table, confirming the bytes are read and thrown away
  - log: 2026-08-09T00:00:00Z @kj verified: on a generated 134 MB database holding 128 MB of BLOBs the placeholder path costs 0.004 s and +5 MB RSS, while forcing the payload to be read (CAST to BLOB) costs 0.059 s - 14x, so LENGTH() is answered from the record header and this is not a page-cache artifact
  - log: 2026-08-09T00:00:00Z @kj fixed: closed - placeholders built in SQL, payload never leaves SQLite; 0.004 s and +5 MB RSS on a 128 MB BLOB table
  - log: 2026-08-09T00:00:00Z @kj behaviour change found by bug-hunter review: the Python formatter and the new SQL disagreed on 5,118 sizes because SQLite's printf rounds half away from zero while CPython's %.1f rounds half to even - a 1,280-byte BLOB rendered '1.3 KB' from SQL and '1.2 KB' from Python. The docstring claiming they matched was false. Resolved by deleting the Python twin (already dead in production) and keeping half-up; sizes at exact binary halves now render one digit higher than in 1.7.6
  - log: 2026-08-09T00:00:00Z @kj correction to the fix clause above: PRAGMA table_info was the wrong instrument - it omits STORED and VIRTUAL generated columns that `SELECT *` returns, so it silently dropped them from the grid. The shipped select list is built from PRAGMA table_xinfo filtered on hidden != 1, which reproduces `SELECT *` across ordinary, generated, fts5 shadow, rtree, geopoly, STRICT and WITHOUT ROWID tables
- [x] `DEF-SQLITE-3` **no progressive load - every request re-reads the whole table** - MEDIUM; all five handlers call `read_as_arrow_table`, so metadata, each page, column stats, unique values and download each perform a full `SELECT *`, with pagination applied only after the read; `feed_scan` costs 0.93 s and 66 MB of arrow per request; fix: metadata fast path via `PRAGMA table_info` + `COUNT(*)`, and `LIMIT`/`OFFSET` pushdown on the unfiltered and unsorted browse path, falling back to a full read when filters or sort are active; `jupyterlab_tabular_data_viewer_extension/routes.py`
  - log: 2026-08-09T00:00:00Z @kj reported: "feels like we do not follow the progressive load rule and filter/ stats executed on full"
  - log: 2026-08-09T00:00:00Z @kj measured: per-table `_read_sqlite` cost across all 15 tables totals ~1.3 s, peak RSS 570 MB; slowest single table `feed_scan` 0.93 s
  - log: 2026-08-09T00:00:00Z @kj scope note: filter pushdown is deliberately excluded - the frontend offers regex filters and SQLite has no `REGEXP` operator by default, so pushing filters into SQL would change matching behaviour
  - log: 2026-08-09T00:00:00Z @kj attempted: LIMIT/OFFSET pushdown on the unfiltered and unsorted path, plus `COUNT(*)` for the row total - did NOT work; pandas infers dtype from the rows it is handed, so a window disagrees with the full table. A nullable INTEGER column reads back int64 from a 10-row non-null window and float64 from the full table, rendering 0 on one page and 0.0 on another. Reverted
  - log: 2026-08-09T00:00:00Z @kj attempted: gating the pushdown on a single-pass type-stability probe (85 ms over feed_scan's 31 columns) - did NOT work either; requiring one storage class and no NULLs per column disqualifies every table in the reported database (feed_scan 18/31 nullable, profiles 17/30, profile_scan also mixed), so the gate would never fire and the probe would be pure cost
  - log: 2026-08-09T00:00:00Z @kj attempted: metadata fast path via PRAGMA table_info - rejected before implementation; PRAGMA reports SQLite declared types (INTEGER/REAL) while the frontend matches arrow type names and isNumeric() substring-matches them, so it would change displayed types and numeric filter behaviour
  - log: 2026-08-09T00:00:00Z @kj stays open: invariant pinned by test_nullable_column_type_is_stable_across_any_row_window so a future attempt cannot reintroduce the mismatch silently; residual cost is a 0.735 s full read per page on feed_scan
  - log: 2026-08-09T00:00:00Z @kj fixed by caching instead: read_as_arrow_table now caches the arrow table on (abspath, sheet, mtime_ns, size) in a 256 MB LRU. Filters, sorting and stats stay global and the page is cut from the identical table object, so the windowed-inference mismatch cannot arise. Measured on the reported database: feed_scan 633.7 ms -> 0.03 ms, profile_photos 91.8 ms -> 0.03 ms; four tables resident in 78 MB
  - log: 2026-08-09T00:00:00Z @kj fixed: closed - repeat reads served from memory; 72 pytest green
  - log: 2026-08-09T00:00:00Z @kj correction: the claim that test_nullable_column_type_is_stable_across_any_row_window pinned the invariant was FALSE as written - the test only read the full table and never took a window, so a reintroduced pushdown would have left it green. Found by architect review; the test now reads a LIMIT 10 window through the same \_df_to_arrow path and asserts the int64/double disagreement explicitly
- [x] `DEF-SQLITE-4` **pandas must be removed from the read and export paths** - MEDIUM; pandas is the reader engine for every format (`pd.read_sql_query`, `pd.read_csv`, `pd.ExcelFile`) and the export engine in `DownloadHandler`; it also promotes a nullable INTEGER column to float64, so such a column exports as 42.0 rather than 42, and it is what made a windowed read disagree with a full one; fix: polars as the reader and export engine, openpyxl kept for reading .xlsx and xlsxwriter added for writing it, preserving the v1.6.0 mixed-type cascade and the exact export content types; `jupyterlab_tabular_data_viewer_extension/readers.py`
  - log: 2026-08-09T00:00:00Z @kj reported: reported: user directive "and pandas must be killed"; staged after the cache so the reader-engine swap reviews independently
  - log: 2026-08-09T00:00:00Z @kj measured: raw pyarrow and polars both keep a nullable INTEGER column at int64 across a window and a full read, where pandas gives int64 vs float64 - confirming the promotion is a pandas artifact. Both still disagree on a genuinely mixed-storage-class column, which is inherent to windowed inference
  - log: 2026-08-09T00:00:00Z @kj note: this repo has never used polars despite the workspace convention - declared deps are pyarrow>=10.0.0, pandas>=1.5.0, openpyxl>=3.0.0; polars 1.43.2 is present in the environment only
  - log: 2026-08-10T00:00:00Z @kj decided: polars over pyarrow-native, per user; fastexcel turned out NOT to be needed, since polars reads .xlsx through the already-declared openpyxl engine, so the swap adds polars and xlsxwriter (~200 KB) and drops pandas
  - log: 2026-08-10T00:00:00Z @kj measured: polars carries the v1.6.0 cascade natively on all three source types, keeps a nullable INTEGER at int64 across a window and a full read, supports latin1 CSV directly, and normalises pyarrow `string_view` on the way in - so `pl.from_arrow` is safe on the parquet fixture that broke stats in v1.5.12
  - log: 2026-08-10T00:00:00Z @kj correction: the claim in this defect that a promoted column "displays as 42.0 rather than 42" was FALSE. Verified by mutation: reintroducing the float cast in the installed reader left a grid-based assertion green, because the backend serialises 42.0, JSON has one number type and JavaScript renders it "42". The promotion is visible in the EXPORTED file, not the grid - a CSV export writes 42.0 - so the galata test asserts exported content and the defect line is reworded
  - log: 2026-08-10T00:00:00Z @kj caught in own work: `infer_schema_length=None` is load-bearing on the CSV and SQLite reads and nothing tested it - every mixed fixture here is a few rows long, so polars' default 100-row window covered them all. A string past row 200 raises ComputeError; now pinned by test_mixed_column_resolves_when_the_string_arrives_late, mutation-verified to fail when the argument is dropped
  - log: 2026-08-10T00:00:00Z @kj fixed: readers.py and DownloadHandler are pandas-free, deps swapped in pyproject.toml, guarded by test_extension_does_not_import_pandas (subprocess check, since pytest's own plugins import pandas into the shared interpreter)
  - log: 2026-08-10T00:00:00Z @kj follow-up: the swap left one cosmetic export difference unfixed, tracked as DEF-6
  - log: 2026-08-10T00:00:00Z @kj correction to the note above: the subprocess rationale was wrong - neither pytest nor any test in the file imports pandas, so sys.modules here would be clean. The subprocess is still right, but because an in-process check would pass or fail on whatever else imported pandas first; the test docstring now says that
  - log: 2026-08-10T00:00:00Z @kj adversarial review found four regressions the swap introduced, all fixed and each now pinned by a mutation-verified test: a 0-byte or ragged csv returned 500 instead of 400 because no polars exception subclasses ValueError; polars' read_excel defaults dropped blank columns and rows and raised on an empty sheet; list_excel_sheets offered chartsheets as unopenable tabs; and a binary column made write_ndjson panic in Rust, which inherits BaseException and so escaped the handler's except Exception and left the request with no body
  - log: 2026-08-11T00:00:00Z @kj round-4 review (architect + bug-hunter, both DO-NOT-SHIP) found four more, all reproduced independently before fixing and all VALUE-level rather than layout-level, which is why the 8-shape layout comparison and the 784-case sweep both missed them. `_value_kind` had grouped date, datetime, time and timedelta as one 'temporal' kind, so the mixed-kind guard never fired on the mixtures that need it: datetime+time and date+time raised ComputeError (400, file unopenable), datetime+timedelta silently nulled the duration, and time+timedelta reached arrow as fixed_size_binary[8] holding raw CPython object pointers, which the grid rendered as mojibake and every export wrote as hex. Six of Excel's seven error values retyped a numeric column to text where pandas mapped a TYPE_ERROR cell to NaN. Polars infers Int128 for an integer at or above 2\*\*63 in a csv (above 2\*\*64 via a spreadsheet cell) and pyarrow cannot consume its arrow export, so ArrowInvalid('\_pli128') - itself a ValueError - made such a file a 400. And fix 6 was half applied: `list_excel_sheets` still handed openpyxl a path, and the metadata handler calls it BEFORE the reader, so an xlsx named .xls still 500d - the reader-only test was green over a broken path. Fixed with one kind per widenable type set, an Excel-only error-value set, an Int128 recast in the shared cast helper, and a file handle at both openpyxl call sites; 141 pytest green, 29 of 29 mutations killed across four rounds
- [x] `DEF-SQLITE-13` **a blank column name colliding with a literal column_N cannot be opened** - MINOR; `CREATE TABLE t (\"\" TEXT, column_0 TEXT)` returns 400 'column with name column_0 has more than one occurrence'; cause polars names an unnamed result column `column_0`, which collides with the real one; fix not applied - the collision is inside `read_database` before any of our code sees the names; `readers.py`
  - evidence: test_sqlite_blank_column_name_does_not_collide_with_column_0 green - columns Unnamed: 0, column_0; alias mutation killed
  - test-tags: UNIT
  - repro: CREATE TABLE t ("" TEXT, column_0 TEXT), open t
  - log: 2026-08-11T00:00:00Z @kj reported: found by the pandas differential sweep for DEF-4; pandas opened it with both columns
  - log: 2026-09-14T20:43:06Z @kj edited repro (added) and test-tags (added)
  - log: 2026-09-14T20:43:06Z @kj closed: fixed: the select list aliases a blank column name to Unnamed: <position> through \_header_names, before read_database names it

## Export `EXPORT`

the five export formats and what each one writes

- [x] `DEF-EXPORT-6` **Excel date column exports with a spurious zero time** - MINOR; a timestamp column read from .xlsx exports to csv and tsv as `2023-02-25T00:00:00.000000` where pandas wrote `2023-02-25`; cause openpyxl returns datetime for a date-formatted cell and polars' csv writer always emits full ISO form, whereas pandas dropped a zero time component; fix not applied - either cast a timestamp column whose times are all zero to Date, or pass an explicit `datetime_format`, both of which reach beyond the pandas swap; `routes.py`
  - evidence: test_csv_export_writes_a_date_only_column_without_a_zero_time green - 2023-02-25 written, a column holding 09:30 keeps its timestamps; mutation killed
  - test-tags: INTEGRATION
  - repro: xlsx with a date-formatted cell, export csv
  - log: 2026-08-10T00:00:00Z @kj reported: found while verifying the export-parity claims for the pandas removal (DEF-4); reproduced on data/sample_data.xlsx join_date
  - log: 2026-09-14T20:43:06Z @kj edited repro (added) and test-tags (added)
  - log: 2026-09-14T20:43:06Z @kj closed: fixed: \_date_only_datetimes casts a Datetime column whose every value is at midnight to Date for the csv and tsv writers
- [x] `DEF-EXPORT-8` **a decimal256 column cannot be exported in any format** - MINOR; a parquet holding a decimal column of precision above 38 browses and reports statistics normally, then every export returns 500; cause `pl.from_arrow` panics in Rust with `operator does not support primitive Int256` before the format branch, so parquet dies with the rest; regression - pandas exported it as `1.25`; fix not applied - restoring it means an arrow-side cast to decimal128 or string that no other type needs, and precision above 38 does not fit decimal128 at all; `routes.py`
  - evidence: test_download_wide_decimal_exports_as_text green for csv, jsonl, parquet and xlsx - 1.25 intact, null intact; mutation killed
  - test-tags: INTEGRATION
  - repro: parquet holding a decimal256 column, export any format
  - log: 2026-08-10T00:00:00Z @kj reported: found by bug-hunter review of the pandas removal (DEF-4); until the PanicException arm was added this left the request with no status and no body at all, which the frontend could not report
  - log: 2026-09-14T20:43:06Z @kj edited repro (added) and test-tags (added)
  - log: 2026-09-14T20:43:06Z @kj closed: fixed: \_exportable_table casts decimal256 to string on the arrow side before pl.from_arrow
- [x] `DEF-EXPORT-9` **nested and duration columns no longer export to csv or tsv** - MINOR; a parquet column of type list, struct, map or duration returns 500 for csv and tsv; cause polars' csv writer raises ComputeError on all four; jsonl is unaffected and writes them (`{"a":[1,2]}`, `"PT1S"`), except for a Binary nested inside a List or Struct, which the top-level hex cast does not match and which panics in write_ndjson; regression - pandas wrote a representation for each (`[1 2]`, `{'a': 1}`, `[('k', 1)]`, `1 days`); fix not applied - a faithful serialisation needs a different expression per type, which costs more than the defect; `routes.py`
  - evidence: test_csv_export_writes_nested_and_duration_columns and test_jsonl_export_writes_a_nested_binary_as_hex green; both branches mutation-killed
  - test-tags: INTEGRATION
  - repro: parquet with list, struct and duration columns, export csv; a list of binary, export jsonl
  - log: 2026-08-10T00:00:00Z @kj reported: found by architect and bug-hunter review of the pandas removal (DEF-4); the round-1 decline claiming pandas also failed here was wrong, measured. The grid already 500s on such a column, so reaching this needs a hand-built request
  - log: 2026-09-14T20:43:07Z @kj edited repro (added) and test-tags (added)
  - log: 2026-09-14T20:43:07Z @kj closed: fixed: \_exportable_table renders nested columns as JSON and duration as str for csv and tsv, and a nested binary as JSON with hex bytes for jsonl
  - log: 2026-09-14T22:55:05Z @kj round-1 goal-sweep review: a list, struct or map parquet column is now read as JSON text (DEF-LOAD-26), so every export format, parquet and jsonl included, writes it as text; \_exportable_table keeps only decimal256 and duration; both tests green unchanged
- [x] `DEF-EXPORT-14` **xlsx export loses the sign of an infinity** - MINOR; a float column holding +inf and -inf writes both as the same `#DIV/0!` error cell, so the two become byte-identical; cause xlsxwriter maps every non-finite float to that error; pandas wrote the text 'inf' and '-inf'; fix not applied - it needs a pre-pass over float columns for a value parquet rarely carries; `routes.py`
  - evidence: measured: +inf and -inf both land as #DIV/0!; no test, the decision is not to change the writer
  - test-tags: MANUAL
  - repro: float column holding inf and -inf, export xlsx
  - log: 2026-08-11T00:00:00Z @kj reported: found by the pandas differential sweep for DEF-4
  - log: 2026-09-14T20:43:07Z @kj edited repro (added) and test-tags (added)
  - log: 2026-09-14T20:43:07Z @kj closed: wontfix: xlsxwriter maps every non-finite float to #DIV/0! and polars exposes no per-cell override; keeping the sign means writing the whole column as text, which costs every numeric cell in it for a value parquet rarely carries
- [x] `DEF-EXPORT-15` **a null in a single-column csv export writes a bare blank line** - MINOR; a one-column numeric table with a null exports as `v\n1.5\n\n`, which any consumer skipping blank lines reads as one row; cause polars writes an unquoted empty field where pandas wrote `\"\"`; multi-column tables are unaffected, having a delimiter on the line; fix not applied - `quote_style` would change every other cell's quoting; `routes.py`
  - evidence: test_single_column_csv_export_quotes_a_null green - one column writes "", two columns keep the empty field; mutation killed
  - test-tags: INTEGRATION
  - repro: one-column table with a null, export csv
  - log: 2026-08-11T00:00:00Z @kj reported: found by the pandas differential sweep for DEF-4; the extension's own reader still recovers both rows
  - log: 2026-09-14T20:43:07Z @kj edited repro (added) and test-tags (added)
  - log: 2026-09-14T20:43:07Z @kj closed: fixed: a one-column csv or tsv export writes its null as a quoted empty field
- [x] `DEF-EXPORT-25` **numeric filter on a wide integer column is dropped from the export** - MAJOR; a number filter on an integer column holding a value past 2\*\*53 narrows the grid but not the download; the \_filtered csv carries every row
  - evidence: test_numeric_filter_on_a_wide_integer_column_is_applied_to_the_export green with one data row; reverting the change fails it; 178 pytest
  - repro: csv with ids 9223372036854775808, 12, 7; filter id > 100; export csv
  - test-tags: INTEGRATION
  - root-cause: 2026-09-14T22:52:53Z @kj the download handler compared the column with a python float inside the arm meant for a non-numeric entry; pyarrow refuses that compare with ArrowInvalid, which is a ValueError, so the filter was skipped; commit 028146f fixed only the grid handler
  - log: 2026-09-14T22:52:53Z @kj added
  - log: 2026-09-14T22:55:05Z @kj closed: fixed: the download number filter builds its scalar with \_numeric_scalar and calls the kernel outside the try, as the grid handler does
- [x] `DEF-EXPORT-27` **timezone-aware midnight column exports as the previous day's date** - MEDIUM; a parquet timestamp column with a time zone east of UTC, every value at local midnight, exports to csv or tsv as bare dates one day early: 2024-01-01 00:00+01:00 is written as 2023-12-31
  - evidence: test_csv_export_keeps_timestamps_of_a_timezone_aware_midnight_column green; red before the fix with 2023-12-31; 185 pytest
  - repro: parquet with Europe/Warsaw timestamps at midnight, export csv
  - test-tags: INTEGRATION
  - root-cause: 2026-09-14T23:21:34Z @kj \_date_only_datetimes casts an all-midnight Datetime column to Date without checking its time zone, and polars takes the UTC date
  - log: 2026-09-14T23:21:34Z @kj added
  - log: 2026-09-14T23:21:35Z @kj closed: fixed: \_date_only_datetimes leaves a timezone-aware column as timestamps
- [x] `DEF-EXPORT-31` **a negative elapsed time renders as -1 day, 23:55:00** - MINOR; a duration of minus five minutes shows in the grid and exports to csv or tsv as -1 day, 23:55:00
  - evidence: measured: -5 minutes renders as -1 day, 23:55:00 in the grid and in csv; decision recorded, no code change
  - repro: parquet duration column holding -5 minutes, open it
  - test-tags: MANUAL
  - root-cause: 2026-09-14T23:21:35Z @kj str(timedelta) normalises a negative duration to a negative day count plus a positive time
  - log: 2026-09-14T23:21:35Z @kj added
  - log: 2026-09-14T23:21:35Z @kj closed: wontfix: str(timedelta) is Python's lossless standard form, and pandas wrote -1 days +23:55:00, which is no clearer; a formatter of its own at two sites for a rare value costs more than the reading gains

## Excel reader `EXCEL`

reading .xlsx worksheets through openpyxl, typed by polars

- [x] `DEF-EXCEL-7` **second and later blank CSV headers are named \_duplicated_0 rather than Unnamed: N** - MINOR; a csv with more than one blank header yields columns named `Unnamed: 1`, `_duplicated_0`, `_duplicated_1` where pandas named every one `Unnamed: <position>`; cause polars leaves only the first blank header empty and names the rest itself, and `_name_unnamed_columns` rewrites only the empty one; fix not applied - a synthesised name cannot be told apart from a column a file genuinely carries under it, so renaming would silently rewrite real headers; `readers.py`
  - evidence: test_csv_headers_are_named_as_pandas_named_them green - a,,,d gives Unnamed: 1 and Unnamed: 2, a,a,b gives a.1, the to_csv round-trip shape gives Unnamed: 0.1; mutation killed
  - test-tags: UNIT
  - repro: csv whose header line is a,,,d - read the column names
  - log: 2026-08-10T00:00:00Z @kj reported: found by probe while verifying the DEF-4 blank-header fix; no functional impact - every column still reaches the frontend with a non-empty name, pinned by test_excel_every_blank_header_gets_a_usable_name
  - log: 2026-08-11T00:00:00Z @kj narrowed to csv only: the Excel reader now builds its own header names, so every blank worksheet header is numbered positionally exactly as pandas numbered it. Verified on a sheet with three blank headers
  - log: 2026-09-14T20:43:06Z @kj edited repro (added) and test-tags (added)
  - log: 2026-09-14T20:43:06Z @kj closed: fixed: \_read_delimited reads the header row raw and names it through \_header_names, as the Excel reader does; \_name_unnamed_columns deleted
- [x] `DEF-EXCEL-17` **whole number stored with a decimal point reads as float** - MINOR; a cell whose stored value is `1.0` reads as float64 and exports with a `.0` tail, where pandas' `_convert_cell` coerced it to int64 (pandas/io/excel/\_openpyxl.py:606); cause: the reader takes openpyxl's raw float rather than testing `int(v) == v` per cell; wontfix-deliberate: the file's own stored value is `1.0`, so writing `1.0` is the faithful reading and pandas' coercion is the divergence; neither Excel nor openpyxl emits this form, so it needs a third-party writer to reach; `readers.py`
  - evidence: reachable only through a third-party writer - neither Excel nor openpyxl emits the form; decision recorded, no code change
  - test-tags: MANUAL
  - repro: xlsx whose cell XML stores <v>1.0</v>, read the column type
  - log: 2026-08-11T00:00:00Z @kj reported: reported by round-4 review with a byte-level fixture; not reproducible through openpyxl's writer, which normalises a whole number to <v>1</v>
  - log: 2026-09-14T20:43:07Z @kj edited repro (added) and test-tags (added)
  - log: 2026-09-14T20:43:07Z @kj closed: wontfix: the file's stored value is 1.0 and reading it as 1.0 is the faithful reading; pandas' int coercion was the divergence
- [x] `DEF-EXCEL-18` **.xls is claimed by the backend but registered by no frontend file type** - MINOR; the backend types `.xls` as excel and both openpyxl call sites now open one, but `docRegistry.addFileType` registers only `.xlsx` (`src/index.ts:269`), so no file-browser route delivers a `.xls` path to the handlers and the viewer is never offered for one; cause: `get_file_type` has claimed the extension since before the polars swap while the frontend never did; a genuine legacy BIFF `.xls` would still fail - openpyxl reads only the zip-based format and xlrd is not a dependency; `src/index.ts`, `readers.py`
  - evidence: galata 'should open an .xlsx saved under the old .xls name' green - rows and columns render; 28/28 galata on the installed wheel; a genuine BIFF .xls still fails in openpyxl, recorded in the changelog
  - test-tags: E2E, INTEGRATION
  - repro: upload an .xlsx as legacy.xls, double-click it in the file browser
  - log: 2026-08-11T00:00:00Z @kj reported: surfaced by the round-4 review while fixing the xlsx-named-.xls 500. Recorded rather than fixed: registering the extension would advertise support for legacy BIFF files this extension cannot read, and was not asked for
  - log: 2026-09-14T20:50:34Z @kj edited repro (added) and test-tags (added)
  - log: 2026-09-14T20:50:34Z @kj closed: fixed: the excel file type registers .xls beside .xlsx, so the file browser routes it to the viewer
- [x] `DEF-EXCEL-19` **a text cell spelling an Excel error code reads as missing** - MINOR; a cell whose literal text content is `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, `#NUM!` or `#NULL!` now reads as missing, where pandas kept the string; cause: `iter_rows(values_only=True)` discards `cell.data_type`, so the reader cannot tell a real error cell from text spelling the same code and matches on the string set (`_EXCEL_ERRORS`, `readers.py:129`); `#N/A` is unaffected, it was already in pandas' missing-value set; wontfix-deliberate: the divergence is narrower than the one it fixes - a real broken formula retyped its whole column - and reading `data_type` instead of `values_only` would rewrite the read loop with its trim, header and kind logic; `readers.py`
  - evidence: measured: a literal #REF! text cell reads as missing; reading data_type per cell rewrites the read loop; decision recorded
  - test-tags: MANUAL
  - repro: type the literal text #REF! into a cell, open the sheet
  - log: 2026-08-11T00:00:00Z @kj reported: accepted cost of the round-4 broken-formula fix, surfaced by the round-4 adjudication rather than by a lens
  - log: 2026-09-14T20:43:07Z @kj edited repro (added) and test-tags (added)
  - log: 2026-09-14T20:43:07Z @kj closed: wontfix: values_only discards cell.data_type, so a text cell spelling an error code cannot be told from a broken formula; a text cell reading as missing is the narrower loss than a broken formula retyping its whole column
- [x] `DEF-EXCEL-22` **a column of numeric text reads as text, losing numeric sorting and aggregates** - MEDIUM; cells holding numbers as text - `"1"`, `"10"`, a zip code `"00501"` - read as text where pandas coerced them to numbers, so the column sorts lexicographically (`1, 10, 2`) and its statistics carry no min, max, mean or median; cause: pandas routed worksheet values through its `TextParser`, which coerced numeric-looking strings; `_column_series` types a column whose every value is kind `text` as String; fix: the column STAYS text, because text is what the file stores and coercing it would destroy the leading zeros pandas also destroyed - instead `numeric_view` gives the sort key and the aggregates a numeric reading of the same values, so `00501` still exports as `00501` while the column sorts `1, 2, 10` and reports min, max and mean; `stats.py`, `routes.py`
  - log: 2026-08-11T00:00:00Z @kj reported: surfaced by the round-5 bug-hunter review, measured against pandas on both a plain numeric-text column and a leading-zero one. Not caught by the 784-case differential sweep, whose fixtures were generated through openpyxl
  - log: 2026-08-11T00:00:00Z @kj fixed: fixed on the user's instruction, not recorded: the column stays text (zip codes keep leading zeros) and numeric_view supplies the sort key and aggregates. Verified - stored ['1','10','2'] and ['00501','01234','90210'], grid sort asc gives 1,2,10, stats min 1 max 10 mean 4.33 with data_type still string; a genuinely non-numeric column is untouched. Mutation-verified
  - log: 2026-08-11T00:00:00Z @kj scope of the fix, named by the round-6 architect: sorting and statistics are numeric, FILTERING still treats the column as text - metadata reports string, so the widget offers a substring filter and a '>5' expression matches nothing. Deliberate: the column is text, and a numeric filter on it is a separate change to the filter layer
  - log: 2026-08-11T00:00:00Z @kj applies to every format, not only worksheets - a SQLite TEXT column and a parquet string column of numbers now sort numerically too, measured. CHANGELOG corrected to say so
- [x] `DEF-EXCEL-23` **a spreadsheet integer beyond 128 bits is silently read as missing** - MINOR; a numeric cell holding an integer at or above 2\*\*127 arrives as null with no error and no trace in the response; cause: `_column_series` builds the column with `pl.Series(..., strict=False)`, which inserts null for a value the inferred dtype cannot hold, and the mixed-kind guard does not fire because every value is kind `number`; fix: `_column_series` counts the resulting nulls against the values supplied and rebuilds the column as text when they disagree, so every digit survives; one count per column, and it catches any silent-null loss rather than only this one; `readers.py`
  - log: 2026-08-11T00:00:00Z @kj reported: surfaced by the round-5 bug-hunter review; measured at 2\*\*127 and 2\*\*200, both giving a null beside an intact neighbour
  - log: 2026-08-11T00:00:00Z @kj fixed: fixed on the user's instruction, not recorded: a lost value now rebuilds the column as text. Verified end-to-end with a raw sheet-XML fixture holding a 39-digit <v>, which openpyxl reads as a python int - all 39 digits survive as text where the value was previously null. Plain ints stay int64 and real blanks stay null. Mutation-verified

## Delimited reader `DELIM`

reading CSV and TSV - encodings, headers, missing-value markers

- [x] `DEF-DELIM-10` **a blank or whitespace-only line becomes a phantom row** - MINOR; a csv or tsv containing an empty line yields an extra row of nulls - `a,b\n1,2\n3,4\n\n` reads as 3 rows - and a line of only spaces additionally retypes its column to text; cause pandas skipped blank lines by default (`skip_blank_lines`) and polars' `read_csv` has no equivalent; fix not applied - filtering all-null rows after the parse would also drop a genuine `,,` row that pandas kept; `readers.py`
  - evidence: test_csv_blank_lines_are_skipped_as_pandas_skipped_them green over four shapes; test_csv_blank_line_inside_a_quoted_field_is_content pins the quoted limit; mutation killed
  - test-tags: UNIT
  - repro: csv a,b then 1,2 then an empty line then 3,4 - count rows
  - log: 2026-08-11T00:00:00Z @kj reported: found by the pandas differential sweep for DEF-4 (784 cases)
  - log: 2026-09-14T20:43:06Z @kj edited repro (added) and test-tags (added)
  - log: 2026-09-14T20:43:06Z @kj closed: fixed: \_delimited_source drops empty and whitespace-only lines before polars parses, only in a file holding no quote character; a row of empty fields stays
  - log: 2026-09-14T22:55:04Z @kj round-1 goal-sweep review: a tsv line of tabs alone, which Excel's tab-delimited export writes for an empty row, was deleted as blank while its csv twin ,, stayed; tab removed from both blank classes in \_delimited_source; tsv case added to test_csv_blank_lines_are_skipped_as_pandas_skipped_them, fails when the change is reverted
- [x] `DEF-DELIM-11` **a lone-CR line terminator loses every row** - MINOR; a classic-Mac or old Excel-for-Mac csv using bare CR reads as 0 rows with the data absorbed into invented column names - `a,b\r1,2\r3,4\r` gives 4 columns and no rows; cause polars treats only LF and CRLF as terminators where pandas also accepted CR; fix not applied - detecting and rewriting the terminator means reading the file before parsing it; `readers.py`
  - evidence: test_csv_with_bare_cr_line_endings_opens green - 2 columns, 2 rows; mutation killed
  - test-tags: UNIT
  - repro: csv terminated by bare CR - a,b CR 1,2 CR 3,4 CR
  - log: 2026-08-11T00:00:00Z @kj reported: found by the pandas differential sweep for DEF-4
  - log: 2026-08-11T00:00:00Z @kj round-5 review: the statistics request on this shape also returned 500, because pc.sum over a zero-row column gave null and int(None) raised TypeError. That 500 is now fixed in stats.py; the 0-row reading with invented column names stands as recorded
  - log: 2026-09-14T20:43:06Z @kj edited repro (added) and test-tags (added)
  - log: 2026-09-14T20:43:06Z @kj closed: fixed: \_delimited_source rewrites bare CR to LF when the first 64 KB holds CR and no LF
  - log: 2026-09-14T22:55:05Z @kj round-1 goal-sweep review: a UTF-16 csv with bare-CR endings, as Excel 2011 for Mac wrote it, still opened as 0 rows because the UTF-16 branch returned before the CR rewrite; the CR test now runs on the decoded bytes; utf-16 case added to test_csv_with_bare_cr_line_endings_opens, fails when the change is reverted
- [x] `DEF-DELIM-12` **an unterminated quote opens silently instead of raising** - MINOR; `\"a,b\n1,2\n` returns one column whose NAME is the rest of the file, where pandas raised ParserError and the request was a 400; cause polars accepts an unclosed quote to end of file; fix not applied - no polars option rejects it, and the file does open, so the cost is a confusing table rather than lost data; `readers.py`
  - evidence: measured: "a,b then 1,2 yields one column named with the rest of the file; decision recorded
  - test-tags: MANUAL
  - repro: csv whose first field opens a quote that never closes
  - log: 2026-08-11T00:00:00Z @kj reported: found by the pandas differential sweep for DEF-4
  - log: 2026-08-11T00:00:00Z @kj round-5 review: the entry understated the cost - the statistics request on the opened table returned 500, not merely a confusing table. That 500 is now fixed in stats.py
  - log: 2026-09-14T20:43:07Z @kj edited repro (added) and test-tags (added)
  - log: 2026-09-14T20:43:07Z @kj closed: wontfix: polars has no option to reject an unclosed quote, and the file opens with its data visible under a confusing column name - no data is lost
- [x] `DEF-DELIM-16` **UTF-16 csv returns 400 where pandas opened it** - MINOR; a UTF-16 csv - what Excel's 'Unicode Text' export writes - returns HTTP 400 'Cannot read csv file: ... NulError'; cause: every UTF-16 file carries a NUL byte inside its first header name and polars' arrow FFI panics on it (polars-arrow/src/ffi/schema.rs:119), mapped to ValueError so the request is a clean 400; wontfix-deliberate: pandas' latin1 retry opened the same bytes as one column named 'yTHORNa' with mojibake values, and a message is the more honest outcome than silently wrong text; `readers.py`
  - evidence: test_utf16_csv_opens_with_its_columns_intact green for utf-16 (BOM) and utf-16-be (no BOM) - columns a,b and values intact; mutation killed
  - test-tags: UNIT
  - repro: save a csv as UTF-16 (Excel Unicode Text), open it
  - log: 2026-08-11T00:00:00Z @kj reported: found by the round-4 differential review; the panic-to-400 mapping is itself a round-3 fix (test_utf16_csv_is_a_400_not_a_dead_socket) - before it the request died with no status and no body
  - log: 2026-09-14T20:43:06Z @kj edited repro (added) and test-tags (added)
  - log: 2026-09-14T20:43:06Z @kj closed: fixed: \_delimited_source decodes a UTF-16 file on its BOM, or on the NUL in its first two bytes, to UTF-8 bytes before polars parses
- [x] `DEF-DELIM-21` **an integer wider than 128 bits keeps a csv unopenable** - MINOR; a csv or tsv holding an integer of 39 or more digits returns 400 `could not parse ... as dtype 'i128'` and the file does not open; cause: polars infers Int128 for anything at or above 2\*\*63 and raises inside `read_csv` when the literal exceeds it, so `_cast_unsupported_columns_to_string` - which recasts Int128 to text - never runs, because inference itself failed; wontfix-deliberate: reading the whole file as text to survive one oversized literal would lose every other column's type, and a 400 with a message is a better outcome than the 500 with an OverflowError traceback pandas produced for the same file; up to 38 digits opens as text; `readers.py`
  - evidence: test_csv_integer_wider_than_int128_opens_as_text green - the 40-digit value survives as text, the neighbour stays int64; mutation killed
  - test-tags: UNIT
  - repro: csv holding a 40-digit integer, open it
  - log: 2026-08-11T00:00:00Z @kj surfaced by the round-5 architect review as an unbounded docstring claim; measured at 19, 20, 31 and 39 digits, and against v1.7.11 where the same file was a 500
  - log: 2026-09-14T20:43:06Z @kj edited repro (added) and test-tags (added)
  - log: 2026-09-14T20:43:06Z @kj closed: fixed: the read is retried with the column the ComputeError names typed as text; every other column keeps its inferred type
- [x] `DEF-DELIM-29` **a csv line holding only a tab becomes a row** - MINOR; a blank line in a csv that holds a tab reads as an extra row and retypes the first column to text; the tsv reading is unaffected
  - evidence: test_csv_blank_lines_are_skipped_as_pandas_skipped_them green over seven shapes, among them the csv tab-only line and a tsv tab row beside a skipped blank line; red before the fix; 185 pytest
  - repro: csv a,b then 1,2 then a tab-only line then 3,4 - count rows
  - test-tags: UNIT
  - root-cause: 2026-09-14T23:21:34Z @kj the blank-line skip stopped counting a tab as blank so that a tsv line of tabs alone stays a row, and that applied to csv as well
  - log: 2026-09-14T23:21:34Z @kj added
  - log: 2026-09-14T23:21:35Z @kj closed: fixed: \_delimited_source takes the delimiter; a tab is a blank in a csv and a field separator in a tsv
- [x] `DEF-DELIM-30` **ragged csv error message names a polars option** - MINOR; the 400 for a csv row with too many fields ends with Consider setting 'truncate_ragged_lines=True', which nobody using the viewer can act on
  - evidence: test_ragged_csv_error_names_the_problem_not_a_polars_option green; red before the fix; 185 pytest
  - repro: csv a,b then 1,2 then 3,4,5 - open it
  - test-tags: UNIT
  - root-cause: 2026-09-14T23:21:35Z @kj the reader passes polars' whole message into the 400, and polars appends a hint for its own caller after a blank line
  - log: 2026-09-14T23:21:35Z @kj added
  - log: 2026-09-14T23:21:35Z @kj closed: fixed: the reader keeps polars' message up to its first blank line

## Filtering and sorting `FILTER`

sort, filter and statistics requests on an open table

- [x] `DEF-FILTER-28` **decimal, negative or exponent number filter on a very wide integer column returns 500** - MINOR; a number filter entry of 1.5, -1 or 1e18 on an integer column holding a value past 2\*\*53 answers 500 in the grid and in the export; a whole-number entry works
  - evidence: test_numeric_filter_entry_forms_on_a_wide_integer_column green for 1.5, -1 and 1e18; red before the fix with HTTP 500; 185 pytest
  - repro: csv with ids 9223372036854775813 and 7; filter id > 1.5
  - test-tags: INTEGRATION
  - root-cause: 2026-09-14T23:21:34Z @kj \_numeric_scalar falls back to a float scalar when the entry is not an integer in range, and pyarrow refuses to compare such a column with a double
  - log: 2026-09-14T23:21:34Z @kj added
  - log: 2026-09-14T23:21:35Z @kj closed: fixed: \_numeric_scalar compares a non-integer entry on an integer column as a decimal scalar, which is exact; a non-number still adds no predicate
  - log: 2026-09-14T23:24:42Z @kj guard test added: test_non_numeric_entry_on_an_integer_column_adds_no_predicate - a text entry on an integer column leaves the table unfiltered at 200; fails with 500 when the InvalidOperation arm is removed
- [x] `DEF-FILTER-32` **text filter or unique values on a binary parquet column with non-UTF-8 bytes returns 500** - MINOR; a text filter or the unique-values list on a parquet binary column holding bytes that are not UTF-8 answers 500 with ArrowInvalid Invalid UTF8 payload
  - evidence: measured by the round-1 review adjudicator: ArrowInvalid on the string cast; decision recorded, no code change
  - repro: parquet with a binary column holding bytes ff 00, type in its filter box
  - test-tags: MANUAL
  - root-cause: 2026-09-14T23:21:35Z @kj both cast the column to string, and arrow refuses bytes that are not UTF-8
  - log: 2026-09-14T23:21:35Z @kj added
  - log: 2026-09-14T23:21:35Z @kj closed: wontfix: a raw binary parquet column is outside the files this viewer is for - SQLite BLOBs reach the grid as size placeholders, and sort and statistics on a binary column still answer
- [x] `DEF-FILTER-33` **number filter inf or -inf on an integer column returns 500** - MINOR; a number filter entry of inf or -inf on an integer column answers 500 with a TypeError traceback; before the decimal comparison it answered 200
  - evidence: test_non_numeric_entry_on_an_integer_column_adds_no_predicate green for abc, inf, -inf and nan; inf and -inf fail with 500 when the change is reverted; 189 pytest
  - repro: csv with n 5 and 7; filter n > inf
  - test-tags: INTEGRATION
  - root-cause: 2026-09-14T23:40:27Z @kj Decimal parses inf without error, and pa.scalar refuses an infinite decimal with TypeError, which the handlers' except ValueError does not catch
  - log: 2026-09-14T23:40:27Z @kj added
  - log: 2026-09-14T23:40:28Z @kj closed: fixed: \_numeric_scalar treats TypeError from an infinite decimal like a non-number, so the entry adds no predicate
  - log: 2026-09-14T23:48:19Z @kj round-4 review: with this fix an inf or -inf bound on an integer column leaves the table unfiltered, while the same bound on a float column matches no rows; deferred by the adjudicator, since a constant-true or constant-false predicate chosen per operator is a new mechanism no realistic entry needs
- [x] `DEF-FILTER-34` **number filter entry with 20 or more decimal places on an int64 column, or 19 on a uint64 column, returns 500** - MINOR; a number filter entry such as 0.0000000000000000000001 answers 500 with ArrowInvalid Decimal precision out of range [1, 38] on an int64 column from 20 decimal places and on a uint64 column from 19; an int32 column still compares at 20; before the decimal comparison it answered 200
  - evidence: measured by the round-3 review architect: 500 with Decimal precision out of range [1, 38]: 41, while 1.5, -1, 1e18, 1E5 and 12345678901234567890.5 compare correctly; decision recorded, no code change
  - repro: csv with n 5 and 7; filter n > 0.0000000000000000000001
  - test-tags: MANUAL
  - root-cause: 2026-09-14T23:40:27Z @kj comparing a decimal128 entry with 22 decimal places against int64 needs 41 digits of precision, and pyarrow does not widen decimal128 to decimal256
  - log: 2026-09-14T23:40:27Z @kj added
  - log: 2026-09-14T23:40:28Z @kj closed: wontfix: nobody filtering integer ids or counts types a bound with 20 decimal places; capping the entry's scale correctly needs rounding in a direction chosen per operator, a branch no realistic entry needs
  - log: 2026-09-14T23:48:47Z @kj edited title and text
