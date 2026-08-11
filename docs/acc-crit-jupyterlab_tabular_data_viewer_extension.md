# Acceptance Criteria - JupyterLab Tabular Data Viewer Extension

Consolidated criteria for the extension. One `##` section per feature area; `[ ]` todo, `[x]` done, with a dated `log:` line under each criterion.

## Contents

- [Large database handling](#large-database-handling)
- [Export](#export)
- [Reader engine](#reader-engine)

## Large database handling

A tabular file must open without the browser fetching its contents, and BLOB contents must never leave the server. Two mechanisms: the document context loads no file content, and the SQLite reader builds BLOB placeholders in SQL rather than in Python.

Filtering, sorting and statistics are global - they always see every row. Only the rendered window is local, bounded by the `rowsPerPage` setting. The window is cut in arrow from a cached table rather than pushed into SQL as a `LIMIT`/`OFFSET`; the Progressive load section records why that was tried and rejected.

| Functionality  | Plain browse       | Sort active        | Filter active      |
| -------------- | ------------------ | ------------------ | ------------------ |
| Scope of read  | whole table        | whole table        | whole table        |
| First read     | from disk          | from disk          | from disk          |
| Repeat read    | from cache         | from cache         | from cache         |
| Row window     | arrow slice        | arrow slice        | arrow slice        |
| BLOB handling  | placeholder in SQL | placeholder in SQL | placeholder in SQL |
| Row count      | full read length   | full read length   | arrow, post-filter |
| Regex matching | -                  | -                  | arrow only         |

### Document loading

- [x] **No content fetch** - opening any tabular file issues no content-bearing `/api/contents` request; the document context requests `content: false`
  - log: 2026-08-09 criterion added, addresses DEF-1
  - log: 2026-08-09 closed: verified by galata 'should open a SQLite database without fetching its contents' - asserts on the wire that no /api/contents request carries content=1
- [x] **Model factory** - a no-content model factory with `fileFormat: null` is registered and both widget factories reference it by name
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 closed: NoContentModelFactory registered unconditionally at src/index.ts:351, both widget factories use modelName NO_CONTENT_MODEL
- [ ] **Open cost independent of file size** - time from double-click to first rendered row does not scale with file size; a 500 MB database opens in the same order of time as a 50 KB one
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 partially verified - the 8MB generated database opens in the same galata budget as the 44KB fixture; no >384MB timing measured
- [ ] **Edge: file larger than the V8 string limit** - a file whose base64 encoding would exceed `MAX_STRING_LENGTH` (536,870,888 chars, i.e. any file above ~384 MB) opens normally instead of failing
  - log: 2026-08-09 criterion added, this is the reported failure
  - log: 2026-08-09 not directly tested - a >384MB fixture cannot be generated in CI; covered indirectly by the wire assertion that no content-bearing request is made at all, which makes the limit unreachable regardless of size
- [ ] **Edge: context still resolves path and metadata** - `context.path` and file-changed signals continue to work with no content loaded
  - log: 2026-08-09 criterion added
- [x] **Regression: other formats unaffected** - parquet, xlsx, csv and tsv keep opening correctly under the no-content model
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 closed: galata parquet, csv and xlsx tests pass under the no-content model

### BLOB handling

- [x] **Placeholder built in SQL** - the select list wraps every column so a BLOB yields `<BLOB n.n KB>` from SQLite; BLOB bytes are never read into the dataframe layer or arrow
  - log: 2026-08-09 criterion added, addresses DEF-2
  - log: 2026-08-09 closed: \_blob_placeholder_sql; test_blob_bytes_are_never_materialised bounds peak allocation at a tenth of the payload
- [x] **Placeholder format unchanged** - the rendered string matches the existing convention (B / KB / MB, one decimal, trailing zeros dropped)
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 closed: test_blob_placeholder_sql_matches_python_formatter parametrised over 10 sizes against \_format_blob_size
  - log: 2026-08-09 corrected - the test named in the previous line no longer exists, nor does \_format_blob_size. Pinned instead by test_blob_placeholder_size_rendering over 14 literal expected strings. Note a deliberate behaviour change: SQL rounds half away from zero where the deleted Python twin rounded half to even, so a 1,280-byte BLOB now renders 1.3 KB rather than 1.2 KB
- [x] **Exports carry placeholders** - every export format writes the placeholder string, never binary
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 closed: test_download_carries_blob_placeholders_not_binary - csv and jsonl contain '<BLOB 256 B>' and no raw byte runs
- [x] **Memory bound** - reading a table holding 299 MB of BLOBs allocates on the order of the placeholder text, not the BLOB bytes
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 closed: 128 MB BLOB table reads in 0.004 s at +5 MB RSS; forcing a real payload read costs 0.059 s
- [x] **Edge: NULL in a BLOB column** - renders as null, not as `<BLOB 0 B>`
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 closed: test_blob_column_null_and_mixed_affinity asserts None, not a placeholder
- [x] **Edge: mixed-affinity column** - a column holding both text and BLOB values yields the text verbatim and the placeholder only for the BLOB rows
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 closed: same test - text passes through verbatim, only blob rows placeholder
- [x] **Edge: zero-length BLOB** - renders as `<BLOB 0 B>`
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 closed: same test - '<BLOB 0 B>'
- [x] **Edge: column name needing quoting** - a column named with a double quote, space or reserved word is quoted correctly in the generated select list
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 closed: test_sqlite_column_name_requiring_quoting covers space, embedded double quote and a reserved word

### Progressive load

- [x] **Cache hit** - repeat reads of an unchanged file and table return the identical cached arrow table, so a page, sort or filter after the first read costs no disk access
  - log: 2026-08-09 added
  - log: 2026-08-09 closed: test_cache_serves_repeat_reads_from_memory asserts object identity; feed_scan 633.7 ms -> 0.03 ms on the reported database
- [x] **Cache invalidation** - an edited file is re-read and its superseded entry is dropped; the key carries absolute path, sheet, mtime_ns and size
  - log: 2026-08-09 added
  - log: 2026-08-09 closed: test_cache_invalidates_on_modification - edited file re-read and the superseded entry dropped
  - log: 2026-08-09 corrected - the key also carries the -wal sidecar's mtime_ns and size, missing sidecar as (0,0); without it an un-checkpointed WAL commit from an open writer was invisible and re-reading could not cure it
- [x] **Cache budget** - total cached bytes stay under a fixed budget (256 MB), evicting least-recently-used first; a single table larger than the whole budget is served but not cached
  - log: 2026-08-09 added
  - log: 2026-08-09 closed: test_cache_evicts_least_recently_used_within_its_budget and test_cache_skips_a_table_larger_than_the_whole_budget
  - log: 2026-08-09 corrected - test_cache_evicts_least_recently_used_within_its_budget was deleted (it never actually evicted: 3,443 bytes against a 4,096 budget). Covered by test_cache_byte_counter_tracks_contents_and_recency_is_lru, which sizes the budget from measured nbytes so an eviction really happens and fails if LRU degrades to FIFO
- [x] **Cache safety** - arrow tables are immutable and every consumer returns a new table, so one cached instance is shared without copying
  - log: 2026-08-09 added
  - log: 2026-08-09 closed: both reviewers traced every consumer independently - routes.py append_column/filter/take/slice and all of stats.py derive rather than mutate; Table.nbytes verified stable across 200 calls, which is what makes the byte accounting exact
- [ ] **Configurable window** - the rendered window size is a `rowsPerPage` setting (default 500), not a hardcoded constant; changing it does not affect filter, sort or statistics scope
  - log: 2026-08-09 added
  - log: 2026-08-09 wired through schema/plugin.json, ISettings and the widget constructor; no automated test - would need a jest test of the widget constructor
- [ ] **Metadata without full read** - metadata for a SQLite source returns columns from `PRAGMA table_info` and row count from `COUNT(*)`, reading no rows
  - log: 2026-08-09 criterion added, addresses DEF-3
  - log: 2026-08-09 deferred - PRAGMA table_info reports SQLite declared types (INTEGER/REAL), but the frontend matches arrow type names and isNumeric() substring-matches them, so switching would change displayed types and numeric filtering; see DEF-3
  - log: 2026-08-09 if ever implemented, note the criterion text above names the wrong pragma: table_info omits generated columns, so a column list must come from table_xinfo filtered on hidden != 1
- [ ] **Row window pushdown** - a plain browse request reads only the requested page via `LIMIT`/`OFFSET`
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 rejected - pandas infers dtype from the rows given, so a window disagrees with the full table on any nullable or mixed-class column; every table in the reported database is nullable, so a safe gate would never fire
  - log: 2026-08-09 if ever revisited: the cache key does not include offset/limit, so a window would be silently served from a cached full table unless they are folded in; and the nullable-column guard test does NOT detect a reintroduced pushdown - it compares its own hand-built window, not the reader's
- [ ] **Pushdown equivalence** - a paged read returns rows identical to slicing the full read, for every table in the fixture
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 rejected with the pushdown; the equivalence test caught the mismatch and was replaced by a stability guard
- [x] **Fallback on sort** - a sorted request falls back to the full read and the existing arrow sort, preserving current ordering semantics
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 closed: test_data_endpoint_sort_is_global_not_page_local asserts against the true global ordering across two pages
- [x] **Fallback on filter** - a filtered request falls back to the full read; filters are never pushed into SQL because the frontend offers regex and SQLite has no `REGEXP` operator
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 closed: test_data_endpoint_filter_is_global_not_page_local
- [ ] **Edge: offset beyond end of table** - returns an empty page, not an error
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 not applicable while the full read is sliced in arrow
- [x] **Edge: empty table** - a table with zero rows reports 0 rows and renders an empty grid with correct column headers
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 closed: test_empty_and_single_row_tables - zero rows, columns still reported
- [x] **Edge: single-row table** - `meta`-style one-row table paginates correctly
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 closed: test_empty_and_single_row_tables
- [ ] **Edge: table renamed or dropped between requests** - returns HTTP 400 with a readable message, not 500
  - log: 2026-08-09 criterion added

### Verification

- [x] **Synthetic fixture** - a generated database, not the user's private data, drives every test; committed fixture stays small and a larger one is generated at test time
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 closed: committed fixture stays 8 tables small; scripts/make_sample_database.py --blob-db generates the larger one at test time
- [x] **Galata: no content fetch** - a network assertion proves opening a `.db` issues no content-bearing `/api/contents` request
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 closed: galata test 14 green
- [x] **Galata: BLOB placeholder** - a BLOB cell renders the placeholder text in the grid
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 closed: galata 'should render BLOB cells as placeholders' green
- [x] **Galata: large database opens** - a synthetic database well above the previous failure threshold opens and renders rows
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 closed: galata test 15 green - 8 MB generated database, payloads tab shows '<BLOB 1 MB>'
- [ ] **Galata: paging** - advancing a page on a large table renders the next window
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 not added - paging is arrow-side and unchanged by this work, so a new galata test would assert pre-existing behaviour; revisit if the window is ever pushed into SQL
- [x] **pytest: placeholder in SQL** - a test asserts the BLOB bytes are not materialised, not merely that the output string is right
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 closed: asserts peak allocation, not just the output string
- [x] **Existing suites stay green** - 50 pytest, 13 galata and the jest test continue to pass
  - log: 2026-08-09 criterion added
  - log: 2026-08-09 closed: 72 pytest (was 50), 15 galata (was 13), tsc exit 0
  - log: 2026-08-09 corrected - the earlier close was premature: galata test 15 failed on its first run (default 5000ms on a grid assertion that omitted GRID_TIMEOUT) and passed only on the re-run; timeout added, suite must be green twice before this is closed
  - log: 2026-08-09 reopened: reopened pending two consecutive green galata runs
  - log: 2026-08-09 closed: two consecutive galata runs 15/15 (8.0m and 7.0m, both exit 0), 80 pytest, tsc exit 0 - closed only after the second green run, having been reopened when the first close rested on a single one

## Export

Export writes the whole table, never the rendered window. Filters narrow it, sorting reorders it, pagination does neither. A tabbed source names the active table in the downloaded filename.

- [x] **Export is global** - exporting a source larger than the rendered window returns every row: all five formats for a parquet source, the four offered formats for a SQLite table, and two formats each for csv and xlsx
  - log: 2026-08-10 criterion added
  - log: 2026-08-10 closed: three galata tests - parquet 1500 rows across original, xlsx, csv, parquet and jsonl; a generated 1200-row SQLite table across the four offered formats; csv and xlsx 1500 rows each. Every count is compared against the 500-row rendered window, and payloads are parsed back with scripts/count_rows.py so the assertion is on bytes that arrived, not on the request
  - log: 2026-08-10 verified the tests can fail: slicing the export to 500 rows in the download handler failed both source families at exactly 500. NB the mutation had to be applied to the INSTALLED copy in site-packages - galata drives that, not the working tree, so a backend edit is invisible to galata until make install
- [x] **Export is the right table, not just the right size** - an export of the right size taken from the wrong table must fail
  - log: 2026-08-10 criterion added after review proved counts alone are insufficient: 400 distinct rows written three times counts as 1200 in all four formats, so every count assertion would have passed
  - log: 2026-08-10 closed: the SQLite test switches to `payloads` (exactly 1 row at --mb 1) and asserts 1 - no single wrong table can satisfy both 1200 and 1
  - log: 2026-08-10 scope limit, stated rather than closed over: no assertion reads an exported cell, so a handler emitting one row repeated to the table's own length passes every count and filename. Round 2 named that surviving mutation; a content differ costs more than the gap, so the criterion claims table identity only
- [x] **Export filename carries the active table** - switching table changes the downloaded filename, not only the grid
  - log: 2026-08-10 criterion added
  - log: 2026-08-10 first close was wrong: the test asserted export_database_labels.<ext> but never switched tab, so a frontend that always sent the first table would have passed. Found by architect review
  - log: 2026-08-10 closed: the test now clicks the `payloads` tab and asserts export_database_payloads.csv, and all four exports in the csv/xlsx test assert their filenames, so an export cannot be attributed to the wrong tab
  - log: 2026-08-10 the added assertion corrected two wrong beliefs: a single-sheet workbook still carries its sheet slug (an xlsx original export is sample_data_sheet1.xlsx), and the slug applies to every output format, not only the original - so the xlsx source's CSV export is sample_data_sheet1.csv and does distinguish it from the csv source's sample_data.csv. A comment claiming the two could not be told apart was false; both are now asserted

## Reader engine

Three engines: pyarrow reads parquet, openpyxl reads an .xlsx worksheet and polars types it, and polars reads csv, tsv and sqlite and writes every export. Pandas is gone from both paths (DEF-4). What has to hold across the swap: a mixed column still resolves to text, a nullable integer stays an integer, no shape of file that used to open now fails, and every export still writes every format with the content type it had - the byte-level differences being enumerated rather than assumed absent.

- [x] **No pandas in the read or export path** - importing the extension's modules must not pull pandas into the interpreter
  - log: 2026-08-10 criterion added
  - log: 2026-08-10 closed: test_extension_does_not_import_pandas asserts in a fresh interpreter that pandas is absent from sys.modules after importing routes, readers and stats. A subprocess is what makes the assertion mean anything - an in-process check would pass or fail on whatever else imported pandas first, and once imported it never leaves
- [x] **Mixed-type column resolves to text wherever the odd value sits** - a column of integers holding one string reads as text whether the string is in row 2 or row 201
  - log: 2026-08-10 criterion added
  - log: 2026-08-10 closed: test_mixed_column_resolves_when_the_string_arrives_late plants the string past row 200 in both a csv and a SQLite table, and a galata test opens the MixedTypes sheet and asserts both classes reach the grid
  - log: 2026-08-10 this is the criterion the change nearly shipped without. `infer_schema_length=None` on the csv and SQLite reads is load-bearing, and every mixed fixture in the repo is a handful of rows, so polars' default 100-row window covered them all and the setting was untested. Mutation-verified: dropping the argument fails the new test with ComputeError, could not parse `ACCFS-108` as dtype i64
  - log: 2026-08-10 the row window applies to csv and SQLite only. Excel is read through openpyxl, which parses every cell before polars sees the column, so an .xlsx mixed column resolves the same wherever the odd value sits and needs no inference argument
- [x] **Nullable integer stays an integer** - a nullable INTEGER column exports as 42, not 42.0, and a row window agrees with a full read on its type
  - log: 2026-08-10 criterion added
  - log: 2026-08-10 closed: test_nullable_column_type_is_stable_across_any_row_window asserts int64 for both a LIMIT 10 window and the full table, and a galata test asserts the exported csv carries no decimal tail and keeps the two nulls empty
  - log: 2026-08-10 the criterion was first written against the grid and that was wrong: a mutation reintroducing the float cast left a DOM assertion green, because the backend serialises 42.0, JSON has a single number type, and JavaScript renders it "42". The promotion is only visible in an exported file, so the assertion moved there and DEF-4's own wording was corrected
- [ ] **Export keeps its formats and content types** - all five formats still export, each with the content type it had under pandas; the bytes differ in known ways, listed below rather than claimed identical
  - log: 2026-08-10 criterion added
  - log: 2026-08-10 closed: the existing export tests cover this unchanged - 18 galata plus the pytest content-type and filename matrix - so a regression in the new writers shows up as a wrong count, wrong content type or short export
  - log: 2026-08-10 the deliberate byte-level differences, all recorded in the changelog: csv and tsv write booleans lowercase (`false`) where pandas wrote `False`, and write a timestamp in full ISO form, so `sample_data.xlsx`'s join_date exports as `2023-02-25T00:00:00.000000` where pandas dropped the zero time; jsonl writes floats at round-trip precision where pandas truncated to 10 significant digits, renders a date column as `2023-02-25` rather than `2023-02-25T00:00:00.000`, separates a timestamp's date and time with a space rather than `T`, and leaves `/` unescaped. An earlier version of this log claimed jsonl was byte-identical to pandas; that was measured on one fixture whose columns happened to agree, and is false in general
  - log: 2026-08-10 a binary column is hex-encoded before every non-parquet write. Parquet is the only writer that accepts Binary, and `write_ndjson` did not raise on it but panicked in Rust - a PanicException inherits BaseException, so it passed straight through the handler's `except Exception` and left the request dead with an empty body instead of a 500
  - log: 2026-08-10 reopened: the enumeration above was incomplete in four further ways, all measured. The first cast decoded binary as strict UTF-8, so a real BLOB - image bytes, a hash - raised ComputeError and 500d every non-parquet export; hex replaces it and never fails. XLSX carries a defined table object and no autofilter row where pandas wrote a plain sheet, and its number formats needed dtype keys rather than a selector, which polars drops silently. Parquet is ZSTD where pandas wrote SNAPPY
  - log: 2026-08-10 stays open on two column types, both regressions from pandas and both recorded rather than fixed: a decimal256 column cannot be exported in any format (DEF-8), and a list, struct, map or duration column cannot be exported to csv or tsv (DEF-9) - jsonl writes all four, rendering a duration as `PT86400S` where pandas wrote `1 days`, and only a Binary nested inside one of them panics there. The round-1 decline claiming pandas also failed on nested columns was wrong - measured, it wrote `[1 2]`, `{'a': 1}`, `[('k', 1)]` and `1 days`. Both now return a 500 with a message rather than a closed connection, which is what the PanicException arm in DownloadHandler buys
- [ ] **Every shape of file that opened before still opens** - a blank column header, a blank row inside the data, an all-empty column, an empty first sheet, a blank row above the data and a header row with no data under it must not change the table's shape or fail the read
  - log: 2026-08-10 criterion added after review: polars' Excel reader defaults `drop_empty_cols`, `drop_empty_rows` and `raise_if_empty` to True, so each of these silently lost data or raised where pandas returned a table
  - log: 2026-08-10 closed: all three defaults are set False, an empty column name is replaced with the positional `Unnamed: N` pandas used, and an all-Null column is cast to string so statistics have a type to work with. Covered by the workbook-shapes tests in test_routes.py
  - log: 2026-08-10 reopened and closed again on two more shapes, both found by review after the first close. Polars takes its header from the first NON-EMPTY row, so a blank spacer row above the table consumed the first real data row - silently when the values were text, and with a TypeError that is neither a PolarsError nor a ValueError when they were numeric, giving a 500 with a traceback. A header row with no data under it returned a 0x0 frame, so a template tab opened with no columns at all. `_read_excel` now inspects the first row through openpyxl and reads with `has_header=False` for the blank-row shape, taking the names from openpyxl for the other; both outputs were measured against pandas' for the same file
  - log: 2026-08-10 the null-column cast reached two of the three readers that need it. A SQLite column NULL in every row stayed Null-typed and 500d the statistics request with ArrowNotImplementedError; `_read_sqlite` applies the same cast now. Not a regression - pandas produced a null column here too - but the swap introduced the cure and had skipped the reader where the shape is most common
  - log: 2026-08-11 reopened a third time and closed on the shape that mattered most: polars' Excel reader prefers a defined Table object over the used range and reads only the FIRST one, so a sheet structured with "Format as Table" was truncated to that table's declared range - silently, in the grid, the row count, the statistics and every export. There is no kwarg to disable it. `_read_excel` now reads the worksheet's rows through openpyxl and hands polars only the typing, which settles the table case, the header cases and the formula-header case together; the peek added on 2026-08-10 is deleted with them. Measured against pandas on the table, totals-row, two-table, formula-header, blank-first-row, header-only, trailing-blank and duplicate-header shapes - all eight agree
  - log: 2026-08-11 owning the header also fixed the naming: every blank worksheet header is now numbered by position exactly as pandas numbered it, so DEF-7 narrows to csv, where polars' `_duplicated_0` is indistinguishable from a real column of that name. A duplicate header is suffixed `.1` as pandas suffixed it, where before it made the DataFrame constructor raise and the file would not open
  - log: 2026-08-11 pandas' default missing-value set is honoured again on both readers. One `NA` in a numeric column had typed the whole column as text, which the frontend then filtered as a substring and sorted lexicographically, and whose statistics lost min, max and mean
  - log: 2026-08-11 reopened: reopened a fourth time by round-4 review: the eight measured shapes were all Excel LAYOUT shapes, and four VALUE-level shapes that opened in v1.7.11 were failing. A worksheet column mixing a clock time or an elapsed time with a timestamp either refused to open (400), silently nulled the duration, or reached arrow as fixed_size_binary[8] of raw CPython object pointers; six of Excel's seven error values retyped a numeric column to text where pandas read NaN; an integer at or above 2\*\*63 in a csv made the file unopenable because pyarrow cannot consume polars' Int128 export; and an xlsx named .xls 500d from the metadata handler, whose list_excel_sheets call still passed openpyxl a path. Both review lenses found the first independently
  - log: 2026-08-11 all four fixed: \_value_kind gives one kind per set of types polars can widen together, Excel error values are nulled on the Excel path only, Int128 is recast to String in the shared helper, and both openpyxl call sites are handed a file object. 141 pytest green, each fix mutation-verified
  - log: 2026-08-11 stays open, and on present evidence should stay open: one shape does not open and is recorded rather than fixed - a UTF-16 csv returns 400 where pandas' latin1 retry read it as a single column named 'yTHORNa' (DEF-16). Closing this criterion has been wrong four times running, each time because the shape surface was measured along one axis and the next round found another. Two axes are now measured - layout, by an 8-shape comparison, and values, by a 784-case differential sweep - so what is left is a claim about shapes nobody has enumerated, which is not a claim this criterion can carry
- [x] **Unreadable delimited files raise ValueError, not a 500** - a 0-byte or ragged csv surfaces as HTTP 400 with a message, not a traceback
  - log: 2026-08-10 criterion added after review: the pandas arm caught `ParserError` and `EmptyDataError`, both of which subclass ValueError, and no polars exception does - so these regressed from 400 to 500 in the swap
  - log: 2026-08-10 closed: `_read_uncached` maps `PolarsError` to ValueError once for the whole non-parquet dispatch; test asserts ValueError for both shapes
- [x] **Only openable sheets are offered as tabs** - the sheet bar lists worksheets, never a chartsheet the reader cannot open
  - log: 2026-08-10 criterion added after review: `book.sheetnames` includes chartsheets, `book.worksheets` does not, and pandas listed the latter
  - log: 2026-08-10 closed: `list_excel_sheets` iterates `book.worksheets`
- [x] **Excel needs no extra reader engine** - reading .xlsx must not add a dependency beyond the openpyxl already declared
  - log: 2026-08-10 criterion added after measuring that polars' default calamine engine requires fastexcel, roughly 30 MB
  - log: 2026-08-10 closed: `engine="openpyxl"` reads every fixture including the mixed sheet, and sheet names come straight from openpyxl in read_only mode rather than through polars, which would have to read the sheets to list them. The swap adds polars and xlsxwriter, the latter being what polars writes .xlsx through
