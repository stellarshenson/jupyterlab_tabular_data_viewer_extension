# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- <START NEW CHANGELOG ENTRY> -->

## [1.1.34] - 2025-11-03

### Changed

- **Visible Column Borders**: Improved table visual clarity with visible column separators
  - Changed table from `border-collapse: collapse` to `border-collapse: separate` with `border-spacing: 0`
  - This fix allows borders to render properly in sticky positioned header
  - Added `border-right: 1px solid var(--jp-border-color0)` to filter cells and header cells
  - Column separators now visible in both frozen sticky header and scrolled content
  - Used JupyterLab theme variable for brightest border color that adapts to light/dark themes

- **Darker Filter Inputs**: Changed filter input background for better visual prominence
  - Changed from `var(--jp-input-background)` to `var(--jp-layout-color0)` for darker appearance
  - Applied to both light and dark themes

### Fixed

- **Row Dividers**: Restored missing row separators in table body
  - Added `border-bottom: 1px solid var(--jp-border-color2)` to data cells
  - Required because `border-collapse: separate` needs borders on cells not rows
  - Row dividers now properly visible between all data rows

## [1.1.19] - 2025-11-03

### Added

- **Comprehensive Playwright Integration Tests**: Added end-to-end tests for all supported file types
  - Individual tests for Parquet, CSV, and Excel file opening and display
  - Sequential test that opens all three file types in one test session
  - Tests verify viewer widget presence, table container visibility, header rows, and data rows
  - Configured Jupyter server to serve from project root for test data access
  - Tests run automatically in GitHub Actions via existing integration-tests job
  - Test data files available in `data/` directory (sample_data.parquet, sample_data.csv, sample_data.xlsx)

- **Separate TSV Setting**: Added independent `enableTSV` setting for granular control
  - Split CSV and TSV into separate configuration options in schema
  - CSV files (.csv) controlled by `enableCSV` setting
  - TSV files (.tsv) controlled by `enableTSV` setting
  - Both can be enabled/disabled independently through Settings UI

### Changed

- **Enabled All File Types by Default**: Changed default settings to enable all supported formats out of the box
  - `enableExcel` default changed from false to true
  - All four formats (Parquet, Excel, CSV, TSV) now enabled by default
  - Users can still disable individual formats through Settings

- **Cleaned Console Output**: Commented out debug logging statements throughout extension
  - Removed activation confirmation message
  - Removed settings loading/changes logging
  - Removed file type registration logging
  - Removed factory registration logging
  - Removed widget creation logging
  - Removed row copy operation logging
  - Kept `console.error` for actual errors and `console.warn` for warnings
  - Cleaner console output improves user experience

### Fixed

- **Old Package Name References**: Corrected remaining references to old package names
  - Fixed server config file referencing `jupyterlab_parquet_viewer_extension`
  - Updated test spec files with correct extension name
  - Fixed ui-tests package.json name and description
  - Updated template config in jupyter-config directory
  - Corrected .gitignore references (was pointing to `jupyterlab_basic_parquet_viewer_extension`)
  - Removed .ipynb_checkpoints directory with outdated files

## [1.1.18] - 2025-11-02

### Added

- **CSV and TSV File Support**: Implemented comprehensive support for comma-separated and tab-separated value files
  - Added CSV (.csv) file type registration with text-based document handling
  - Added TSV (.tsv) file type registration with tab delimiter support
  - Created `read_csv_as_arrow_table()` function in backend with pandas CSV reader
  - Implemented automatic encoding detection (UTF-8 with fallback to latin1)
  - Updated `get_file_type()` to recognize CSV and TSV extensions
  - Added separate text factory for CSV/TSV files (uses `modelName: 'text'`)
  - All existing features work seamlessly with CSV/TSV: progressive loading, filtering, sorting, column resizing, context menu
  - Added `enableCSV` setting to control CSV/TSV file handling (enabled by default)
  - Updated schema with CSV/TSV configuration option

### Changed

- Updated frontend to create separate factories for binary files (Parquet, Excel) and text files (CSV, TSV)
- Updated metadata and data handlers to support CSV and TSV file formats
- Updated package.json description and keywords to include CSV and TSV
- Updated README.md to document CSV and TSV support in supported file formats section
- Updated schema description to include CSV and TSV files

## [1.1.17] - 2025-11-02

### Changed

- **Project Rename**: Renamed entire project from `jupyterlab_parquet_viewer_extension` to `jupyterlab_tabular_data_viewer_extension` to reflect broader tabular data support beyond Parquet files
- Updated Python package directory structure and all module references
- Updated TypeScript plugin ID to `jupyterlab_tabular_data_viewer_extension:plugin`
- Updated command IDs from `parquet-viewer:*` to `tabular-data-viewer:*`
- Renamed all CSS classes from `.jp-ParquetViewer-*` to `.jp-TabularDataViewer-*`
- Updated all API endpoint URLs from `/jupyterlab-parquet-viewer-extension/` to `/jupyterlab-tabular-data-viewer-extension/`
- Updated package names in package.json, pyproject.toml, install.json, and schema files
- Updated repository URLs across all configuration and workflow files
- Updated all GitHub workflow files with new extension name
- Updated documentation (README.md, CLAUDE.md, RELEASE.md) with new project name

## [1.1.14] - 2025-11-02

### Added

- **Column Resizing**: Implemented drag-to-resize functionality for table columns
  - Added invisible resize handles at column borders (24px wide for easy grabbing)
  - Implemented minimum column width constraint (80px)
  - Added persistent column width storage across data refreshes
  - Added visual col-resize cursor during drag operations
  - Added cleanup of resize listeners in dispose() method

### Changed

- Changed table layout from `width: 100%` to `table-layout: fixed` with explicit column widths (default 200px)
- Updated table width calculation to sum of all column widths preventing unintended column width changes

### Fixed

- **Status Bar Scrolling**: Fixed horizontal scrolling issue with status bar
  - Moved status bar outside scrollable table container
  - Changed DOM structure from nested to sibling layout (widget containing both tableContainer and statusBar)
  - Changed status bar CSS from `position: sticky` to `flex-shrink: 0`
  - Status bar now remains fixed at bottom while only table scrolls horizontally

## [1.0.26] - 2025-11-02

### Added

- **Excel File Support**: Implemented backend handling for Excel (.xlsx, .xls) files
  - Added pandas and openpyxl dependencies to pyproject.toml
  - Created `get_file_type()` helper function detecting file type by extension
  - Implemented `read_excel_as_arrow_table()` function using pandas read_excel with first worksheet only
  - All existing features (progressive loading, filtering, sorting, context menu) now work seamlessly with Excel files
  - Updated ParquetMetadataHandler and ParquetDataHandler to support Excel format
  - Added `excel` and `tabular-data` keywords to package.json

### Changed

- Updated project keywords to include `parquet`, `excel`, and `tabular-data`
- Modified metadata and data handlers to auto-detect file format and process accordingly

## [1.0.11] - 2025-11-02

### Fixed

- **Context Menu Dismissal**: Implemented MutationObserver pattern for reliable context menu cleanup
  - Added MutationObserver to watch document.body for childList mutations
  - Automatically detects when Lumino menu elements (.lm-Menu or .p-Menu) are removed from DOM
  - Triggers `removeHighlight()` cleanup function automatically
  - Handles all menu dismissal scenarios (ESC key, clicking away, command execution)
  - Added `_menuObserver` property with proper cleanup in `dispose()` method
  - Observer starts on contextmenu event and disconnects when highlight is cleared

## [1.0.7] - 2025-11-02

### Added

- **Context Menu**: Implemented right-click context menu for copying row data as JSON
  - Added command registry integration - registered `parquet-viewer:copy-row-json` command
  - Implemented context menu item with selector `.jp-ParquetViewer-row` at rank 10
  - Added contextmenu event listener to table rows
  - Implemented JSON copy using `navigator.clipboard.writeText()` with 2-space indentation
  - Added `getCleanupHighlight()` method for external cleanup trigger

### Added (Persistent Highlighting)

- **Row Highlighting**: Maintained hover highlighting during context menu display
  - Added `jp-ParquetViewer-row-context-active` class to maintain hover-style highlighting
  - Added `jp-ParquetViewer-context-menu-open` class to tbody to disable hover on other rows
  - Updated CSS hover selector to only enable when tbody does NOT have context-menu-open class using `:not()` pseudo-class
  - Prevents double highlighting when hovering over other rows while menu is displayed
  - Provides clear visual indication of which row the context menu applies to

## [1.0.0] - 2025-11-02

### Fixed

- **Status Bar Row Count**: Corrected status bar to display unfiltered row count independent of active filters
  - Added `_unfilteredTotalRows` state variable to track original file row count
  - Updated `_loadMetadata()` to set both `_totalRows` and `_unfilteredTotalRows` on initial load
  - Modified `_updateStatusBar()` left side to always display `_unfilteredTotalRows` showing true file statistics
  - Right side continues to show `_totalRows` for filtered result count
  - File statistics (columns, rows, size) now remain constant while filtered view count updates dynamically

<!-- <END NEW CHANGELOG ENTRY> -->
