# jupyterlab_tabular_data_viewer_extension

[![GitHub Actions](https://github.com/stellarshenson/jupyterlab_tabular_data_viewer_extension/actions/workflows/build.yml/badge.svg)](https://github.com/stellarshenson/jupyterlab_tabular_data_viewer_extension/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/jupyterlab_tabular_data_viewer_extension.svg)](https://www.npmjs.com/package/jupyterlab_tabular_data_viewer_extension)
[![PyPI version](https://img.shields.io/pypi/v/jupyterlab-tabular-data-viewer-extension.svg)](https://pypi.org/project/jupyterlab-tabular-data-viewer-extension/)
[![Total PyPI downloads](https://static.pepy.tech/badge/jupyterlab-tabular-data-viewer-extension)](https://pepy.tech/project/jupyterlab-tabular-data-viewer-extension)
[![JupyterLab 4](https://img.shields.io/badge/JupyterLab-4-orange.svg)](https://jupyterlab.readthedocs.io/en/stable/)

View and browse Parquet, Excel, CSV, and TSV files directly in JupyterLab. Double-click any .parquet, .xlsx, .csv, or .tsv file to open it in a simple, spreadsheet-like table view - no code required. Navigate through your data, inspect values, and explore the structure of your tabular data files with interactive column resizing and advanced filtering capabilities.

![Parquet Viewer](.resources/screenshot.png)

**Opening files:** Right-click any supported file and select "Tabular Data Viewer" from the "Open With" menu, or simply double-click to open with the default viewer.

![Open With Menu](.resources/screenshot-menu.png)

**Column statistics:** Hover over any column header to reveal an info icon, click it to view comprehensive statistics.

![Column Statistics Icon](.resources/screenshot-stats-icon.png)

![Column Statistics Modal](.resources/screenshot-stats.png)

**Context menu:** Right-click any row to copy data as JSON.

![Copy Row as JSON](.resources/screenshot-copy-json.png)

## Features

**Supported File Formats:**
- **Parquet files** (.parquet) - Full support with efficient columnar data reading
- **Excel files** (.xlsx) - Reads first worksheet only. Excel files must be simple tabular data without merged cells, complex formulas, or advanced formatting. Files with these features may not display correctly or fail to load
- **CSV files** (.csv) - Comma-separated values with UTF-8 encoding (fallback to latin1)
- **TSV files** (.tsv) - Tab-separated values with UTF-8 encoding (fallback to latin1)

**Core viewing and navigation:**
- Simple table display showing your data in familiar spreadsheet format
- Column headers with field names and simplified datatype indicators
- Interactive column resizing - drag column borders to adjust width independently
- Progressive loading - starts with 500 rows, automatically loads more as you scroll
- File statistics (column count, row count, file size) at a glance
- Fixed status bar remains visible during horizontal scrolling
- Handles large files efficiently with server-side processing

**Advanced filtering and sorting:**
- Column sorting with three-state toggle (ascending, descending, off)
- Per-column filtering with substring or regex pattern matching
- Case-insensitive search option
- Numerical filters supporting comparison operators (`>`, `<`, `>=`, `<=`, `=`)
- Clear filters functionality to reset all active filters
- Multiple filters work together to narrow down results

**Additional features:**
- Column statistics modal - View comprehensive statistics including data type, row counts, null values, unique counts, and type-specific metrics (numeric: min/max/mean/median/std dev/outliers; string: most common value/length stats; date: earliest/latest dates). Copy statistics as JSON with one click
- Right-click context menu on rows to copy data as JSON
- Configurable file type support via Settings - Enable/disable Parquet, Excel, or CSV/TSV handling
- All features work seamlessly across all supported file formats

## Installation

Requires JupyterLab 4.0.0 or higher.

```bash
pip install jupyterlab_tabular_data_viewer_extension
```

Uninstall:
```bash
pip uninstall jupyterlab_tabular_data_viewer_extension
```

## Configuration

Configure file type support through JupyterLab Settings:

1. Open **Settings → Settings Editor**
2. Search for "Tabular Data Viewer Extension"
3. Configure options:
   - **Enable Parquet files** - Default: enabled
   - **Enable Excel files** - Default: enabled
   - **Enable CSV files** - Default: enabled
   - **Enable TSV files** - Default: enabled

When a file type is disabled, files open with JupyterLab's default handler instead.

## Troubleshooting

Verify both extension components are enabled if the extension doesn't work:

```bash
# Check server extension
jupyter server extension list

# Check frontend extension
jupyter labextension list
```

Both commands should show `jupyterlab_tabular_data_viewer_extension` as enabled. Reinstall if either is missing or disabled.

## Development Setup

Requires NodeJS for building TypeScript frontend. Uses `jlpm` (JupyterLab's pinned yarn version) for consistency.

**Initial setup:**

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install in editable mode
pip install --editable ".[dev,test]"

# Link frontend and enable server extension
jupyter labextension develop . --overwrite
jupyter server extension enable jupyterlab_tabular_data_viewer_extension
```

**Development workflow:**

Use two terminals for efficient development:
- Terminal 1: `jlpm watch` (auto-rebuild on file changes)
- Terminal 2: `jupyter lab` (run development instance)

Refresh browser after changes to see updates. Build generates source maps for debugging.

Enable deeper debugging with unminimized JupyterLab build:
```bash
jupyter lab build --minimize=False
```

**Removing development installation:**

```bash
jupyter server extension disable jupyterlab_tabular_data_viewer_extension
pip uninstall jupyterlab_tabular_data_viewer_extension
```

Then delete the `jupyterlab_tabular_data_viewer_extension` symlink from your `labextensions` directory (find with `jupyter labextension list`).

## Testing

Three-tier testing strategy: Python backend, TypeScript frontend, and integration tests.

**Python tests** (pytest with coverage):
```bash
pip install -e ".[test]"
jupyter labextension develop . --overwrite
pytest -vv -r ap --cov jupyterlab_tabular_data_viewer_extension
```

**TypeScript tests** (Jest):
```bash
jlpm
jlpm test
```

**Integration tests** (Playwright + Galata):
Simulates real user interactions to validate complete workflows. See [ui-tests README](./ui-tests/README.md) for detailed instructions.

## Packaging and Release

See [RELEASE.md](RELEASE.md) for instructions on building distributable packages and publishing releases.
