# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- <START NEW CHANGELOG ENTRY> -->

## [1.7.5] - 2026-08-08

### Added

- **SQLite browser**: `.db`, `.sqlite`, `.sqlite3` and `.db3` databases open in the viewer with each user table rendered as a tab in the existing sheet bar. Switching tables resets filters, sort, selection, scroll position and column widths, exactly as switching an Excel sheet does. Single-table databases show no tab bar. System tables (`sqlite_sequence` and any other `sqlite_*`) are filtered out of the list
- **Datasource type indicator** in the status bar - the left group is prefixed with `SQLite`, `Parquet`, `Excel`, `CSV` or `TSV`, so the format actually being read is visible rather than inferred from the filename
- **BLOB placeholders**: binary cells render as `<BLOB 42.1 KB>` (B/KB/MB, trailing zeros dropped, matching the existing file-size convention) in the grid and in every export format, so binary never reaches the table or the exported file
- **Read-only connection guarantee**: SQLite is opened through a `file:...?mode=ro` URI, so the viewer cannot mutate the database it is browsing
- New `enableSQLite` setting (default enabled) to disable SQLite handling and fall back to JupyterLab's default handler
- New synthetic fixture `data/sample_database.db`, regenerated deterministically by `scripts/make_sample_database.py`. Four tables chosen to cover each branch: `customers` (12 rows, plain types), `orders` (30 rows, `AUTOINCREMENT`, which is what creates `sqlite_sequence`), `attachments` (4 rows, BLOB column), `mixed_types` (6 rows, int and string in one column)
- 24 new pytest tests covering magic-byte sniffing, a SQLite database named `.txt`, a non-SQLite `.db`, `list_sqlite_tables` excluding `sqlite_sequence`, unknown-table `ValueError`, BLOB placeholder output, the v1.6.0 cascade over `mixed_types`, `sourceType` and `sheets` in metadata for every format, `/data` with a table name, the `sample_database_orders.csv` download filename, the rejected `original` export format, and an mtime/size check proving the read-only connection does not touch the file
- 8 new galata tests driving the real UI: database opens with rows rendered, tab bar lists exactly the four user tables with `sqlite_sequence` absent, clicking a tab re-renders the grid, filter state resets across a table switch and back, status bar reads `SQLite` for the database and `Parquet` for the parquet fixture, BLOB cells show the placeholder, the export popup omits `Original` for SQLite, and still offers it for parquet

### Changed

- **SQLite is identified by content, not extension**: `get_file_type` checks for the 16-byte `SQLite format 3\0` header first and falls back to the existing extension switch otherwise. This is the signal `file(1)` keys on, read in-process rather than as a subprocess, so it also works where `file` is absent. Extension-only detection was untenable for SQLite specifically: `.db` is claimed by several unrelated formats, and a database may carry any extension at all. Parquet, Excel, CSV and TSV continue to resolve by extension exactly as before - only SQLite is sniffed, because only SQLite needed it
- Download filenames slugify the active SQLite table the same way they already slugified the active Excel sheet - `chats.db` with table `feed_scan` exports as `chats_feed_scan.csv`, with no filename-code change needed
- Project `Makefile` refreshed verbatim from the canonical version, 1.31 to 1.36: node and npm resolve exclusively from the project-local nodeenv, `build` formats the lockfiles with the pinned prettier, `check_dependencies` treats an empty `node_modules` as missing, and `test` now runs the Python suite alongside `jlpm test`. `.gitignore` gains `.nodeenv`

### Fixed

- Backend errors no longer render as `Error: [object Object]`. The metadata, data, column-stats and unique-values routes report failures as `{"error": "..."}`, but the request helper read `data.message` first, so the object itself became the message and every distinguishable cause collapsed into one unreadable line
- A CSV or TSV whose first column is named `PAR1` is no longer misread as Parquet. Only SQLite is sniffed now; the four printable bytes of the Parquet signature were matching ordinary text files and returning HTTP 500
- A zip archive named `.db` no longer returns HTTP 500 with a traceback. It was matching the xlsx signature and failing with a `KeyError`, which is not a `ValueError` and so escaped the handlers' 400 path
- A corrupt database, one locked by another writer, or a WAL database on a read-only mount now returns HTTP 400 with a readable message instead of HTTP 500 with a server-side traceback. `sqlite3.Error` is mapped to `ValueError` at the connection boundary, and table listing shares the same handled block as the read
- A table that is listed but cannot be read - a virtual table needing a module this SQLite build lacks, or a clobbered data page behind an intact header - also returns HTTP 400 rather than 500. `pandas` re-raises driver errors as `pandas.errors.DatabaseError`, which subclasses `OSError` rather than `sqlite3.Error`, so it needed its own arm at the connection boundary. When such a table sorts first alphabetically, the whole database was unopenable
- The loading spinner no longer scrolls out of view. It was absolutely positioned inside the `overflow: auto` table container, so once the user had scrolled it sat above the viewport - invisible in exactly the case it exists for
- The table bar no longer jumps back to the far left on every switch. Rebuilding the bar reset its `scrollLeft`, so on a database with more tables than fit, the tab just clicked scrolled off-screen
- The datasource label and file stats no longer blank out on every fetch, which made the status bar strobe during scroll-driven pagination
- A named pipe in the notebook tree can no longer block a request handler: detection now refuses anything that is not a regular file
- The loading overlay no longer dims the sheet bar and status bar. Both now sit above it, so the metrics and the Export link stay readable during a load instead of rendering greyed-out while remaining clickable
- The status bar no longer stays on `Loading...` after a failed fetch, which left a stale busy message beside otherwise healthy-looking file statistics and hid the Export link
- `Original` is no longer offered for a database whose metadata failed to load: the check falls back to the file extension when the datasource type is not yet known

### Technical

- New `sniff_file_type(file_path)` in `readers.py` reads the first 16 bytes and matches against a `_MAGIC` table holding the single SQLite signature; returns `None` when unrecognised so `get_file_type` falls through to the extension switch. It refuses anything that is not a regular file, so a FIFO in the notebook tree cannot block the handler
- New `list_sqlite_tables(file_path)` returns user tables in name order via `sqlite_master`. The query uses `NOT LIKE 'sqlite\_%' ESCAPE '\'` - without the escape, `_` is a single-character wildcard and would also hide a user table named `sqliteX...`
- New `_read_sqlite(file_path, table=None)` resolves `table` against `list_sqlite_tables` and raises `ValueError` when absent. Whitelist validation, not quoting, is what makes this safe: table names cannot be parameterised in SQL. The identifier is additionally double-quoted with `"` doubled. `None` selects the first table; a database with no user tables raises `ValueError` and surfaces as HTTP 400
- Full-table `SELECT *` into a DataFrame, then the existing `_df_to_arrow` path - one code path, so all existing filter, sort, pagination, stats and export logic applies to SQLite unchanged
- New `_sqlite_uri(file_path)` builds the read-only URI, percent-escaping `?` and `#` in the path
- `read_as_arrow_table(path, sheet=None)` gains a `sqlite` branch; `sheet` carries the table name, so no new plumbing through the four handlers
- `ParquetMetadataHandler` response gains `sourceType` (the raw `get_file_type` value) and populates `sheets` from `list_sqlite_tables` for SQLite files
- `TabularDataViewer` gains `_sourceType` state and a `SOURCE_LABELS` map; `_updateStatusBar` emits a `.jp-TabularDataViewer-sourceType` span, and the tab bar is a labelled `group` whose accessible name is "Tables" for SQLite and "Sheets" otherwise, with `aria-current` on the active tab. Deliberately not `role="tablist"`: that pattern promises arrow-key navigation with a roving tabindex, and native buttons already carry the keyboard behaviour
- `index.ts` registers a single `sqlite-tabular-viewer` file type covering all four extensions (`base64` format, `jp-SpreadsheetIcon`, `application/vnd.sqlite3`) behind the `enableSQLite` setting

## [1.6.12] - 2026-05-06

### Added

- **Loading spinner overlay**: a brand-coloured spinning ring appears over the table area during data loads (initial open, filter/sort changes, sheet switches). Quick scroll-triggered paginations don't flash the spinner thanks to a 150ms debounce

### Technical

- New `_loadingOverlay` and `_loadingTimer` state on `TabularDataViewer`; `_showLoadingOverlay()` / `_hideLoadingOverlay()` helpers wired into `_loadData` start + `finally`
- `pointer-events: none` on the overlay so clicks pass through during long loads
- Backdrop uses `color-mix(in srgb, var(--jp-layout-color1) 60%, transparent)` for theme-aware translucency
- New `.jp-TabularDataViewer-loadingOverlay`, `.jp-TabularDataViewer-spinner` rules and `@keyframes jp-TabularDataViewer-spin`

## [1.6.10] - 2026-05-06

### Added

- **Multi-sheet Excel support**: workbooks with multiple worksheets now expose all sheets via a minimal sheet bar at the bottom of the viewer (above the status bar, Excel-style). Each sheet is treated as a separate file - switching sheets resets all filters, sort, selection, scroll position, and column widths, then reloads metadata + data fresh. Bar is hidden for single-sheet Excel files and all non-Excel formats
- **Parquet (.parquet) download format** in the Export modal
- **JSONL (.jsonl) download format** in the Export modal - one JSON object per row via `df.to_json(orient='records', lines=True)` with `Content-Type: application/x-ndjson`
- **Export link in the status bar** for quick access; opens the same format picker as the right-click context menu
- **Filter notice in the Export popup** - when filters are active, the popup shows a one-line note that the export will include only filtered rows
- 18 new pytest tests covering `slugify`, `list_excel_sheets`, `read_as_arrow_table` with sheet, the v1.6.0 cascade through a multi-sheet file, metadata sheets field, sheet param flow through `/data`, full download filename matrix (sheet/no-sheet × filters/no-filters), JSONL + Parquet output formats and Content-Type headers

### Changed

- "Download Filtered Data" command and modal title renamed to "Export"
- Download filenames now reflect the active sheet: `<base>_<slug>.<ext>` for sheet-active downloads, `<base>_<slug>_filtered.<ext>` when filters are applied
- The `_filtered` suffix in download filenames is now conditional on active filters. Previously it was always appended regardless of filter state. Sort order alone does not trigger the suffix

### Fixed

- Download responses now serve the correct `Content-Type` header. `APIHandler.finish()` was overriding all download Content-Types to `application/json` unless `set_content_type=` is passed; parquet/excel/csv/tsv all silently returned `application/json` regardless of the headers set in the handler. `DownloadHandler` now computes body + content type per format branch and passes `set_content_type=` to `finish()` once

### Technical

- New `list_excel_sheets(path)` helper in `readers.py` returns workbook sheet names via `pd.ExcelFile.sheet_names`; empty list for non-Excel
- `_read_excel(path, sheet=None)` and `read_as_arrow_table(path, sheet=None)` accept optional sheet name; default `None` reads first sheet (preserves prior behaviour)
- New `slugify()` helper in `routes.py`: lowercase, non-alphanumerics collapse to `_`, fallback to `"sheet"` for empty/whitespace input
- `ParquetMetadataHandler` response gains `sheets: list[str]` field (empty for non-Excel)
- All four POST handlers accept optional `sheet` field in request body; `DownloadHandler` reads `sheet` from query string
- `fetchColumnStats` and `fetchUniqueValues` in `request.ts` accept optional `sheet` argument
- `TabularDataViewer` widget gains `_sheets`, `_activeSheet`, `_sheetBar` state plus `_renderSheetBar()`, `_switchSheet()`, `_resetState()` methods. Sheet bar inserted between table container and status bar in widget DOM
- `DownloadModal` constructor accepts `hasFilters` boolean; renders a `jp-FilterModal-notice` block when true
- New test fixture `data/multi_sheet.xlsx` (3 sheets: Sheet1 / MixedTypes / Sales 2024) covers the multi-sheet code paths and the v1.6.0 cascade

## [1.6.0] - 2026-05-06

### Fixed

- Excel/CSV/TSV files with mixed-type columns now open correctly. Previously columns containing values of more than one type (e.g. a column with both `42` and `'ACCFS-108'`, or `True`/`False` mixed with `'true (either)'`) failed at the PyArrow conversion step with `ArrowInvalid` and surfaced as a generic open failure

### Changed

- Reader logic extracted from `routes.py` into a dedicated `readers.py` module
- Per-handler dispatch ladders (parquet/excel/csv/tsv if-elif chains) collapsed into a single `read_as_arrow_table()` call

### Technical

- New `_series_to_arrow_array` helper implements two-step cascading type inference: native PyArrow inference first, fallback to string on `ArrowInvalid` / `ArrowTypeError` / `ArrowNotImplementedError`. Applied per column so a single problematic column does not block the whole table
- Numeric coercion is intentionally excluded from the cascade. Excel stores dates as floats internally, so a numeric fallback could silently strip date semantics from columns with stray non-date values
- New `read_as_arrow_table(path)` dispatcher centralises file-type routing for parquet/excel/csv/tsv. Raises `ValueError` for unsupported types so callers can map cleanly to HTTP 400
- `ParquetMetadataHandler` preserves the parquet metadata-only fast path (`ParquetFile.metadata.num_rows`)

## [1.5.8] - 2025-11-23

**Tag**: RELEASE_1.5.8

### Added

- **Context Menu Download with Multi-Format Modal**: Download filtered and sorted data via right-click context menu
  - Right-click on viewer to access "Download Filtered Data" command in context menu
  - Modal dialog displays three format options: Original Format, Excel (.xlsx), CSV
  - All format options permanently enabled - no user configuration required
  - Modal uses filter modal styling for consistent UI appearance
  - Format buttons stacked vertically with proper spacing
  - Cancel button at bottom of modal for easy dismissal
  - Downloads preserve all active filters, sort order, and data transformations
  - Backend supports format conversion (e.g., Parquet to Excel, CSV to Excel)
  - Output filename includes appropriate extension based on selected format

### Changed

- Removed download format settings (enableDownloadOriginal, enableDownloadExcel, enableDownloadCSV)
- Simplified settings interface by removing download-specific configuration
- Modal always shows all three format options without user preference filtering

### Technical

- Added `DownloadModal` class in src/modal.ts with format selection UI
- Modal uses `jp-FilterModal` CSS classes for consistent styling with existing modals
- Added `showDownloadModal()` public method to TabularDataViewer widget
- Registered "Download Filtered Data" command in context menu at rank 100
- Updated `DownloadHandler` backend to accept format parameter ('original', 'xlsx', 'csv')
- Backend determines output format based on request parameter, not source file type
- Added `jp-FilterModal-buttons` CSS class for vertical button layout with 8px gap
- Added `jp-FilterModal-footer` CSS class for footer section with top border
- Removed download-specific CSS in favor of reusing filter modal styles
- Updated README.md with download feature documentation and screenshot

## [1.5.0] - 2025-11-22

**Tag**: RELEASE_1.5.0

### Added

- **Download Filtered Data**: Export filtered and sorted data in original file format
  - "Download Filtered Data" button added to status bar right section
  - Downloads data with current filters and sorting applied
  - Exports in original format (Parquet, Excel, CSV, or TSV)
  - Downloaded filename includes "\_filtered" suffix (e.g., "data_filtered.parquet")
  - Supports all filter types: text/regex matching with case sensitivity, numeric comparisons
  - Preserves current sort order (ascending/descending by column)
  - Backend converts filtered PyArrow table to pandas DataFrame for export
  - Parquet exports use `to_parquet()` with BytesIO buffer
  - Excel exports use `to_excel()` with openpyxl engine
  - CSV exports use `to_csv()` with UTF-8 encoding
  - TSV exports use `to_csv()` with tab delimiter
  - Proper HTTP headers (Content-Type and Content-Disposition) for each format
  - Allows users to export filtered views for use in other applications

### Technical

- Added `DownloadHandler` backend class handling GET requests with filter/sort parameters
- Frontend uses `URLExt.join()` and `ServerConnection.makeSettings()` for proper URL construction
- Download URL includes query parameters: path, filters (JSON), sortBy, sortOrder, caseInsensitive, useRegex
- Backend applies same filter logic as data display handler
- PyArrow sorting using `pc.sort_indices()` before DataFrame conversion
- Download button styled with brand colors, hover states, and smooth transitions
- Temporary link element created and removed after triggering download

## [1.4.4] - 2025-11-18

**Tag**: RELEASE_1.4.4

### Added

- **Frozen Index Column**: Row number column stays fixed when scrolling horizontally through wide datasets
  - Implemented using CSS sticky positioning with `position: sticky` and `left: 0`
  - Row number cells use `z-index: 5` for proper layering above regular cells
  - Header row number cells use `z-index: 15` to appear above sticky header
  - Subtle box-shadow (2px 0 4px) on right edge for visual depth during scrolling
  - Improves usability by keeping row numbers always visible

- **Row Selection**: Click anywhere on a row to highlight it with subtle color shading
  - Click any cell in row to select/highlight entire row
  - Click again to toggle off (deselect)
  - Click different row to switch selection
  - Entire row shows pointer cursor indicating clickability
  - Selected row cells use `color-mix(in srgb, var(--jp-brand-color1) 10%, transparent)` for subtle highlighting
  - Selected row index cell uses `color-mix(in srgb, var(--jp-brand-color1) 20%, var(--jp-layout-color2))` for opaque shading
  - Selection clears automatically on data reset or error states
  - Improves data inspection workflow with visual feedback

### Fixed

- **Auto-clear Filter**: Filters now automatically clear when input field is emptied
  - Previously filters only cleared when pressing Enter key
  - Filter remained active if text was cleared without pressing Enter
  - Added `input` event listener to detect empty filter fields
  - Automatically removes filter, clears button active state, and reloads data
  - More intuitive and immediate filter clearing behavior

### Technical

- Added `_selectedRow` private property to track selected row element
- Click handler on row element adds/removes `jp-TabularDataViewer-row-selected` CSS class
- Used CSS `color-mix()` for sophisticated color blending with transparency
- Filter input listener checks if value is empty AND filter exists for column
- Deletes filter and triggers data reload when field emptied

## [1.3.30] - 2025-11-14

**Tag**: RELEASE_1.3.30

### Added

- **JupyterLab-Driven Font Sizing**: All UI fonts now use JupyterLab CSS variables for responsive scaling
  - Column names: `calc(var(--jp-ui-font-size1) * 1.10)` for 10% larger text
  - Column types: `var(--jp-ui-font-size1)`
  - Table cells: `var(--jp-ui-font-size1)`
  - Row numbers: `var(--jp-ui-font-size1)`
  - Fonts scale automatically with JupyterLab's UI font size settings
- **Settings Panel Icon**: Extension now displays spreadsheet icon in JupyterLab Settings panel using `ui-components:spreadsheet`
- **Maximum Unique Values Setting**: New `maxUniqueValues` setting (default: 100) controls unique value display limits
  - Applies to both filter dialog and statistics modal
  - Set to 0 for unlimited display
  - Configurable via Settings Editor
- **Enhanced Statistics Modal - Unique Values Display**:
  - Scrollable list of unique values sorted by frequency (most common first)
  - Shows value count and percentage for each unique value
  - Displays as bullet points matching other stats sections
  - Info message only appears when values are limited: "Showing X of Y unique values"
  - Hidden when all unique values are displayed
- **Backend Sorting by Frequency**: UniqueValuesHandler now sorts unique values by count (frequency) in descending order
- **README Disclaimer**: Humorous acknowledgment that extension is shameless ripoff of typical tabular data browsing tools

### Changed

- **Statistics Icon**: Restored Font Awesome info icon (`fas fa-info-circle`) for column statistics
- **Unique Values Display Style**: Changed from custom box layout to standard bullet points for consistency

## [1.3.14] - 2025-11-14

**Tag**: RELEASE_1.3.14

### Added

- **Backend Tests**: Comprehensive pytest test suite for API endpoints
  - test_metadata_endpoint - validates metadata fetching and column information
  - test_unique_values_endpoint - validates unique values with counts functionality
  - test_data_endpoint_with_filter - validates regex filtering on numeric columns
  - test_first_row_content - validates specific data content and structure
  - All tests copy test data to pytest temporary directory for isolation
- **CI/CD Integration**: Python test execution in GitHub Actions workflow
  - Added pytest execution step to .github/workflows/build.yml
  - Tests run automatically on every push and pull request
  - Installs test dependencies and runs full test suite
- **KOLOMOLO Badge**: Added branding badge to README.md
  - Shields.io format with cyan color (#00ffff)
  - Links to kolomolo.com
- **Test Data**: email_classification_dataset.parquet test file
  - 13 rows with email content and is_maintenance classification
  - Used for comprehensive backend testing

### Changed

- **Refresh View Integration**: Fixed integration breaking other file types
  - Removed command override approach that interfered with menu registration
  - Reverted to signal-based integration using context.fileChanged
  - Now works seamlessly with all file types without interference
- **Code Formatting**: Applied Prettier and Black formatting
  - All TypeScript/JavaScript files formatted with Prettier
  - All Python files formatted with Black
- **Project Journal**: Merged duplicate journals into single tracked file
  - Consolidated root JOURNAL.md and .claude/JOURNAL.md
  - All 49 entries properly numbered and organized
  - Removed .claude from .gitignore for git tracking

### Fixed

- Context menu integration with refresh view extension
- TypeScript compilation errors in index.ts

## [1.3.2] - 2025-11-14

**Tag**: RELEASE_1.3.2

### Added

- **Slash Command**: Added `/install` command for quick development installation
  - Executes `make install` to build and install extension
  - Simplifies development workflow
  - Available in Claude Code workspace

### Changed

- **List and Dict Display**: Enhanced handling of complex data types in Parquet files
  - List/tuple values now display as JSON strings in cells
  - Dict values now display as JSON strings in cells
  - Improves readability of nested/structured data
  - Applies to all file formats (Parquet, Excel, CSV, TSV)

## [1.3.1] - 2025-11-14

**Tag**: RELEASE_1.3.1

### Changed

- **List and Dict Display**: Enhanced handling of complex data types in Parquet files
  - List/tuple values now display as JSON strings in cells
  - Dict values now display as JSON strings in cells
  - Improves readability of nested/structured data
  - Applies to all file formats (Parquet, Excel, CSV, TSV)

## [1.3.0] - 2025-11-14

**Tag**: RELEASE_1.3.0

### Summary

Minor version bump consolidating recent feature additions and improvements. This release introduces configurable cell text truncation, unified refresh view integration, enhanced sorting indicators, and absolute row indexing.

### Added

- **Cell Text Truncation Setting**: Configurable maximum character limit for cell display (v1.2.41)
  - New `maxCellCharacters` setting (default: 100, set to 0 for unlimited)
  - Text longer than limit truncated with "..." ellipsis
  - Display-only truncation, original data unchanged
  - Configurable via Settings Editor

- **Absolute Row Indices**: Row numbers show original file position (v1.2.20)
  - Row numbers persist correctly through filtering and sorting
  - Backend tracks original indices with `__original_row_index__` column
  - Frontend displays absolute position regardless of view state

### Changed

- **Refresh View Integration**: Unified refresh command (v1.2.42-1.2.45)
  - Overrides `jupyterlab_refresh_view:refresh` for tabular viewers
  - Falls back to original behavior for other document types
  - Eliminates duplicate context menu items
  - Preserves scroll position, filters, and sorting during refresh

- **Sort Indicator Position**: Repositioned to right bottom corner (v1.2.35)
  - Absolutely positioned (right: 8px, bottom: 4px)
  - Increased size to 16px bold for better visibility
  - No impact on header layout or dimensions

### Fixed

- **Context Menu Display**: Restored refresh view menu item (v1.2.43-1.2.45)
  - Added explicit context menu registration for tabular viewers
  - Checks current widget before applying tabular-specific refresh
  - Works correctly with refresh view extension load order

- **Column Resize Bug**: Fixed off-by-one error (v1.2.30)
  - Row number column accounted for in resize calculations
  - Added +1 offset when accessing headerRow/filterRow children

- **Sorting Regression**: Fixed null reference error (v1.2.33)
  - Added null check for sort indicators in row number column
  - Reduced resize handle width from 24px to 16px

## [1.2.42] - 2025-11-14

**Tag**: RELEASE_1.2.42

### Changed

- **Refresh View Integration**: Override refresh view extension command instead of creating duplicate
  - Now uses `jupyterlab_refresh_view:refresh` command ID directly
  - When tabular data viewer is active, "Refresh View" context menu uses tabular-specific refresh
  - Falls back to original refresh view behavior for other document types
  - Eliminates duplicate "Refresh Tabular Data" and "Refresh View" context menu items
  - Provides unified refresh experience across all document types

## [1.2.41] - 2025-11-14

**Tag**: RELEASE_1.2.41

### Added

- **Cell Text Truncation Setting**: Added configurable maximum cell character limit
  - New `maxCellCharacters` setting in extension settings (default: 100 characters)
  - Text longer than limit is truncated with "..." ellipsis in display only
  - Set to 0 for unlimited text display
  - Original data unchanged - truncation is visual only
  - Settings: Advanced Settings Editor → Tabular Data Viewer Extension → Maximum Cell Characters

## [1.2.35] - 2025-11-10

**Tag**: RELEASE_1.2.35

### Added

- **Refresh Data Command**: Added ability to refresh tabular data view from file
  - New `refresh()` method in `TabularDataViewer` widget
  - Preserves scroll position during refresh
  - Maintains current filters and sorting settings
  - Reloads metadata to detect file structure changes
  - Available via context menu: right-click on viewer and select "Refresh Tabular Data"
  - Command ID: `tabular-data-viewer:refresh`

## [1.2.30] - 2025-11-04

**Tag**: RELEASE_1.2.30

### Fixed

- **Column Resize Index Offset**: Fixed off-by-one error when resizing columns
  - Column resize was targeting wrong columns after row number column addition
  - Row number column is first DOM child but not in `_columns` array
  - Added +1 offset when accessing `headerRow` and `filterRow` children
  - Fixed table width calculation to include 60px row number column

- **CI/CD Build Failures**: Resolved dependency lock file conflicts
  - Removed `package-lock.json` (using yarn/jlpm exclusively)
  - Regenerated clean `yarn.lock` with fresh `jlpm install`
  - Fixes post-resolution validation errors in CI pipeline

### Changed

- **Info Icon**: Replaced unicode character with Font Awesome icon
  - Switched from unicode '🛈' to Font Awesome's `fa-info-circle`
  - Added Font Awesome CSS import for consistent cross-platform rendering
  - Updated CSS to use opacity transitions for smoother fade effect
  - Reduced icon size to 14px for better proportions

- **Documentation**: Updated RELEASE.md with version 1.2 feature summary
  - Added "What's New in Version 1.2" section documenting major features
  - Column Statistics Modal (1.2.8) overview
  - Absolute Row Indices (1.2.20) explanation
  - Enhanced Row Number Column Styling (1.2.20) details

<!-- <END NEW CHANGELOG ENTRY> -->

## [1.2.20] - 2025-11-04

**Tag**: RELEASE_1.2.20

### Fixed

- **Row Index Display**: Row numbers now show absolute position in original file instead of view-relative position
  - Previously, when filters or sorting were applied, row numbers would restart from 1 (showing position in filtered view)
  - Backend now tracks original row indices throughout filtering and sorting operations
  - Added internal `__original_row_index__` column to maintain absolute position through all transformations
  - Frontend displays these absolute indices, making it easy to identify exact row location in source file
  - Context menu "Copy Row as JSON" excludes internal `__row_index__` metadata field
  - Affects all file types (Parquet, CSV, TSV, Excel)

### Changed

- **Row Number Column Styling**: Enhanced visual separation with borders
  - Added vertical right border to separate row numbers from data columns
  - Added horizontal borders between rows in row number column for improved readability
  - Borders use `var(--jp-border-color0)` for subtle, consistent appearance
  - Borders scoped to data rows only (tbody), excluding filter and header rows for clean appearance

<!-- <END NEW CHANGELOG ENTRY> -->

## [1.2.8] - 2025-11-03

**Tag**: RELEASE_1.2.8

### Added

- **Column Statistics Modal**: Interactive statistics viewer for detailed column analysis
  - Hover over any column header to reveal info icon (brand color on hover, transparent otherwise)
  - Click icon to open modal dialog with comprehensive statistics
  - Data summary section - total rows, non-null count/percentage, null count/percentage, unique values count/percentage
  - Type-specific statistics:
    - Numeric (int/float) - min, max, mean, median, standard deviation, outlier detection with count and percentage
    - String - most common value with count, minimum/maximum/average string length in characters
    - Date/datetime - earliest date, latest date, date range span in days
  - Copy Stats as JSON button with clipboard API integration and visual feedback ("Copied!" confirmation)
  - Keyboard shortcut (ESC) and backdrop click to close modal
  - Backend implementation using PyArrow compute functions (pc.mode, pc.utf8_length, pc.min_max, pc.quantile, pc.stddev)
  - Created stats.py module with calculate_column_stats() function and simplify_type() helper
  - Added ColumnStatsHandler API endpoint at /column-stats accepting POST requests with file path and column name
  - Created modal.ts Lumino Widget component with organized stat sections and formatting
  - Added IColumnStats TypeScript interface and fetchColumnStats() function in request.ts
  - Updated widget.ts to add info icon to column headers with click event handling
  - Supports all file types (Parquet, CSV, TSV, Excel)

### Changed

- **String Statistics Calculation**: Improved reliability for string column analysis
  - Filter out null values using pc.drop_null() before computing string statistics
  - Separate try/except blocks for mode calculation and string length operations
  - Only display String Statistics section in modal when stats are successfully calculated
  - Prevents empty section headers from appearing when calculations fail

- **Documentation**: Reorganized README for better visual flow and comprehensiveness
  - Consolidated all screenshots into introduction section before Features section
  - Added screenshot-stats-icon.png showing info icon hover interaction on column header
  - Added screenshot-stats.png showing statistics modal dialog with numeric column example
  - Added screenshot-copy-json.png showing right-click context menu for copying row as JSON
  - Each screenshot preceded by brief descriptive sentence (Opening files, Column statistics, Context menu)
  - Removed duplicate screenshots from Additional features section
  - Simplified feature descriptions to text-only format

### Fixed

- **Info Icon Color**: Corrected hover state styling for column info icon
  - Changed from `var(--jp-ui-font-color3)` (muted gray) to `var(--jp-brand-color1)` (accent color) when hovering over header cell
  - Icon now consistently uses brand color for both header hover and icon hover states
  - Updated style/base.css line 286 with proper color variable

<!-- <END NEW CHANGELOG ENTRY> -->
