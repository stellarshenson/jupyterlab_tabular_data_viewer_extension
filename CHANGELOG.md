# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- <START NEW CHANGELOG ENTRY> -->

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
