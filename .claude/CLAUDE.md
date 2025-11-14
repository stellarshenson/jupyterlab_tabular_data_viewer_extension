<!-- Import workspace-level CLAUDE.md configuration -->
<!-- See /home/lab/workspace/.claude/CLAUDE.md for complete rules -->

# Project-Specific Configuration

This file extends workspace-level configuration with project-specific rules.

## Version Management

**MANDATORY**: Before any journal edits or commits, ALWAYS verify the current version in package.json matches the work being documented.

**Version Check Protocol**:

1. Before updating `.claude/JOURNAL.md`, read `package.json` to confirm current version
2. Ensure CHANGELOG.md entries reference the correct version number
3. When committing changes, verify package.json version is correct
4. If version is incorrect, update it before committing

**Why**: Prevents version mismatch between code changes, journal entries, changelog, and git commits.

## Git Tagging Policy

**MANDATORY**: NEVER create git tags without explicit user permission.

**Tagging Rules**:

- DO NOT create tags (RELEASE*\*, STABLE*\*, or any other tags) automatically
- DO NOT tag after commits, builds, or any other operations
- ONLY create tags when user explicitly requests: "tag as RELEASE_X.X.X" or similar
- If user says "commit and push", do NOT tag unless explicitly requested

**Why**: Tags mark important milestones and should only be created when user explicitly approves.

## Project Context

**Technology Stack**:

- JupyterLab 4.x extension framework
- TypeScript/JavaScript (frontend)
- Python (backend API with Flask)
- PyArrow for data processing (Parquet, CSV, Excel, TSV)
- Lumino widgets framework
- Font Awesome icons

**Key Components**:

- `src/widget.ts` - Main TabularDataViewer widget
- `src/index.ts` - Plugin registration and commands
- `jupyterlab_tabular_data_viewer_extension/routes.py` - Backend API routes
- `style/base.css` - Component styling

**Build System**:

- Makefile for build automation
- jlpm (yarn) for package management
- hatch for Python packaging
- Version managed via hatch-nodejs-version (syncs from package.json)
