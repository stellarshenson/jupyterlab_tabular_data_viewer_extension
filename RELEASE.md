# Making a new release of jupyterlab_tabular_data_viewer_extension

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
