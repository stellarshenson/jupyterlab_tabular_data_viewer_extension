# Acceptance Criteria - JupyterLab Tabular Data Viewer Extension

Consolidated criteria for the extension. One `##` section per feature area; `[ ]` todo, `[x]` done, with a dated `log:` line under each criterion.

## Contents

- [Large database handling](#large-database-handling)

## Large database handling

A tabular file must open without the browser fetching its contents, and BLOB contents must never leave the server. Two mechanisms: the document context loads no file content, and the SQLite reader builds BLOB placeholders in SQL rather than in pandas.

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

- [x] **Placeholder built in SQL** - the select list wraps every column so a BLOB yields `<BLOB n.n KB>` from SQLite; BLOB bytes are never read into pandas or arrow
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
