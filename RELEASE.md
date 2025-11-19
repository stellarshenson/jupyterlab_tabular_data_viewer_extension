# Making a new release of jupyterlab_tabular_data_viewer_extension

## What's New in Version 1.4.4

Version 1.4.4 delivers major UX improvements with frozen index column for horizontal scrolling, interactive row selection, and automatic filter clearing.

### Frozen Index Column (1.4.4)

Row number column stays fixed when scrolling horizontally, keeping row references always visible for wide datasets.

**Features:**

- **Sticky positioning** - row number column remains visible at left edge during horizontal scroll
- **Proper z-index layering** - row numbers appear above regular cells (z-index: 5) and header row numbers above sticky header (z-index: 15)
- **Visual depth** - subtle box-shadow (2px 0 4px rgba(0, 0, 0, 0.1)) on right edge creates depth effect during scrolling
- **Always visible** - improves navigation by keeping row numbers in view when browsing wide tables

**Implementation:**

- CSS-only solution using `position: sticky` and `left: 0` on `.jp-TabularDataViewer-rowNumberCell`
- Separate z-index rules for tbody cells (5) and thead cells (15) for proper stacking context
- No JavaScript changes required - pure CSS solution for optimal performance

### Row Selection (1.4.4)

Click anywhere on a row to highlight it with subtle color shading, improving data inspection workflow.

**Features:**

- **Click anywhere** - clicking any cell in row selects/highlights entire row
- **Toggle selection** - clicking same row again deselects/unhighlights the row
- **Switch selection** - clicking different row switches highlight to new row
- **Visual feedback** - pointer cursor across entire row indicates clickability
- **Subtle highlighting** - selected rows use transparent brand color overlay (10% opacity) for cells
- **Opaque index cell** - row number cell uses darker opaque shading (20% brand color mixed with background)
- **Automatic cleanup** - selection clears when data refreshes or errors occur

**Implementation:**

- Click handler on entire row element (not just index cell)
- Uses CSS `color-mix()` for sophisticated color blending
- Selected cells: `color-mix(in srgb, var(--jp-brand-color1) 10%, transparent)`
- Selected index cell: `color-mix(in srgb, var(--jp-brand-color1) 20%, var(--jp-layout-color2))`
- Added `_selectedRow` private property to track selection state

### Auto-clear Filter Fix (1.4.4)

Filters now automatically clear when input field is emptied, without requiring Enter key press.

**Problem Solved:**

- Previously filters only applied/cleared when user pressed Enter
- Clearing filter text without pressing Enter left filter active
- Filter box appeared empty but data remained filtered
- Confusing UX requiring explicit Enter press to clear

**Solution:**

- Added `input` event listener to filter input fields
- Detects when field is emptied and filter is still active
- Automatically removes filter from internal state
- Clears filter button active state for multi-select filters
- Reloads data without the filter immediately
- More intuitive and immediate filter clearing behavior

**Technical Details:**

- base.css:style/base.css lines 242-275 - frozen index column and row selection styling
- widget.ts:src/widget.ts lines 401-414 - auto-clear filter input listener
- widget.ts:src/widget.ts lines 568-586 - row selection click handler

## What's New in Version 1.3.32

Version 1.3.32 adds interactive row selection functionality via index column clicks, providing visual feedback for data inspection.

### Row Selection via Index Column Click (1.3.32)

Click row number cells to highlight entire rows, improving data inspection and navigation workflow.

**Features:**

- **Click to select** - clicking row number cell highlights entire row with brand color background
- **Toggle selection** - clicking same row number again deselects/unhighlights the row
- **Switch selection** - clicking different row number switches highlight to new row
- **Visual feedback** - pointer cursor and hover effect indicate row numbers are clickable
- **Automatic cleanup** - selection clears when data refreshes or errors occur

**User Experience:**

- Row number cells show pointer cursor on hover, signaling interactivity
- Hover effect (lighter background) provides additional visual feedback before clicking
- Selected rows use JupyterLab's brand color (`var(--jp-brand-color3)`) for consistent theming
- Selection state persists while scrolling and filtering until explicitly changed
- Clear visual indication of which row is currently selected for reference

**Implementation:**

- Added `_selectedRow` private property to track currently selected row element
- Click event listener on row number cells manages selection state
- Adds/removes `jp-TabularDataViewer-row-selected` CSS class
- Selection cleared in `loadData` (when reset=true) and `_showError` methods
- CSS uses `!important` to override default cell backgrounds for selected rows

**Technical Details:**

- widget.ts:src/widget.ts lines 66, 547-564 - selection state management and click handler
- widget.ts:src/widget.ts lines 318, 1073 - selection cleanup on data reset/error
- base.css:style/base.css lines 256, 260-271 - cursor pointer, hover, and selection styling

## What's New in Version 1.3.31

Version 1.3.31 adds frozen index column functionality, keeping row numbers visible when scrolling horizontally through wide datasets.

### Frozen Index Column (1.3.31)

Row number column now stays fixed in position when scrolling horizontally, improving navigation and usability for wide datasets.

**Features:**

- **Sticky positioning** - row number column remains visible at left edge during horizontal scroll
- **Proper z-index layering** - row numbers appear above regular cells (z-index: 5) and header row numbers appear above sticky header (z-index: 15)
- **Visual depth** - subtle box-shadow (2px 0 4px rgba(0, 0, 0, 0.1)) on right edge creates depth effect during scrolling
- **Corner case handling** - sticky positioning works correctly in both data rows and header rows

**Implementation:**

- CSS-only solution using `position: sticky` and `left: 0` on `.jp-TabularDataViewer-rowNumberCell`
- Separate z-index rules for tbody cells (5) and thead cells (15) for proper stacking context
- Box-shadow provides subtle visual separation between frozen and scrolling content

**Benefits:**

- Always visible row numbers make it easier to reference specific rows while browsing wide tables
- No JavaScript changes required - pure CSS solution for optimal performance
- Works seamlessly with existing sticky header functionality
- Improves user experience when working with datasets containing many columns

**Technical Details:**

- base.css:style/base.css lines 242-250 - sticky positioning and z-index configuration

## What's New in Version 1.3.30

Version 1.3.30 delivers major UI/UX enhancements with responsive typography system, enhanced statistics modal with unique values display, and comprehensive font scaling integration with JupyterLab settings.

### Responsive Typography System (1.3.30)

All UI fonts now use JupyterLab CSS variables for automatic scaling with user's font size preferences.

**Font Sizing:**

- **Column names**: `calc(var(--jp-ui-font-size1) * 1.10)` - 10% larger than standard UI font
- **Column types**: `var(--jp-ui-font-size1)` - standard UI font size
- **Table cells**: `var(--jp-ui-font-size1)` - consistent cell text sizing
- **Row numbers**: `var(--jp-ui-font-size1)` - matches cell font size

**Benefits:**

- Fonts automatically scale when user changes JupyterLab's UI font size settings
- Consistent typography hierarchy across all viewer components
- Better accessibility for users requiring larger fonts
- Seamless integration with JupyterLab's design system

### Enhanced Statistics Modal - Unique Values (1.3.30)

Statistics modal now displays comprehensive unique value information sorted by frequency.

**Features:**

- **Scrollable unique values list** - sorted by frequency (most common first)
- **Count and percentage display** - shows both absolute count and percentage of total rows for each unique value
- **Bullet point styling** - matches other statistics sections for visual consistency
- **Smart info messages** - only appears when values are limited: "Showing X of Y unique values"
- **Configurable limit** - controlled by new `maxUniqueValues` setting (default: 100)

**Backend Implementation:**

- Uses PyArrow's `value_counts()` for efficient computation
- Sorts unique values by count in descending order (most frequent first)
- Accepts `limit` parameter from frontend
- Returns both values and counts for display

**Technical Details:**

- modal.ts:src/modal.ts - unique values displayed as `<ul>` with bullet points
- routes.py:jupyterlab_tabular_data_viewer_extension/routes.py - frequency-based sorting with tuple pairs
- base.css:style/base.css - scrollable list with 300px max-height

### Settings Enhancements (1.3.30)

New settings and visual improvements for better discoverability and control.

**New Settings:**

- **Maximum Unique Values** (`maxUniqueValues`) - Default: 100
  - Controls unique value display limits in both filter dialog and statistics modal
  - Set to 0 for unlimited display
  - Accessible via Settings → Settings Editor → Tabular Data Viewer Extension

**Visual Improvements:**

- **Settings panel icon** - Extension now displays spreadsheet icon using `ui-components:spreadsheet`
- **Statistics icon** - Restored Font Awesome info icon (`fas fa-info-circle`) for column statistics
- Better visibility in JupyterLab Settings panel

**Technical Implementation:**

- schema/plugin.json:schema/plugin.json - maxUniqueValues property with validation
- index.ts:src/index.ts - ISettings interface updated
- widget.ts:src/widget.ts - maxUniqueValues passed to API calls

### Documentation (1.3.30)

- Added humorous disclaimer acknowledging extension as shameless ripoff of typical tabular data browsing tools
- Updated README configuration section with maxUniqueValues setting

## What's New in Version 1.3.14

Version 1.3.14 adds comprehensive backend testing infrastructure and CI/CD integration to ensure code quality and reliability.

### Backend Test Suite (1.3.14)

Comprehensive pytest test suite validates all backend API endpoints with automated execution in CI/CD pipeline.

**Tests:**

- **test_metadata_endpoint** - validates metadata fetching returns correct column names, types, and row count
- **test_unique_values_endpoint** - validates unique values with counts functionality, ensures proper string casting and null handling
- **test_data_endpoint_with_filter** - validates regex filtering on numeric columns, ensures type casting works correctly
- **test_first_row_content** - validates specific data content matches expected values

**Features:**

- All tests use test data file with 13 rows of email classification data
- Tests copy data to pytest temporary directory for proper isolation
- Validates filtering on null values and empty strings
- Ensures numeric column filtering works with string casting

### CI/CD Integration (1.3.14)

Python tests now run automatically in GitHub Actions workflow on every push and pull request.

**Features:**

- Added pytest execution step to build.yml workflow
- Installs test dependencies from pyproject.toml [test] extras
- Runs all backend tests with verbose output
- Ensures code quality before merging changes

### Project Infrastructure (1.3.14)

Improved project organization and documentation tracking.

**Changes:**

- Merged duplicate JOURNAL.md files into single .claude/JOURNAL.md
- All 49 journal entries properly numbered and tracked in git
- Removed .claude from .gitignore to enable version control
- Code formatted with Prettier (TypeScript/JavaScript) and Black (Python)
- Fixed Refresh View integration to use signal-based approach

## What's New in Version 1.3

Version 1.3 introduces significant improvements to data display, user interaction, and development workflow:

### Complex Data Types Display (1.3.2)

Enhanced handling of nested and structured data types. List, tuple, and dict values now display as JSON strings in cells, making it easy to inspect complex data structures without requiring additional processing.

**Features:**

- List/tuple values automatically converted to JSON format
- Dict values displayed as readable JSON strings
- Applies to all file formats (Parquet, Excel, CSV, TSV)
- Improves data exploration for files with nested structures

### Cell Text Truncation (1.3.0)

Configurable maximum character limit for cell display prevents overwhelming the interface with extremely long text values.

**Features:**

- Default: 100 characters with "..." ellipsis for longer text
- Set to 0 for unlimited display
- Visual truncation only - original data unchanged
- Configurable via Settings Editor

### Refresh View Integration (1.3.0)

Unified refresh command that works seamlessly with JupyterLab's refresh view extension. Right-click on viewer and select "Refresh View" to reload data from file while preserving scroll position, filters, and sorting.

**Features:**

- Overrides jupyterlab_refresh_view:refresh for tabular viewers
- Falls back to original behavior for other document types
- Eliminates duplicate context menu items
- Maintains current view state during refresh

### Absolute Row Indices (1.3.0)

Row numbers display original file position even when filters or sorting are active, making it easy to identify exact row locations in source data.

---

## What's New in Version 1.2

Version 1.2 introduces significant enhancements to data exploration and navigation capabilities:

### Column Statistics Modal (1.2.8)

Interactive statistics viewer providing comprehensive column analysis with a single click. Hover over any column header to reveal an info icon, then click to view detailed statistics in a modal dialog.

**Features:**

- **Data Summary**: Total rows, non-null count/percentage, null count/percentage, unique values
- **Type-Specific Statistics**:
  - Numeric columns: min, max, mean, median, standard deviation, outlier detection
  - String columns: most common value, min/max/average string length
  - Date columns: earliest/latest dates, date range span
- **Copy to Clipboard**: Export statistics as JSON with visual confirmation
- **Keyboard Support**: Close with ESC key or backdrop click
- Supports all file types (Parquet, CSV, TSV, Excel)

### Absolute Row Indices (1.2.20)

Row numbers now display absolute position in the original file rather than position within filtered or sorted views. When filters or sorting are applied, row numbers maintain their original file position, making it easy to identify exact row locations in source data.

**Technical Implementation:**

- Backend tracks original indices through all filtering and sorting operations
- Context menu "Copy Row as JSON" automatically excludes internal metadata
- Works across all supported file formats

### Enhanced Row Number Column Styling (1.2.20)

Visual improvements to the row number column for better readability and data grid structure.

**Styling Enhancements:**

- Vertical border separating row numbers from data columns
- Horizontal borders between data rows in the row number column
- Subtle, theme-consistent border colors
- Borders apply only to data rows, maintaining clean header appearance

---

## Release Process

The extension can be published to `PyPI` and `npm` manually or using the [Jupyter Releaser](https://github.com/jupyter-server/jupyter_releaser).

## Manual release

### Python package

This extension can be distributed as Python packages. All of the Python
packaging instructions are in the `pyproject.toml` file to wrap your extension in a
Python package. Before generating a package, you first need to install some tools:

```bash
pip install build twine hatch
```

Bump the version using `hatch`. By default this will create a tag.
See the docs on [hatch-nodejs-version](https://github.com/agoose77/hatch-nodejs-version#semver) for details.

```bash
hatch version <new-version>
```

Make sure to clean up all the development files before building the package:

```bash
jlpm clean:all
```

You could also clean up the local git repository:

```bash
git clean -dfX
```

To create a Python source package (`.tar.gz`) and the binary package (`.whl`) in the `dist/` directory, do:

```bash
python -m build
```

> `python setup.py sdist bdist_wheel` is deprecated and will not work for this package.

Then to upload the package to PyPI, do:

```bash
twine upload dist/*
```

### NPM package

To publish the frontend part of the extension as a NPM package, do:

```bash
npm login
npm publish --access public
```

## Automated releases with the Jupyter Releaser

The extension repository should already be compatible with the Jupyter Releaser. But
the GitHub repository and the package managers need to be properly set up. Please
follow the instructions of the Jupyter Releaser [checklist](https://jupyter-releaser.readthedocs.io/en/latest/how_to_guides/convert_repo_from_repo.html).

Here is a summary of the steps to cut a new release:

- Go to the Actions panel
- Run the "Step 1: Prep Release" workflow
- Check the draft changelog
- Run the "Step 2: Publish Release" workflow

> [!NOTE]
> Check out the [workflow documentation](https://jupyter-releaser.readthedocs.io/en/latest/get_started/making_release_from_repo.html)
> for more information.

## Publishing to `conda-forge`

If the package is not on conda forge yet, check the documentation to learn how to add it: https://conda-forge.org/docs/maintainer/adding_pkgs.html

Otherwise a bot should pick up the new version publish to PyPI, and open a new PR on the feedstock repository automatically.
