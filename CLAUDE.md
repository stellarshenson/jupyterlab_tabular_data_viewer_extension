# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a JupyterLab extension for browsing Parquet files with basic data filtering capabilities. It consists of:
- **Frontend extension**: TypeScript/React component using JupyterLab 4.x APIs
- **Server extension**: Python backend using Jupyter Server for API endpoints

The extension follows the standard JupyterLab extension template (v4.5.0 from jupyterlab/extension-template).

## Architecture

### Frontend (TypeScript)
- Entry point: `src/index.ts` - defines the JupyterLab plugin
- API communication: `src/request.ts` - handles requests to server extension
- Plugin ID: `jupyterlab_basic_parquet_viewer_extension:plugin`

### Backend (Python)
- Entry point: `jupyterlab_basic_parquet_viewer_extension/__init__.py` - registers server extension
- API routes: `jupyterlab_basic_parquet_viewer_extension/routes.py` - defines HTTP endpoints
- Base URL pattern: `/jupyterlab-basic-parquet-viewer-extension/<endpoint>`

## Development Setup

### Initial Installation

```bash
# Set up virtual environment
python -m venv .venv
source .venv/bin/activate

# Install package in development mode
pip install --editable ".[dev,test]"

# Link development version with JupyterLab
jupyter labextension develop . --overwrite

# Enable server extension
jupyter server extension enable jupyterlab_basic_parquet_viewer_extension
```

### Development Workflow

```bash
# Build TypeScript after changes
jlpm build

# Or watch for automatic rebuilds
jlpm watch

# Run JupyterLab (in separate terminal)
jupyter lab
```

After changes, refresh JupyterLab in browser to see updates.

## Testing

### Python Tests
```bash
# Install test dependencies (once)
pip install -e ".[test]"

# Run Python tests with coverage
pytest -vv -r ap --cov jupyterlab_basic_parquet_viewer_extension
```

### TypeScript Tests
```bash
# Install dependencies (once)
jlpm

# Run Jest tests
jlpm test
```

### Integration Tests (Playwright)
```bash
# Build extension for production
jlpm install
jlpm build:prod

# Install test dependencies (once)
cd ui-tests
jlpm install
jlpm playwright install
cd ..

# Run integration tests
cd ui-tests
jlpm playwright test

# Debug tests
jlpm playwright test --debug

# Update snapshots
jlpm playwright test -u
```

## Build Commands

```bash
# Development build (with source maps)
jlpm build

# Production build
jlpm build:prod

# Clean build artifacts
jlpm clean:all
```

## Code Quality

```bash
# Run all linters
jlpm lint

# Check only (no fixes)
jlpm lint:check

# Individual linters
jlpm eslint        # Fix TypeScript linting issues
jlpm prettier      # Fix formatting
jlpm stylelint     # Fix CSS issues
```

## Code Style

### TypeScript
- Single quotes for strings (enforced by ESLint)
- Interfaces must be PascalCase and prefixed with `I` (e.g., `IMyInterface`)
- Arrow functions preferred over function expressions
- Strict equality (`===`) required

### Python
- Follows standard Jupyter Server extension patterns
- API handlers inherit from `APIHandler`
- Use `@tornado.web.authenticated` decorator on all HTTP verb methods

## Extension Structure

### Key Configuration Files
- `package.json`: NPM package definition, scripts, JupyterLab extension metadata
- `pyproject.toml`: Python package definition, Hatch build configuration
- `tsconfig.json`: TypeScript compiler settings
- `jest.config.js`: Jest test configuration
- `ui-tests/playwright.config.js`: Playwright test configuration

### Build Outputs
- `lib/`: Compiled TypeScript (gitignored)
- `jupyterlab_basic_parquet_viewer_extension/labextension/`: Built extension assets
- `jupyterlab_basic_parquet_viewer_extension/_version.py`: Auto-generated version file

## Adding New Features

### Adding a Frontend Component
1. Create TypeScript files in `src/`
2. Import and use in `src/index.ts`
3. Add styles to `style/*.css` if needed
4. Run `jlpm build` to compile

### Adding a Backend Endpoint
1. Add handler class in `routes.py` inheriting from `APIHandler`
2. Register route in `setup_route_handlers()`
3. Use URL pattern: `url_path_join(base_url, "jupyterlab-basic-parquet-viewer-extension", "endpoint-name")`
4. Test with `pytest`

### Frontend-Backend Communication
- Use `requestAPI()` from `src/request.ts` to call backend endpoints
- Endpoints are automatically prefixed with `/jupyterlab-basic-parquet-viewer-extension/`
- Example: `requestAPI<any>('hello')` calls `/jupyterlab-basic-parquet-viewer-extension/hello`

## Verification Commands

```bash
# Check server extension is enabled
jupyter server extension list

# Check frontend extension is installed
jupyter labextension list

# Verify extension is working
# Look for console message: "JupyterLab extension jupyterlab_basic_parquet_viewer_extension is activated!"
```

## Troubleshooting Development Mode

If extension isn't working after development install:
1. Verify server extension: `jupyter server extension list`
2. Verify frontend extension: `jupyter labextension list`
3. Check for symlink in labextensions folder (find with `jupyter labextension list`)
4. Re-run `jupyter labextension develop . --overwrite` if needed
5. Restart JupyterLab and hard refresh browser

## Publishing

See RELEASE.md for packaging and publishing instructions.
