# Acceptance Criteria - JupyterLab Tabular Data Viewer Extension

Consolidated criteria for the extension. One `##` section per feature area; `[ ]` todo, `[x]` done, with a dated `log:` line under each criterion.

## Authors

- `@kj` Konrad Jelen

## Large database handling `LARGE`

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

- [x] `ACC-LARGE-1` **No content fetch** - CRITICAL; opening any tabular file issues no content-bearing `/api/contents` request; the document context requests `content: false`
  - log: 2026-08-09T00:00:00Z @kj criterion added, addresses DEF-1
  - log: 2026-08-09T00:00:00Z @kj closed: verified by galata 'should open a SQLite database without fetching its contents' - asserts on the wire that no /api/contents request carries content=1
  - log: 2026-09-14T20:20:36Z @kj edited importance
- [x] `ACC-LARGE-2` **Model factory** - HIGH; a no-content model factory with `fileFormat: null` is registered and both widget factories reference it by name
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj closed: NoContentModelFactory registered unconditionally at src/index.ts:351, both widget factories use modelName NO_CONTENT_MODEL
  - log: 2026-09-14T20:20:36Z @kj edited importance
- [-] `ACC-LARGE-3` **Open cost independent of file size** - HIGH; time from double-click to first rendered row does not scale with file size; a 500 MB database opens in the same order of time as a 50 KB one
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj partially verified - the 8MB generated database opens in the same galata budget as the 44KB fixture; no >384MB timing measured
  - log: 2026-09-14T20:20:36Z @kj edited importance
  - log: 2026-09-14T20:44:48Z @kj rejected: rejected as written: the first open reads the whole table once into the cache, so open time scales with the table's non-BLOB bytes; the two properties that do hold are closed on their own - no content fetch (ACC-LARGE-1) and BLOB bytes never read (ACC-LARGE-10), which is why the 8 MB generated database opens inside the 44 KB fixture's galata budget
- [x] `ACC-LARGE-4` **Edge: file larger than the V8 string limit** - CRITICAL; a file whose base64 encoding would exceed `MAX_STRING_LENGTH` (536,870,888 chars, i.e. any file above ~384 MB) opens normally instead of failing
  - evidence: galata 'should open a SQLite database without fetching its contents' asserts on the wire that no contents GET carries content=1, for any size; the V8 string limit is unreachable with no string; a browser open of a file above 384 MB was not observed, no CI runner can hold that fixture
  - test-tags: E2E
  - test: galata: open sample_database.db, assert no /api/contents GET carries content=1 - the wire assertion holds for any size
  - log: 2026-08-09T00:00:00Z @kj criterion added, this is the reported failure
  - log: 2026-08-09T00:00:00Z @kj not directly tested - a >384MB fixture cannot be generated in CI; covered indirectly by the wire assertion that no content-bearing request is made at all, which makes the limit unreachable regardless of size
  - log: 2026-09-14T20:20:36Z @kj edited importance
  - log: 2026-09-14T20:44:48Z @kj edited test (added) and test-tags (added)
  - log: 2026-09-14T20:44:48Z @kj closed: closed on the mechanism: the content string is never built
- [x] `ACC-LARGE-5` **Edge: context still resolves path and metadata** - HIGH; `context.path` and file-changed signals continue to work with no content loaded
  - evidence: galata 'should refresh from disk on reload without fetching content' green - 1500 rows become 3 after the file is overwritten and reloaded, columns a,b, and every contents GET for the file carries content=0
  - test-tags: E2E
  - test: galata: open sample_data.csv, overwrite it on disk, run docmanager:reload, assert the grid shows the new rows and every contents GET carries content=0
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-09-14T20:20:36Z @kj edited importance
  - log: 2026-09-14T20:44:48Z @kj edited test (added) and test-tags (added)
  - log: 2026-09-14T20:50:34Z @kj closed: closed: docmanager:reload reverts the context on metadata alone and the widget re-reads through its own API
- [x] `ACC-LARGE-6` **Regression: other formats unaffected** - CRITICAL; parquet, xlsx, csv and tsv keep opening correctly under the no-content model
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj closed: galata parquet, csv and xlsx tests pass under the no-content model
  - log: 2026-09-14T20:20:36Z @kj edited importance

### BLOB handling

- [x] `ACC-LARGE-7` **Placeholder built in SQL** - HIGH; the select list wraps every column so a BLOB yields `<BLOB n.n KB>` from SQLite; BLOB bytes are never read into the dataframe layer or arrow
  - log: 2026-08-09T00:00:00Z @kj criterion added, addresses DEF-2
  - log: 2026-08-09T00:00:00Z @kj closed: \_blob_placeholder_sql; test_blob_bytes_are_never_materialised bounds peak allocation at a tenth of the payload
  - log: 2026-09-14T20:20:36Z @kj edited importance
- [x] `ACC-LARGE-8` **Placeholder format unchanged** - LOW; the rendered string matches the existing convention (B / KB / MB, one decimal, trailing zeros dropped)
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj closed: test_blob_placeholder_sql_matches_python_formatter parametrised over 10 sizes against \_format_blob_size
  - log: 2026-08-09T00:00:00Z @kj corrected - the test named in the previous line no longer exists, nor does \_format_blob_size. Pinned instead by test_blob_placeholder_size_rendering over 14 literal expected strings. Note a deliberate behaviour change: SQL rounds half away from zero where the deleted Python twin rounded half to even, so a 1,280-byte BLOB now renders 1.3 KB rather than 1.2 KB
  - log: 2026-09-14T20:20:36Z @kj edited importance
- [x] `ACC-LARGE-9` **Exports carry placeholders** - HIGH; every export format writes the placeholder string, never binary
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj closed: test_download_carries_blob_placeholders_not_binary - csv and jsonl contain '<BLOB 256 B>' and no raw byte runs
  - log: 2026-09-14T20:20:36Z @kj edited importance
- [x] `ACC-LARGE-10` **Memory bound** - HIGH; reading a table holding 299 MB of BLOBs allocates on the order of the placeholder text, not the BLOB bytes
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj closed: 128 MB BLOB table reads in 0.004 s at +5 MB RSS; forcing a real payload read costs 0.059 s
  - log: 2026-09-14T20:20:36Z @kj edited importance
- [x] `ACC-LARGE-11` **Edge: NULL in a BLOB column** - MEDIUM; renders as null, not as `<BLOB 0 B>`
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj closed: test_blob_column_null_and_mixed_affinity asserts None, not a placeholder
  - log: 2026-09-14T20:20:36Z @kj edited importance
- [x] `ACC-LARGE-12` **Edge: mixed-affinity column** - MEDIUM; a column holding both text and BLOB values yields the text verbatim and the placeholder only for the BLOB rows
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj closed: same test - text passes through verbatim, only blob rows placeholder
  - log: 2026-09-14T20:20:36Z @kj edited importance
- [x] `ACC-LARGE-13` **Edge: zero-length BLOB** - LOW; renders as `<BLOB 0 B>`
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj closed: same test - '<BLOB 0 B>'
  - log: 2026-09-14T20:20:36Z @kj edited importance
- [x] `ACC-LARGE-14` **Edge: column name needing quoting** - HIGH; a column named with a double quote, space or reserved word is quoted correctly in the generated select list
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj closed: test_sqlite_column_name_requiring_quoting covers space, embedded double quote and a reserved word
  - log: 2026-09-14T20:20:36Z @kj edited importance

### Progressive load

- [x] `ACC-LARGE-15` **Cache hit** - HIGH; repeat reads of an unchanged file and table return the identical cached arrow table, so a page, sort or filter after the first read costs no disk access
  - log: 2026-08-09T00:00:00Z @kj added
  - log: 2026-08-09T00:00:00Z @kj closed: test_cache_serves_repeat_reads_from_memory asserts object identity; feed_scan 633.7 ms -> 0.03 ms on the reported database
  - log: 2026-09-14T20:20:37Z @kj edited importance
- [x] `ACC-LARGE-16` **Cache invalidation** - CRITICAL; an edited file is re-read and its superseded entry is dropped; the key carries absolute path, sheet, mtime_ns and size
  - log: 2026-08-09T00:00:00Z @kj added
  - log: 2026-08-09T00:00:00Z @kj closed: test_cache_invalidates_on_modification - edited file re-read and the superseded entry dropped
  - log: 2026-08-09T00:00:00Z @kj corrected - the key also carries the -wal sidecar's mtime_ns and size, missing sidecar as (0,0); without it an un-checkpointed WAL commit from an open writer was invisible and re-reading could not cure it
  - log: 2026-09-14T20:20:37Z @kj edited importance
- [x] `ACC-LARGE-17` **Cache budget** - HIGH; total cached bytes stay under a fixed budget (256 MB), evicting least-recently-used first; a single table larger than the whole budget is served but not cached
  - log: 2026-08-09T00:00:00Z @kj added
  - log: 2026-08-09T00:00:00Z @kj closed: test_cache_evicts_least_recently_used_within_its_budget and test_cache_skips_a_table_larger_than_the_whole_budget
  - log: 2026-08-09T00:00:00Z @kj corrected - test_cache_evicts_least_recently_used_within_its_budget was deleted (it never actually evicted: 3,443 bytes against a 4,096 budget). Covered by test_cache_byte_counter_tracks_contents_and_recency_is_lru, which sizes the budget from measured nbytes so an eviction really happens and fails if LRU degrades to FIFO
  - log: 2026-09-14T20:20:37Z @kj edited importance
- [x] `ACC-LARGE-18` **Cache safety** - HIGH; arrow tables are immutable and every consumer returns a new table, so one cached instance is shared without copying
  - log: 2026-08-09T00:00:00Z @kj added
  - log: 2026-08-09T00:00:00Z @kj closed: both reviewers traced every consumer independently - routes.py append_column/filter/take/slice and all of stats.py derive rather than mutate; Table.nbytes verified stable across 200 calls, which is what makes the byte accounting exact
  - log: 2026-09-14T20:20:37Z @kj edited importance
- [x] `ACC-LARGE-19` **Configurable window** - LOW; the rendered window size is a `rowsPerPage` setting (default 500), not a hardcoded constant; changing it does not affect filter, sort or statistics scope
  - evidence: galata 'should bound the rendered window and nothing else' green with mockSettings rowsPerPage 10 - 10 rows rendered, 'Showing 10 of 1500 rows' before and after a sort, status bar 1500 rows
  - test-tags: E2E
  - test: galata with mockSettings rowsPerPage 10: open sample_data.csv, assert 10 rows rendered and 'Showing 10 of 1500 rows', sort a column, assert both again
  - log: 2026-08-09T00:00:00Z @kj added
  - log: 2026-08-09T00:00:00Z @kj wired through schema/plugin.json, ISettings and the widget constructor; no automated test - would need a jest test of the widget constructor
  - log: 2026-09-14T20:20:37Z @kj edited importance
  - log: 2026-09-14T20:44:48Z @kj edited test (added) and test-tags (added)
  - log: 2026-09-14T20:50:34Z @kj closed: closed: rowsPerPage bounds the rendered window only
- [-] `ACC-LARGE-20` **Metadata without full read** - MEDIUM; metadata for a SQLite source returns columns from `PRAGMA table_info` and row count from `COUNT(*)`, reading no rows
  - log: 2026-08-09T00:00:00Z @kj criterion added, addresses DEF-3
  - log: 2026-08-09T00:00:00Z @kj deferred - PRAGMA table_info reports SQLite declared types (INTEGER/REAL), but the frontend matches arrow type names and isNumeric() substring-matches them, so switching would change displayed types and numeric filtering; see DEF-3
  - log: 2026-08-09T00:00:00Z @kj if ever implemented, note the criterion text above names the wrong pragma: table_info omits generated columns, so a column list must come from table_xinfo filtered on hidden != 1
  - log: 2026-09-14T20:20:37Z @kj edited importance
  - log: 2026-09-14T20:44:48Z @kj rejected: superseded by the read cache (ACC-LARGE-15 to 18): the first metadata request fills the cache with the whole table and every later request is served from it, so a PRAGMA-only metadata path would save one read per file at the cost of the declared-type mismatch DEF-3 records
- [-] `ACC-LARGE-21` **Row window pushdown** - MEDIUM; a plain browse request reads only the requested page via `LIMIT`/`OFFSET`
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj rejected - pandas infers dtype from the rows given, so a window disagrees with the full table on any nullable or mixed-class column; every table in the reported database is nullable, so a safe gate would never fire
  - log: 2026-08-09T00:00:00Z @kj if ever revisited: the cache key does not include offset/limit, so a window would be silently served from a cached full table unless they are folded in; and the nullable-column guard test does NOT detect a reintroduced pushdown - it compares its own hand-built window, not the reader's
  - log: 2026-09-14T20:20:37Z @kj edited importance
  - log: 2026-09-14T20:20:38Z @kj rejected: rejected: pandas-era finding stands - a row window disagrees with the full table on any nullable or mixed column; window is cut in arrow from the cached full read
- [-] `ACC-LARGE-22` **Pushdown equivalence** - MEDIUM; a paged read returns rows identical to slicing the full read, for every table in the fixture
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj rejected with the pushdown; the equivalence test caught the mismatch and was replaced by a stability guard
  - log: 2026-09-14T20:20:37Z @kj edited importance
  - log: 2026-09-14T20:20:39Z @kj rejected: rejected with ACC-LARGE-21 - no pushdown, so no equivalence to assert; replaced by the stability guard test
- [x] `ACC-LARGE-23` **Fallback on sort** - HIGH; a sorted request falls back to the full read and the existing arrow sort, preserving current ordering semantics
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj closed: test_data_endpoint_sort_is_global_not_page_local asserts against the true global ordering across two pages
  - log: 2026-09-14T20:20:37Z @kj edited importance
- [x] `ACC-LARGE-24` **Fallback on filter** - HIGH; a filtered request falls back to the full read; filters are never pushed into SQL because the frontend offers regex and SQLite has no `REGEXP` operator
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj closed: test_data_endpoint_filter_is_global_not_page_local
  - log: 2026-09-14T20:20:37Z @kj edited importance
- [x] `ACC-LARGE-25` **Edge: offset beyond end of table** - LOW; returns an empty page, not an error
  - evidence: test_offset_past_the_end_returns_an_empty_page green - offset 1,000,000 on orders answers 200, data [], totalRows intact, hasMore false
  - test-tags: INTEGRATION
  - test: POST data with an offset past totalRows, assert 200 and an empty data list
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj not applicable while the full read is sliced in arrow
  - log: 2026-09-14T20:20:37Z @kj edited importance
  - log: 2026-09-14T20:44:48Z @kj edited test (added) and test-tags (added)
  - log: 2026-09-14T20:46:06Z @kj closed: closed: the window is sliced in arrow from the cached table, so an offset past the end has nothing to fail on
- [x] `ACC-LARGE-26` **Edge: empty table** - MEDIUM; a table with zero rows reports 0 rows and renders an empty grid with correct column headers
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj closed: test_empty_and_single_row_tables - zero rows, columns still reported
  - log: 2026-09-14T20:20:37Z @kj edited importance
- [x] `ACC-LARGE-27` **Edge: single-row table** - LOW; `meta`-style one-row table paginates correctly
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj closed: test_empty_and_single_row_tables
  - log: 2026-09-14T20:20:37Z @kj edited importance
- [x] `ACC-LARGE-28` **Edge: table renamed or dropped between requests** - MEDIUM; returns HTTP 400 with a readable message, not 500
  - evidence: test_table_dropped_between_requests_is_a_400 green - first request 200, DROP TABLE, second request 400 'Table not found: gone'
  - test-tags: INTEGRATION
  - test: open a SQLite table, drop it, request its rows again, assert 400 with a message
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-09-14T20:20:37Z @kj edited importance
  - log: 2026-09-14T20:44:48Z @kj edited test (added) and test-tags (added)
  - log: 2026-09-14T20:46:06Z @kj closed: closed: dropping the table changes the file, the cache misses, and the missing name is a ValueError the handler maps to 400

### Verification

- [x] `ACC-LARGE-29` **Synthetic fixture** - HIGH; a generated database, not the user's private data, drives every test; committed fixture stays small and a larger one is generated at test time
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj closed: committed fixture stays 8 tables small; scripts/make_sample_database.py --blob-db generates the larger one at test time
  - log: 2026-09-14T20:20:37Z @kj edited importance
- [x] `ACC-LARGE-30` **Galata: no content fetch** - HIGH; a network assertion proves opening a `.db` issues no content-bearing `/api/contents` request
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj closed: galata test 14 green
  - log: 2026-09-14T20:20:37Z @kj edited importance
- [x] `ACC-LARGE-31` **Galata: BLOB placeholder** - MEDIUM; a BLOB cell renders the placeholder text in the grid
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj closed: galata 'should render BLOB cells as placeholders' green
  - log: 2026-09-14T20:20:38Z @kj edited importance
- [x] `ACC-LARGE-32` **Galata: large database opens** - HIGH; a synthetic database well above the previous failure threshold opens and renders rows
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj closed: galata test 15 green - 8 MB generated database, payloads tab shows '<BLOB 1 MB>'
  - log: 2026-09-14T20:20:38Z @kj edited importance
- [x] `ACC-LARGE-33` **Galata: paging** - LOW; advancing a page on a large table renders the next window
  - evidence: galata 'should render the next window when scrolled to the bottom' green - 500, 1000, 1500 rows on successive scrolls, nothing more on a fourth, 'Showing 1500 of 1500 rows'
  - test-tags: E2E
  - test: galata: open sample_data.csv, scroll the grid container to its bottom twice, assert 1000 then 1500 rows and nothing more on a third scroll
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj not added - paging is arrow-side and unchanged by this work, so a new galata test would assert pre-existing behaviour; revisit if the window is ever pushed into SQL
  - log: 2026-09-14T20:20:38Z @kj edited importance
  - log: 2026-09-14T20:44:48Z @kj edited test (added) and test-tags (added)
  - log: 2026-09-14T20:50:34Z @kj closed: closed: scroll-driven paging renders each next window
- [x] `ACC-LARGE-34` **pytest: placeholder in SQL** - MEDIUM; a test asserts the BLOB bytes are not materialised, not merely that the output string is right
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj closed: asserts peak allocation, not just the output string
  - log: 2026-09-14T20:20:38Z @kj edited importance
- [x] `ACC-LARGE-35` **Existing suites stay green** - CRITICAL; 50 pytest, 13 galata and the jest test continue to pass
  - log: 2026-08-09T00:00:00Z @kj criterion added
  - log: 2026-08-09T00:00:00Z @kj closed: 72 pytest (was 50), 15 galata (was 13), tsc exit 0
  - log: 2026-08-09T00:00:00Z @kj corrected - the earlier close was premature: galata test 15 failed on its first run (default 5000ms on a grid assertion that omitted GRID_TIMEOUT) and passed only on the re-run; timeout added, suite must be green twice before this is closed
  - log: 2026-08-09T00:00:00Z @kj reopened: reopened pending two consecutive green galata runs
  - log: 2026-08-09T00:00:00Z @kj closed: two consecutive galata runs 15/15 (8.0m and 7.0m, both exit 0), 80 pytest, tsc exit 0 - closed only after the second green run, having been reopened when the first close rested on a single one
  - log: 2026-09-14T20:20:38Z @kj edited importance

## Export `EXPORT`

Export writes the whole table, never the rendered window. Filters narrow it, sorting reorders it, pagination does neither. A tabbed source names the active table in the downloaded filename.

- [x] `ACC-EXPORT-36` **Export is global** - CRITICAL; exporting a source larger than the rendered window returns every row: all five formats for a parquet source, the four offered formats for a SQLite table, and two formats each for csv and xlsx
  - log: 2026-08-10T00:00:00Z @kj criterion added
  - log: 2026-08-10T00:00:00Z @kj closed: three galata tests - parquet 1500 rows across original, xlsx, csv, parquet and jsonl; a generated 1200-row SQLite table across the four offered formats; csv and xlsx 1500 rows each. Every count is compared against the 500-row rendered window, and payloads are parsed back with scripts/count_rows.py so the assertion is on bytes that arrived, not on the request
  - log: 2026-08-10T00:00:00Z @kj verified the tests can fail: slicing the export to 500 rows in the download handler failed both source families at exactly 500. NB the mutation had to be applied to the INSTALLED copy in site-packages - galata drives that, not the working tree, so a backend edit is invisible to galata until make install
  - log: 2026-09-14T20:20:38Z @kj edited importance
- [x] `ACC-EXPORT-37` **Export is the right table, not just the right size** - HIGH; an export of the right size taken from the wrong table must fail
  - log: 2026-08-10T00:00:00Z @kj criterion added after review proved counts alone are insufficient: 400 distinct rows written three times counts as 1200 in all four formats, so every count assertion would have passed
  - log: 2026-08-10T00:00:00Z @kj closed: the SQLite test switches to `payloads` (exactly 1 row at --mb 1) and asserts 1 - no single wrong table can satisfy both 1200 and 1
  - log: 2026-08-10T00:00:00Z @kj scope limit, stated rather than closed over: no assertion reads an exported cell, so a handler emitting one row repeated to the table's own length passes every count and filename. Round 2 named that surviving mutation; a content differ costs more than the gap, so the criterion claims table identity only
  - log: 2026-09-14T20:20:38Z @kj edited importance
- [x] `ACC-EXPORT-38` **Export filename carries the active table** - MEDIUM; switching table changes the downloaded filename, not only the grid
  - log: 2026-08-10T00:00:00Z @kj criterion added
  - log: 2026-08-10T00:00:00Z @kj first close was wrong: the test asserted export_database_labels.<ext> but never switched tab, so a frontend that always sent the first table would have passed. Found by architect review
  - log: 2026-08-10T00:00:00Z @kj closed: the test now clicks the `payloads` tab and asserts export_database_payloads.csv, and all four exports in the csv/xlsx test assert their filenames, so an export cannot be attributed to the wrong tab
  - log: 2026-08-10T00:00:00Z @kj the added assertion corrected two wrong beliefs: a single-sheet workbook still carries its sheet slug (an xlsx original export is sample_data_sheet1.xlsx), and the slug applies to every output format, not only the original - so the xlsx source's CSV export is sample_data_sheet1.csv and does distinguish it from the csv source's sample_data.csv. A comment claiming the two could not be told apart was false; both are now asserted
  - log: 2026-09-14T20:20:38Z @kj edited importance

## Reader engine `READER`

Three engines: pyarrow reads parquet, openpyxl reads an .xlsx worksheet and polars types it, and polars reads csv, tsv and sqlite and writes every export. Pandas is gone from both paths (DEF-4). What has to hold across the swap: a mixed column still resolves to text, a nullable integer stays an integer, no shape of file that used to open now fails, and every export still writes every format with the content type it had - the byte-level differences being enumerated rather than assumed absent.

- [x] `ACC-READER-39` **No pandas in the read or export path** - HIGH; importing the extension's modules must not pull pandas into the interpreter
  - log: 2026-08-10T00:00:00Z @kj criterion added
  - log: 2026-08-10T00:00:00Z @kj closed: test_extension_does_not_import_pandas asserts in a fresh interpreter that pandas is absent from sys.modules after importing routes, readers and stats. A subprocess is what makes the assertion mean anything - an in-process check would pass or fail on whatever else imported pandas first, and once imported it never leaves
  - log: 2026-09-14T20:20:38Z @kj edited importance
- [x] `ACC-READER-40` **Mixed-type column resolves to text wherever the odd value sits** - CRITICAL; a column of integers holding one string reads as text whether the string is in row 2 or row 201
  - log: 2026-08-10T00:00:00Z @kj criterion added
  - log: 2026-08-10T00:00:00Z @kj closed: test_mixed_column_resolves_when_the_string_arrives_late plants the string past row 200 in both a csv and a SQLite table, and a galata test opens the MixedTypes sheet and asserts both classes reach the grid
  - log: 2026-08-10T00:00:00Z @kj this is the criterion the change nearly shipped without. `infer_schema_length=None` on the csv and SQLite reads is load-bearing, and every mixed fixture in the repo is a handful of rows, so polars' default 100-row window covered them all and the setting was untested. Mutation-verified: dropping the argument fails the new test with ComputeError, could not parse `ACCFS-108` as dtype i64
  - log: 2026-08-10T00:00:00Z @kj the row window applies to csv and SQLite only. Excel is read through openpyxl, which parses every cell before polars sees the column, so an .xlsx mixed column resolves the same wherever the odd value sits and needs no inference argument
  - log: 2026-09-14T20:20:38Z @kj edited importance
- [x] `ACC-READER-41` **Nullable integer stays an integer** - HIGH; a nullable INTEGER column exports as 42, not 42.0, and a row window agrees with a full read on its type
  - log: 2026-08-10T00:00:00Z @kj criterion added
  - log: 2026-08-10T00:00:00Z @kj closed: test_nullable_column_type_is_stable_across_any_row_window asserts int64 for both a LIMIT 10 window and the full table, and a galata test asserts the exported csv carries no decimal tail and keeps the two nulls empty
  - log: 2026-08-10T00:00:00Z @kj the criterion was first written against the grid and that was wrong: a mutation reintroducing the float cast left a DOM assertion green, because the backend serialises 42.0, JSON has a single number type, and JavaScript renders it "42". The promotion is only visible in an exported file, so the assertion moved there and DEF-4's own wording was corrected
  - log: 2026-09-14T20:20:38Z @kj edited importance
- [x] `ACC-READER-42` **Export keeps its formats and content types** - HIGH; all five formats still export, each with the content type it had under pandas; the bytes differ in known ways, listed below rather than claimed identical
  - evidence: test_download_wide_decimal_exports_as_text over csv, jsonl, parquet and xlsx, test_csv_export_writes_nested_and_duration_columns and test_jsonl_export_writes_a_nested_binary_as_hex green; 172 pytest; content types unchanged per the download matrix tests
  - test-tags: INTEGRATION, E2E
  - test: pytest: export decimal256, nested and duration columns in every format; galata: the 18 export tests
  - log: 2026-08-10T00:00:00Z @kj criterion added
  - log: 2026-08-10T00:00:00Z @kj closed: the existing export tests cover this unchanged - 18 galata plus the pytest content-type and filename matrix - so a regression in the new writers shows up as a wrong count, wrong content type or short export
  - log: 2026-08-10T00:00:00Z @kj the deliberate byte-level differences, all recorded in the changelog: csv and tsv write booleans lowercase (`false`) where pandas wrote `False`, and write a timestamp in full ISO form, so `sample_data.xlsx`'s join_date exports as `2023-02-25T00:00:00.000000` where pandas dropped the zero time; jsonl writes floats at round-trip precision where pandas truncated to 10 significant digits, renders a date column as `2023-02-25` rather than `2023-02-25T00:00:00.000`, separates a timestamp's date and time with a space rather than `T`, and leaves `/` unescaped. An earlier version of this log claimed jsonl was byte-identical to pandas; that was measured on one fixture whose columns happened to agree, and is false in general
  - log: 2026-08-10T00:00:00Z @kj a binary column is hex-encoded before every non-parquet write. Parquet is the only writer that accepts Binary, and `write_ndjson` did not raise on it but panicked in Rust - a PanicException inherits BaseException, so it passed straight through the handler's `except Exception` and left the request dead with an empty body instead of a 500
  - log: 2026-08-10T00:00:00Z @kj reopened: the enumeration above was incomplete in four further ways, all measured. The first cast decoded binary as strict UTF-8, so a real BLOB - image bytes, a hash - raised ComputeError and 500d every non-parquet export; hex replaces it and never fails. XLSX carries a defined table object and no autofilter row where pandas wrote a plain sheet, and its number formats needed dtype keys rather than a selector, which polars drops silently. Parquet is ZSTD where pandas wrote SNAPPY
  - log: 2026-08-10T00:00:00Z @kj stays open on two column types, both regressions from pandas and both recorded rather than fixed: a decimal256 column cannot be exported in any format (DEF-8), and a list, struct, map or duration column cannot be exported to csv or tsv (DEF-9) - jsonl writes all four, rendering a duration as `PT86400S` where pandas wrote `1 days`, and only a Binary nested inside one of them panics there. The round-1 decline claiming pandas also failed on nested columns was wrong - measured, it wrote `[1 2]`, `{'a': 1}`, `[('k', 1)]` and `1 days`. Both now return a 500 with a message rather than a closed connection, which is what the PanicException arm in DownloadHandler buys
  - log: 2026-09-14T20:20:38Z @kj edited importance
  - log: 2026-09-14T20:44:48Z @kj edited test (added) and test-tags (added)
  - log: 2026-09-14T20:44:48Z @kj closed: closed: DEF-EXPORT-8 and DEF-EXPORT-9 fixed, every column type exports in every format
- [x] `ACC-READER-43` **Every shape of file that opened before still opens** - CRITICAL; a blank column header, a blank row inside the data, an all-empty column, an empty first sheet, a blank row above the data and a header row with no data under it must not change the table's shape or fail the read
  - evidence: test_utf16_csv_opens_with_its_columns_intact, test_csv_integer_wider_than_int128_opens_as_text, test_csv_with_bare_cr_line_endings_opens and test_csv_blank_lines_are_skipped_as_pandas_skipped_them green beside the workbook-shape tests; 172 pytest; the one residue is an unclosed-quote csv (DEF-DELIM-12, wontfix), which opens with its data under a wrong column name
  - test-tags: UNIT, INTEGRATION
  - test: pytest: the workbook-shape and delimited-shape tests - blank and repeated headers, blank rows, defined tables, UTF-16, bare CR, blank lines, a 39-digit integer
  - log: 2026-08-10T00:00:00Z @kj criterion added after review: polars' Excel reader defaults `drop_empty_cols`, `drop_empty_rows` and `raise_if_empty` to True, so each of these silently lost data or raised where pandas returned a table
  - log: 2026-08-10T00:00:00Z @kj closed: all three defaults are set False, an empty column name is replaced with the positional `Unnamed: N` pandas used, and an all-Null column is cast to string so statistics have a type to work with. Covered by the workbook-shapes tests in test_routes.py
  - log: 2026-08-10T00:00:00Z @kj reopened and closed again on two more shapes, both found by review after the first close. Polars takes its header from the first NON-EMPTY row, so a blank spacer row above the table consumed the first real data row - silently when the values were text, and with a TypeError that is neither a PolarsError nor a ValueError when they were numeric, giving a 500 with a traceback. A header row with no data under it returned a 0x0 frame, so a template tab opened with no columns at all. `_read_excel` now inspects the first row through openpyxl and reads with `has_header=False` for the blank-row shape, taking the names from openpyxl for the other; both outputs were measured against pandas' for the same file
  - log: 2026-08-10T00:00:00Z @kj the null-column cast reached two of the three readers that need it. A SQLite column NULL in every row stayed Null-typed and 500d the statistics request with ArrowNotImplementedError; `_read_sqlite` applies the same cast now. Not a regression - pandas produced a null column here too - but the swap introduced the cure and had skipped the reader where the shape is most common
  - log: 2026-08-11T00:00:00Z @kj reopened a third time and closed on the shape that mattered most: polars' Excel reader prefers a defined Table object over the used range and reads only the FIRST one, so a sheet structured with "Format as Table" was truncated to that table's declared range - silently, in the grid, the row count, the statistics and every export. There is no kwarg to disable it. `_read_excel` now reads the worksheet's rows through openpyxl and hands polars only the typing, which settles the table case, the header cases and the formula-header case together; the peek added on 2026-08-10 is deleted with them. Measured against pandas on the table, totals-row, two-table, formula-header, blank-first-row, header-only, trailing-blank and duplicate-header shapes - all eight agree
  - log: 2026-08-11T00:00:00Z @kj owning the header also fixed the naming: every blank worksheet header is now numbered by position exactly as pandas numbered it, so DEF-7 narrows to csv, where polars' `_duplicated_0` is indistinguishable from a real column of that name. A duplicate header is suffixed `.1` as pandas suffixed it, where before it made the DataFrame constructor raise and the file would not open
  - log: 2026-08-11T00:00:00Z @kj pandas' default missing-value set is honoured again on both readers. One `NA` in a numeric column had typed the whole column as text, which the frontend then filtered as a substring and sorted lexicographically, and whose statistics lost min, max and mean
  - log: 2026-08-11T00:00:00Z @kj reopened: reopened a fourth time by round-4 review: the eight measured shapes were all Excel LAYOUT shapes, and four VALUE-level shapes that opened in v1.7.11 were failing. A worksheet column mixing a clock time or an elapsed time with a timestamp either refused to open (400), silently nulled the duration, or reached arrow as fixed_size_binary[8] of raw CPython object pointers; six of Excel's seven error values retyped a numeric column to text where pandas read NaN; an integer at or above 2\*\*63 in a csv made the file unopenable because pyarrow cannot consume polars' Int128 export; and an xlsx named .xls 500d from the metadata handler, whose list_excel_sheets call still passed openpyxl a path. Both review lenses found the first independently
  - log: 2026-08-11T00:00:00Z @kj all four fixed: \_value_kind gives one kind per set of types polars can widen together, Excel error values are nulled on the Excel path only, Int128 is recast to String in the shared helper, and both openpyxl call sites are handed a file object. 141 pytest green, each fix mutation-verified
  - log: 2026-08-11T00:00:00Z @kj stays open, and on present evidence should stay open: one shape does not open and is recorded rather than fixed - a UTF-16 csv returns 400 where pandas' latin1 retry read it as a single column named 'yTHORNa' (DEF-16). Closing this criterion has been wrong four times running, each time because the shape surface was measured along one axis and the next round found another. Two axes are now measured - layout, by an 8-shape comparison, and values, by a 784-case differential sweep - so what is left is a claim about shapes nobody has enumerated, which is not a claim this criterion can carry
  - log: 2026-08-11T00:00:00Z @kj round-5 architect review: two more shapes found and fixed - a workbook with a broken external-link reference 500d on the sheet listing, and an all-NULL Parquet column 500d on statistics. A csv integer of 39+ digits still does not open (DEF-21). Criterion stays open
  - log: 2026-08-11T00:00:00Z @kj round-5 bug-hunter: a CRITICAL export data loss (case-clashing headers wrote a one-cell workbook at 200), an integer in the uint64 band demoted to text, and a 500 on statistics for any zero-row table - all three fixed. Numeric-text Excel columns (DEF-22) and a silent null past 2\*\*127 (DEF-23) recorded. Criterion stays open
  - log: 2026-08-11T00:00:00Z @kj DEF-22 and DEF-23 fixed on the user's instruction rather than recorded: a numeric-text column keeps its text (zip code leading zeros intact) but sorts numerically and reports aggregates via numeric_view; a spreadsheet integer past 2\*\*127 reads as text instead of a silent null. 148 pytest
  - log: 2026-08-11T00:00:00Z @kj round-6 architect: three defects introduced by the round-5 fixes, all fixed - the xlsx header suffix stole a name the file carried, parquet metadata reported null where statistics said string, and the xlsxwriter warning guard could not see the one path that truncates (16385 columns, now a 400 naming the grid limit). Numeric-text handling applies to every format, not only Excel
  - log: 2026-08-11T00:00:00Z @kj round-6 bug-hunter: three more defects from the round-5/6 fixes, all fixed - a numeric filter on a uint64 column was silently discarded and matched every row, an id past 2\*\*53 was rounded by JSON.parse and by the xlsx writer, and a text column holding Inf made the statistics response unparseable. Frontend gate corrected so a numeric-text column's aggregates reach the panel. DEF-24 recorded (categorical parquet, pre-existing)
  - log: 2026-09-14T20:20:38Z @kj edited importance
  - log: 2026-09-14T20:44:48Z @kj edited test (added) and test-tags (added)
  - log: 2026-09-14T20:44:48Z @kj closed: closed: the two shapes it stayed open on - UTF-16 (DEF-DELIM-16) and a 39-digit integer (DEF-DELIM-21) - open, and bare CR and blank lines with them
- [x] `ACC-READER-44` **Unreadable delimited files raise ValueError, not a 500** - MEDIUM; a 0-byte or ragged csv surfaces as HTTP 400 with a message, not a traceback
  - log: 2026-08-10T00:00:00Z @kj criterion added after review: the pandas arm caught `ParserError` and `EmptyDataError`, both of which subclass ValueError, and no polars exception does - so these regressed from 400 to 500 in the swap
  - log: 2026-08-10T00:00:00Z @kj closed: `_read_uncached` maps `PolarsError` to ValueError once for the whole non-parquet dispatch; test asserts ValueError for both shapes
  - log: 2026-09-14T20:20:38Z @kj edited importance
- [x] `ACC-READER-45` **Only openable sheets are offered as tabs** - MEDIUM; the sheet bar lists worksheets, never a chartsheet the reader cannot open
  - log: 2026-08-10T00:00:00Z @kj criterion added after review: `book.sheetnames` includes chartsheets, `book.worksheets` does not, and pandas listed the latter
  - log: 2026-08-10T00:00:00Z @kj closed: `list_excel_sheets` iterates `book.worksheets`
  - log: 2026-09-14T20:20:38Z @kj edited importance
- [x] `ACC-READER-46` **Excel needs no extra reader engine** - MEDIUM; reading .xlsx must not add a dependency beyond the openpyxl already declared
  - log: 2026-08-10T00:00:00Z @kj criterion added after measuring that polars' default calamine engine requires fastexcel, roughly 30 MB
  - log: 2026-08-10T00:00:00Z @kj closed: `engine="openpyxl"` reads every fixture including the mixed sheet, and sheet names come straight from openpyxl in read_only mode rather than through polars, which would have to read the sheets to list them. The swap adds polars and xlsxwriter, the latter being what polars writes .xlsx through
  - log: 2026-09-14T20:20:38Z @kj edited importance

## Document tab `TAB`

what the tab of an open tabular file shows - label and icon

- [x] `ACC-TAB-47` **Tab shows the spreadsheet icon** - LOW; the tab of an open parquet, xlsx, csv, tsv or sqlite file shows the spreadsheet icon left of the file name, the same icon the file browser shows for the file
  - evidence: galata 'should show the spreadsheet icon on the tab and in the file browser' green - an svg in the current tab's icon slot and in the file browser row for sample_data.parquet
  - test: galata: open sample_data.csv, assert the active tab's .lm-TabBar-tabIcon contains an svg; repeat for one binary type
  - test-tags: E2E
  - mechanism: 2026-09-14T20:20:39Z @kj TabularDataWidgetFactory.createNewWidget sets only title.label (src/index.ts:94); nothing assigns title.icon - only MimeDocument does that in core. Fix: factory sets widget.title.icon from the registered file type, and the five addFileType calls (src/index.ts:244-341) carry icon: spreadsheetIcon beside the legacy iconClass 'jp-MaterialIcon jp-SpreadsheetIcon', which JupyterLab 4 keeps only in ui-components/style/deprecated.css. @jupyterlab/ui-components is not yet a declared dependency
  - log: 2026-09-14T20:20:39Z @kj added
  - log: 2026-09-14T20:50:34Z @kj closed: closed: widget.title.icon set from spreadsheetIcon in the factory, icon on every registered file type

## Column statistics `STATS`

The column statistics dialog: overview tiles, statistics chosen by the column type, and unique value counts.

- log: 2026-11-05T14:29:12Z @kj category created

- [x] `ACC-STATS-48-DIALOG` **Dialog fills the viewer** - HIGH; the dialog spans the viewer width up to 1100 px and centers above it, keeping a 16 px margin; the header and statistics column stay fixed and only the values pane scrolls; a value row keeps its value, bar, count and percentage within 760 px
  - evidence: galata 'should render the adaptive statistics dialog for a duration column': width > 700 and only the values pane scrolls
  - test: open a fixture column and measure the dialog against the viewer width; count the scroll containers
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-11-05T14:29:12Z @kj added
  - log: 2026-11-05T14:59:23Z @kj closed
  - log: 2026-11-05T17:57:33Z @kj amended text "the dialog spans the viewer width with a 16 px margin; the header and the statistics column stay fixed and only the unique values pane scrolls" -> "the dialog spans the viewer width up to 1100 px and centers above it, keeping a 16 px margin; the header and statistics column stay fixed and only the values pane scrolls; a value row keeps its value, bar, count and percentage within 760 px"
- [x] `ACC-STATS-49-TILES` **Overview tiles** - HIGH; four tiles show Total rows, Non-null, Null and Unique; each carries the count and its percentage of total rows to one decimal
  - evidence: galata 'should render the summary tiles for an integer column': Total rows 12, Non-null 12, Null 0, Unique 12
  - test: open a column and compare the four tile values with the stats payload
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-11-05T14:29:12Z @kj added
  - log: 2026-11-05T15:23:30Z @kj closed
- [x] `ACC-STATS-50-DISTRIBUTION` **Numeric distribution block** - HIGH; an int, float, decimal or duration column shows Min, Q1, Median, Q3, Max, Mean, Std dev and Outliers; outliers carry the count and the percentage of non-null values
  - evidence: pytest test_numeric_column_stats_include_q1_and_q3; galata asserts stats-panel-row-q1 and stats-panel-row-q3
  - test: open an int column and a duration column; assert every distribution row is present and matches the payload
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-11-05T14:29:12Z @kj added
  - log: 2026-11-05T14:41:30Z @kj edited text "an int, float or duration column shows Min, Q1, Median, Q3, Max, Mean, Std dev and Outliers; outliers carry the count and the percentage of non-null values" -> "HIGH; an int, float, decimal or duration column shows Min, Q1, Median, Q3, Max, Mean, Std dev and Outliers; outliers carry the count and the percentage of non-null values"
  - log: 2026-11-05T14:59:23Z @kj closed
- [x] `ACC-STATS-51-TEXT` **String statistics block** - HIGH; a string column shows the most common value with its count, the top value share, and the minimum, maximum and average length; a list, struct or map column arrives as JSON text and uses the same block
  - evidence: pytest test_string_column_top_share_is_share_of_all_rows; galata asserts most_common green and top_share 50.0%
  - test: open a string column and assert the text rows match the payload
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-11-05T14:29:12Z @kj added
  - log: 2026-11-05T14:41:30Z @kj edited text "a string column shows the most common value with its count, the top value share, and the minimum, maximum and average length" -> "HIGH; a string column shows the most common value with its count, the top value share, and the minimum, maximum and average length; a list, struct or map column arrives as JSON text and uses the same block"
  - log: 2026-11-05T14:59:23Z @kj closed
- [x] `ACC-STATS-52-DATE-TIME` **Date and datetime blocks** - HIGH; a date column shows earliest, latest and span in days; a datetime column shows the same rows plus the time-of-day range
  - evidence: galata 'should render the date range for a date column' and '... date and time range for a timestamp column': earliest 2026-01-01, latest 2026-01-12, span 11 days, Time of day row
  - test: open a date column and a datetime column; assert the date rows and the extra datetime row
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-11-05T14:29:12Z @kj added
  - log: 2026-11-05T15:23:30Z @kj closed
- [x] `ACC-STATS-53-BOOLEAN` **Boolean block** - MEDIUM; a boolean column shows the true count and share and the false count and share
  - evidence: galata 'should render the boolean counts': true 7 and false 5 on the flag column
  - test: open a boolean column and assert the true and false rows
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-11-05T14:29:12Z @kj added
  - log: 2026-11-05T15:23:30Z @kj closed
- [x] `ACC-STATS-54-OTHER` **Binary and undesigned types show tiles only** - MEDIUM; a binary column or any type with no designed block shows the overview tiles and no type-specific block
  - evidence: galata 'should explain that a binary column has no statistics': tiles plus the no-statistics note for payload
  - test: open a parquet column of nested type and assert only the tiles render
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-11-05T14:29:20Z @kj added
  - log: 2026-11-05T14:41:30Z @kj edited title "Other types show tiles only" -> "Binary and undesigned types show tiles only"; text "a binary, list, struct, map, union or other unsupported type shows the overview tiles and no type-specific block" -> "MEDIUM; a binary column or any type with no designed block shows the overview tiles and no type-specific block"
  - log: 2026-11-05T15:23:30Z @kj closed
- [x] `ACC-STATS-55-BOXPLOT` **Distribution box plot** - MEDIUM; the distribution block draws a horizontal box plot: the axis spans min to max, the box spans Q1 to Q3, a solid line marks the median and a dotted line marks the mean; no plot is drawn when min equals max
  - evidence: galata 'should plot the mean line apart from the median line': the dotted mean x differs from the solid median x on price
  - test: open a numeric column and assert the box and median positions follow Q1, Q3 and the median
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-11-05T14:29:20Z @kj added
  - log: 2026-11-05T14:31:51Z @kj edited text "the distribution block draws a horizontal box plot: the axis spans min to max, the box spans Q1 to Q3, and a line marks the median" -> "MEDIUM; the distribution block draws a horizontal box plot: the axis spans min to max, the box spans Q1 to Q3, a solid line marks the median and a dotted line marks the mean"
  - log: 2026-11-05T15:09:50Z @kj edited text "the distribution block draws a horizontal box plot: the axis spans min to max, the box spans Q1 to Q3, a solid line marks the median and a dotted line marks the mean" -> "MEDIUM; the distribution block draws a horizontal box plot: the axis spans min to max, the box spans Q1 to Q3, a solid line marks the median and a dotted line marks the mean; no plot is drawn when min equals max"
  - log: 2026-11-05T15:23:30Z @kj closed
- [x] `ACC-STATS-56-UNIQUE` **Unique values ranked with shares** - HIGH; unique values are listed by count descending; each row shows the value, a bar proportional to the largest count, the count and the percentage of total rows
  - evidence: galata 'should rank unique values by count with a share bar each': rows ranked by count, bar width is the share of the largest count, counts match the payload
  - test: open a column with unequal counts and assert the order, bar widths and percentages
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-11-05T14:29:20Z @kj added
  - log: 2026-11-05T15:23:30Z @kj closed
- [x] `ACC-STATS-57-FORMAT` **Values formatted as the grid shows them** - HIGH; a value is shown as the grid shows it - a duration as H:MM:SS with fractional seconds when it has them and the grid day form when negative, a date or datetime in the grid format - not as raw microseconds or an epoch number
  - evidence: galata asserts unique values contain 0:05:00 and not 300000000; pytest and galata assert the datetime earliest row reads 2026-01-01T09:00:00
  - test: open the duration fixture column and assert the values read 0:05:00, not 300000000
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-11-05T14:29:20Z @kj added
  - log: 2026-11-05T14:59:23Z @kj closed
  - log: 2026-11-05T15:09:49Z @kj edited text "a value is shown as the grid shows it - a duration as H:MM:SS, a date or datetime in the grid's format - not as raw microseconds or an epoch number" -> "HIGH; a value is shown as the grid shows it - a duration as H:MM:SS with fractional seconds when it has them and the grid day form when negative, a date or datetime in the grid format - not as raw microseconds or an epoch number"
  - log: 2026-11-05T16:09:32Z @kj edited evidence "galata asserts unique values contain 0:05:00 and not 300000000" -> "galata asserts unique values contain 0:05:00 and not 300000000; pytest and galata assert the datetime earliest row reads 2026-01-01T09:00:00"
- [x] `ACC-STATS-58-HEADER` **Header actions** - MEDIUM; the header carries the column name, a type chip, Copy stats as JSON and Close; the chip is 22 px high with 2 px radius, 11 px text and a 1 px border, never a fully rounded pill; the copy action takes no content row
  - evidence: galata 'should style the header chip and expose copy and close actions': chip radius 2px, height 22px, copy and close present
  - test: open a column and assert the four header elements are present
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-11-05T14:29:20Z @kj added
  - log: 2026-11-05T14:41:53Z @kj edited text "the header carries the column name, a type chip, Copy stats as JSON and Close; the copy action does not occupy a content row" -> "MEDIUM; the header carries the column name, a type chip, Copy stats as JSON and Close; the chip is 22 px high with 2 px radius, 11 px text and a 1 px border, never a fully rounded pill; the copy action takes no content row"
  - log: 2026-11-05T15:23:30Z @kj closed
- [x] `ACC-STATS-59-EMPTY` **Empty and all-null columns** - MEDIUM; an all-null or zero-row column shows the four tiles with zeros and no type-specific block; the values pane states that there are no values
  - evidence: galata 'should report an all-null column as having no values': Non-null 0, Null 12, the no-values note and 'No values to list'
  - test: open an all-null column and assert zero tiles and no type block
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-11-05T14:29:20Z @kj added
  - log: 2026-11-05T15:23:30Z @kj closed
- [x] `ACC-STATS-60-LIMIT` **Limited unique values** - MEDIUM; when the endpoint returns fewer values than the unique count, the pane header reads N of M shown and the list scrolls
  - evidence: galata 'should limit the unique values list to the setting': with maxUniqueValues 5 the heading reads 5 of 12 shown
  - test: open a column with more unique values than the limit and assert the N of M text
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-11-05T14:29:21Z @kj added
  - log: 2026-11-05T15:23:30Z @kj closed
- [x] `ACC-STATS-61-TIME` **Time range block** - HIGH; a time column shows earliest, latest and span as H:MM:SS, keeping fractional seconds when the values carry them
  - evidence: pytest test_time_column_reports_earliest_latest_and_range; galata asserts the Time range earliest, latest and span rows
  - test: open the clock fixture column and assert the Time range rows
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-11-05T14:41:30Z @kj added
  - log: 2026-11-05T14:59:23Z @kj closed
  - log: 2026-11-05T16:09:32Z @kj amended text "a time column shows earliest, latest and span as H:MM:SS" -> "HIGH; a time column shows earliest, latest and span as H:MM:SS, keeping fractional seconds when the values carry them"
- [x] `ACC-STATS-62-DECIMAL` **Decimal uses the distribution block** - HIGH; a decimal column uses the distribution block, computing its statistics on a float reading of the stored values
  - evidence: galata 'should render the distribution for a decimal column': Q1, Q3 and Mean rows on the price decimal column
  - test: open a decimal column and assert Q1, Q3 and the mean
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-11-05T14:41:30Z @kj added
  - log: 2026-11-05T15:23:30Z @kj closed
- [x] `ACC-STATS-63-COPY` **Copy stats as JSON** - MEDIUM; Copy stats as JSON writes the statistics payload to the clipboard as JSON, and a refused clipboard write puts the button in a failure state
  - evidence: galata 'should copy the statistics as JSON': the clipboard parses as JSON with column_name price
  - test: open a column, click Copy stats as JSON and read the clipboard
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-11-05T14:45:06Z @kj added
  - log: 2026-11-05T15:09:49Z @kj edited text "Copy stats as JSON writes the statistics payload to the clipboard as JSON" -> "MEDIUM; Copy stats as JSON writes the statistics payload to the clipboard as JSON, and a refused clipboard write puts the button in a failure state"
  - log: 2026-11-05T15:23:31Z @kj closed
- [x] `ACC-STATS-64-CLOSE` **Close leaves the grid unchanged** - MEDIUM; the close button closes the dialog; Escape closes it too and leaves the table filters, sort and selection unchanged
  - evidence: galata 'should close the dialog on Escape and leave the grid intact': dialog hidden, grid still shows 12 rows
  - test: open a column, press Escape, assert the dialog is removed and the grid state is unchanged
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-11-05T14:45:06Z @kj added
  - log: 2026-11-05T15:23:31Z @kj closed
- [x] `ACC-STATS-65-NESTED` **Nested columns use the text block** - HIGH; a list, struct or map column is served as JSON text and uses the Text block
  - evidence: galata 'should render a nested column as a text block': the tags list column shows the text block with a most-common row
  - test: open a nested parquet column and assert the Text rows
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-11-05T14:45:06Z @kj added
  - log: 2026-11-05T15:23:31Z @kj closed
- [x] `ACC-STATS-66-FOCUS` **Dialog takes keyboard focus** - HIGH; opening the dialog moves keyboard focus into it, so Tab reaches Copy and Close before the page behind the overlay
  - evidence: galata 'should move keyboard focus into the statistics dialog': document.activeElement is inside [data-testid=stats-dialog]
  - test: open a column statistics dialog and assert document.activeElement is inside it
  - test-tags: FUNCTIONAL, E2E
  - log: 2026-11-05T15:09:49Z @kj added
  - log: 2026-11-05T15:42:12Z @kj closed
- [x] `ACC-STATS-67-BLOB` **Binary columns stay binary** - HIGH; a blob or binary column is typed binary in the grid header and chip, the grid shows '<BLOB size>', the dialog shows counts and a binary note only, and a placeholder column's unique count is labelled 'Unique (as shown)' because it counts displayed placeholders, not blobs
  - evidence: Galata 'should report a BLOB column as binary with no statistics' passes: header and chip read binary, placeholders listed, no-statistics note shown; fixture data/blob_sample.db; 64 Galata green at 1.7.20
  - test: open a sqlite blob column and a parquet binary column, assert the header and chip read binary and no text statistics render
  - test-tags: FUNCTIONAL
  - log: 2026-11-05T20:59:58Z @kj added
  - log: 2026-11-05T21:56:11Z @kj closed
  - log: 2026-11-05T22:34:50Z @kj amended text "a blob or binary column is typed binary in the grid header and the dialog chip, the grid keeps showing '<BLOB size>', and the dialog shows no value-derived statistics for it, only the counts and a note that the column holds binary content" -> "HIGH; a blob or binary column is typed binary in the grid header and chip, the grid shows '<BLOB size>', the dialog shows counts and a binary note only, and a placeholder column's unique count is labelled 'Unique (as shown)' because it counts displayed placeholders, not blobs"
- [x] `ACC-STATS-68-TICKS` **Share bars show each value's share** - MEDIUM; each unique-value row's bar fill spans that value's share of all rows on a plain track; no percentage ticks are drawn
  - evidence: galata 'should fit the tile labels and value headers at 2089x1244': every bar's fill and its percentage measure the count against all rows, no tick gradient on the track
  - test: galata: open age's unique values and assert each bar's fill width is its count share of all rows
  - test-tags: FUNCTIONAL
  - log: 2026-11-05T21:00:43Z @kj added
  - log: 2026-11-05T21:24:54Z @kj closed
  - log: 2026-11-06T12:46:12Z @kj amended title "Share bars carry percentage ticks" -> "Share bars show each value's share"; text "every share bar shows a faint tick at each 10 percent of its length, drawn behind the fill so a bar reads against one scale whatever its value" -> "MEDIUM; each unique-value row's bar fill spans that value's share of all rows on a plain track; no percentage ticks are drawn"; reason: the approved A design replaced ticked bars with share-of-rows bars; round 12 found the tick claim false
  - log: 2026-11-06T12:46:12Z @kj edited test "galata: open a column's unique values and assert the bar track paints ten equal stops and the fill stays inside it" -> "galata: open age's unique values and assert each bar's fill width is its count share of all rows"; evidence "galata 'should fit the tile labels and value headers at 2089x1244': the track resolves a repeating-linear-gradient with a 10 percent period at 14 px height, painted under the fill" -> "galata 'should fit the tile labels and value headers at 2089x1244': every bar's fill and its percentage measure the count against all rows, no tick gradient on the track"
- [x] `ACC-STATS-69-BLOB-SIZE` **Binary columns show size statistics** - HIGH; a binary column's dialog is narrow, shows Total rows, Non-null and Null only, and a Size block with min, Q1, median, Q3, max, mean, std dev and total byte size plus a size histogram; sizes come from length() and no contents are read; no unique count
  - evidence: Galata blob test asserts the three tiles, the Size block Min 512 B through Total 3.5 KB and the size histogram; pytest test_sqlite_blob_column_reports_binary_size_statistics; 208 pytest and 68 Galata green at 1.7.21
  - test: open data/blob_sample.db content statistics and assert the size block, the histogram and the three tiles
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T08:10:22Z @kj added
  - log: 2026-11-06T10:15:47Z @kj closed
- [x] `ACC-STATS-70-UNIQUE-RULE` **Unique pane only when values repeat** - MEDIUM; the unique values pane appears only when some value repeats and the distinct count is within the unique-values limit, so a nearly all-distinct column stays narrow; boolean and binary never show it; each bar is the row's share of all rows; headers read Share of rows and %
  - evidence: Galata 'should size the dialog from the pane and tint the chip by type' pins 980 with the pane for age and 720 without for salary and join_date; 'should show the pane only for a column within the limit' pins the limit gate; 68 Galata green
  - test: open an all-distinct column and a repeating one and assert the pane is hidden and shown
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T08:10:22Z @kj added
  - log: 2026-11-06T08:13:56Z @kj amended text "the unique values pane appears only when some value repeats, that is when unique_count is below non_null_count; boolean and binary columns never show it; each bar is the row's share of all rows and the headers read Share of rows and %" -> "MEDIUM; the unique values pane appears only when some value repeats and the distinct count is within the unique-values limit, so a nearly all-distinct column stays narrow; boolean and binary never show it; each bar is the row's share of all rows; headers read Share of rows and %"
  - log: 2026-11-06T10:15:47Z @kj closed
- [x] `ACC-STATS-71-TEMPORAL-HIST` **Temporal columns show a binned histogram** - MEDIUM; date, datetime and time columns show a binned histogram between the earliest and latest values, with the bin unit chosen from the span so there are between 8 and 20 bins and empty bins are kept
  - evidence: Galata clock, join_date and created assert one bar per payload bin (12, 20, 12); pytest test_temporal_histogram_unit_follows_the_span and test_temporal_histogram_short_spans_keep_the_date; 208 pytest green
  - test: open the clock, join_date and created columns and assert the histogram bin counts
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T08:10:22Z @kj added
  - log: 2026-11-06T10:15:47Z @kj closed
- [x] `ACC-STATS-72-NUM-HIST` **Numeric columns show a histogram** - MEDIUM; int, float, decimal and duration columns show a histogram of about 12 equal-width bins beside the box plot, with empty bins kept, and the axis labels formatted as the grid shows the values
  - evidence: pytest test_numeric_histogram_bins_cover_every_non_null_value asserts 12 bins summing to non-null for age, salary, price and elapsed; Galata age test asserts the histogram above the box plot; 208 pytest, 68 Galata green
  - test: open the age and salary columns and assert the histogram bars and axis labels
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T08:10:22Z @kj added
  - log: 2026-11-06T10:15:47Z @kj closed
- [x] `ACC-STATS-73-NS-RUNTIME` **duration[ns] renders on every install** - HIGH; a duration[ns] column's rows, unique values, filter and statistics all return text on an install of the wheel alone, because pyarrow's nanosecond conversion needs pandas and pandas is a declared runtime dependency
  - evidence: fresh venv install of the 1.7.21 wheel pulled pandas 2.3.3; pa.scalar(1500000001, pa.duration('ns')).as_py() rendered '0 days 00:00:01.500000001'; pytest 209 and Galata 68 green
  - test: install the wheel in a fresh venv, open a duration[ns] parquet, assert the grid cell reads `0 days 00:00:01.500000001`
  - test-tags: UNIT, FUNCTIONAL, E2E
  - mechanism: 2026-11-06T12:46:05Z @kj pyarrow's DurationScalar.as_py converts a duration[ns] scalar to Timedelta only through pandas; pandas sits in [project].dependencies, so every install carries the conversion and no pandas-free fallback path remains
  - log: 2026-11-06T12:46:05Z @kj added
  - log: 2026-11-06T13:08:15Z @kj closed: closed: verified on the built wheel and a fresh venv
- [x] `ACC-STATS-74-HEIGHT` **Dialog at most three quarters of the window height** - MEDIUM; the statistics dialog is never taller than 75 percent of the window height and stays centred; when the statistics column does not fit in that height it scrolls instead of being clipped, otherwise only the values pane scrolls
  - evidence: galata 'should cap the dialog at three quarters of the window height': age 933 px at 2089x1244 and 495 px at 1280x660, centred, no statistics scroll; salary 337.5 px at 1280x450 scrolls to its last block; old rule fails at 1228 px; Galata 69, pytest 208 at 1.8.2
  - mechanism: 2026-11-06T16:30:54Z @kj max-height: 75vh on .jp-ColumnStatsModal-content, centred by the overlay flex; overflow-y: auto on .jp-ColumnStatsModal-stats, whose min-height: 0 lets the body bound it, so it scrolls only when its content is taller
  - related: ACC-STATS-48-DIALOG - its only-the-values-pane-scrolls rule now holds while the statistics column fits in 75 percent of the window
  - test: galata: at 2089x1244 and 1280x660 open age, assert the dialog height is at most 0.75 of window.innerHeight and the statistics column's last block can be scrolled into view
  - test-tags: FUNCTIONAL, E2E
  - log: 2026-11-06T15:56:42Z @kj added
  - log: 2026-11-06T16:30:58Z @kj closed: closed: 75vh cap, statistics column scrolls only on overflow

## Grid display `GRID`

Layout, scrolling and alignment of the table grid

- log: 2026-11-06T17:27:42Z @kj category created

- [x] `ACC-GRID-75-SCROLLBAR` **Vertical scrollbar starts below the header rows** - MEDIUM; the grid's vertical scrollbar starts below the filter row and the column-name row and never runs beside them, in every browser and theme
  - evidence: galata 'should start the vertical scrollbar below the header rows': scroller top 156.69 px equals header bottom, 67 px before the fix; verified with real scrollbars and with scrollbar-width: thin
  - related: DEF-GRID-46-SCROLL-HEAD - the defect this criterion closes
  - test: galata: open sample_data.parquet, scroll down, assert the top of the vertical scroller is at or below the bottom of the header strip
  - test-tags: FUNCTIONAL, E2E
  - log: 2026-11-06T17:27:42Z @kj added
  - log: 2026-11-06T18:07:55Z @kj closed: closed: header strip above the body scroller
- [x] `ACC-GRID-76-ALIGN` **Header columns line up with body columns** - HIGH; every header cell keeps the left and right edges of its body column at every horizontal scroll position, so a filter or header always sits over its own column
  - evidence: galata 'should start the vertical scrollbar below the header rows': 0 px edge offset for every visible header cell at scrollLeft 300 and at the maximum; 0 px after a 100 px column resize
  - test: galata: scroll the body right by 300 px and assert each visible header cell's edges match its body column within 1 px
  - test-tags: FUNCTIONAL, E2E
  - log: 2026-11-06T17:27:42Z @kj added
  - log: 2026-11-06T18:07:55Z @kj closed: closed: shared colgroup widths and synced scrollLeft

## Build and quality `BUILD`

Lint, packaging and the quality gates every release passes

- log: 2026-11-06T17:27:42Z @kj category created

- [x] `ACC-BUILD-77-LINT` **Lint reports no warnings** - MEDIUM; jlpm run lint:check reports 0 errors and 0 warnings with no eslint-disable comment and no change to the lint rules
  - evidence: jlpm run lint:check exit 0, eslint --max-warnings=0 and stylelint --max-warnings=0 exit 0; no eslint-disable in src, style or ui-tests; eslint.config.mjs unchanged
  - test: run jlpm run lint:check and grep src for eslint-disable
  - test-tags: MANUAL
  - log: 2026-11-06T17:27:42Z @kj added
  - log: 2026-11-06T18:07:55Z @kj closed: closed: 36 warnings fixed at their causes in commit e02481e
- [x] `ACC-BUILD-78-TRANSLATE` **User-facing strings are translatable** - LOW; every user-facing string of the grid and the three dialogs goes through the JupyterLab translator when one is installed and reads the same English when none is
  - evidence: 27 literals wrapped with trans.__() in commit e02481e; Galata 70 green with no translator installed, every English label assertion unchanged
  - test: galata: open the grid and the statistics, filter and export dialogs and assert their English labels
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T17:27:42Z @kj added
  - log: 2026-11-06T18:07:55Z @kj closed: closed: optional ITranslator, one bundle passed to the viewer and the three dialogs
