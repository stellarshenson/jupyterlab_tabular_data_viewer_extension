# jupyterlab_basic_parquet_viewer_extension

[![Github Actions Status](https://github.com/stellarshenson/jupyterlab_parquet_viewer_extension.git/workflows/Build/badge.svg)](https://github.com/stellarshenson/jupyterlab_parquet_viewer_extension.git/actions/workflows/build.yml)

This JupyterLab extension enables interactive browsing of Parquet files directly within your notebook environment with basic data filtering capabilities. Working with columnar data formats like Parquet often requires switching between multiple tools or writing custom code just to preview file contents. This extension eliminates that friction by providing a native viewer integrated into JupyterLab's interface.

The implementation uses a dual-component architecture where a TypeScript frontend extension handles the user interface while a Python server extension manages file access and data operations. This separation allows the extension to leverage JupyterLab's security model while maintaining responsive performance for large datasets.

## Features

The viewer addresses the challenge of working with large Parquet files by implementing progressive data loading. When you open a Parquet file, the extension initially loads and displays the first 500 rows, then automatically fetches additional data as you scroll through the dataset. This approach ensures responsive interaction even with files containing millions of records, as only the visible portion of data resides in browser memory at any given time.

The interface design takes inspiration from VS Code's Parquet Viewer while following JupyterLab's visual patterns, particularly mirroring the existing CSV viewer's familiar layout. Column headers display both the field name and its datatype, providing immediate context about the data structure. The extension automatically sizes columns based on header width and content, optimizing readability without manual adjustment.

**Data filtering** provides quick dataset exploration without writing code. Above each column header, an input box accepts filter criteria appropriate to the column's datatype. Text columns support substring matching (case-sensitive search within field values), while numerical columns accept comparison operators: `>`, `<`, `>=`, `<=`, and `=`. Multiple filters work together, displaying only rows that satisfy all specified conditions. This filtering happens server-side to maintain performance with large datasets.

**Core capabilities:**
- Progressive loading starting at 500 rows, expanding automatically on scroll
- Column headers showing field names with datatype indicators
- Per-column filtering with text substring and numerical comparison operators
- Automatic column width optimization for headers and content
- Read-only interface focused on data exploration
- Responsive performance through server-side processing

## Installation

The extension requires JupyterLab 4.0.0 or higher. Install using pip, which handles both the frontend and server components automatically:

```bash
pip install jupyterlab_basic_parquet_viewer_extension
```

To remove the extension later, use standard pip uninstall:

```bash
pip uninstall jupyterlab_basic_parquet_viewer_extension
```

## Troubleshooting

JupyterLab extensions consist of two parts that must both be active. If the extension appears in your interface but doesn't function correctly, verify the server component is enabled:

```bash
jupyter server extension list
```

If you don't see the extension interface at all despite successful installation, check that the frontend component is registered:

```bash
jupyter labextension list
```

Both commands should show `jupyterlab_basic_parquet_viewer_extension` as enabled. If either component is missing or disabled, reinstalling typically resolves the issue.

## Development Setup

Contributing to this extension requires NodeJS for building the TypeScript frontend. The project uses `jlpm`, which is JupyterLab's pinned version of yarn that ships with JupyterLab. You can substitute `yarn` or `npm` if you prefer, though `jlpm` ensures version consistency with JupyterLab's build system.

Setting up a development environment involves installing the Python package in editable mode, then linking both the frontend and server components to your JupyterLab installation. Create a virtual environment first to isolate dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
pip install --editable ".[dev,test]"
```

Next, establish the development links. The frontend requires explicit linking because JupyterLab needs to know where to find your working source code, while the server extension must be manually enabled since development mode doesn't activate it automatically:

```bash
jupyter labextension develop . --overwrite
jupyter server extension enable jupyterlab_basic_parquet_viewer_extension
```

After making changes to TypeScript source files, rebuild the extension with `jlpm build`. This step is required after every code change, unlike the setup commands above which run only once.

**Active development workflow:**

The most efficient development approach uses two terminal windows. Run `jlpm watch` in one terminal to automatically rebuild on file changes, and `jupyter lab` in another to run your development instance. Every saved change triggers a rebuild within a few seconds. Refresh your browser to see updates in JupyterLab.

The build process generates source maps by default, enabling browser DevTools debugging. To extend source map coverage to JupyterLab core extensions for deeper debugging, build JupyterLab with minimization disabled:

```bash
jupyter lab build --minimize=False
```

**Removing development installations:**

Development mode creates symlinks that persist after uninstalling the Python package. First disable and uninstall the extension components:

```bash
jupyter server extension disable jupyterlab_basic_parquet_viewer_extension
pip uninstall jupyterlab_basic_parquet_viewer_extension
```

Then locate and remove the frontend symlink. Run `jupyter labextension list` to find your `labextensions` directory, then delete the `jupyterlab_basic_parquet_viewer_extension` symlink within it.

## Testing

The extension employs a three-tier testing strategy covering Python backend code, TypeScript frontend code, and full user interaction workflows. This comprehensive approach ensures reliability across both architectural components and their integration.

**Python backend tests** use pytest to validate server extension functionality including API endpoints and data operations. Install test dependencies once, then run the test suite with coverage reporting:

```bash
pip install -e ".[test]"
jupyter labextension develop . --overwrite
pytest -vv -r ap --cov jupyterlab_basic_parquet_viewer_extension
```

Note that reinstalling the Python package requires re-linking the frontend extension, hence the second command above.

**TypeScript frontend tests** leverage Jest for unit testing UI components and client-side logic. Execute the frontend test suite after installing dependencies:

```bash
jlpm
jlpm test
```

**Integration tests** validate complete user workflows using Playwright with the Galata helper library designed specifically for testing JupyterLab extensions. These tests simulate real user interactions in a browser environment, verifying that frontend and backend components work together correctly. Detailed instructions for running, debugging, and creating integration tests are available in the [ui-tests README](./ui-tests/README.md).

## Packaging and Release

See [RELEASE.md](RELEASE.md) for instructions on building distributable packages and publishing releases.
