# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- <START NEW CHANGELOG ENTRY> -->

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
