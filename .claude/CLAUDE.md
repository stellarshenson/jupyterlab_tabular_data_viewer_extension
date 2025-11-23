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

## Git Push and Tag Policy

**MANDATORY**: NEVER push to remote repository or create git tags without explicit user permission.

**Push Rules**:

- DO NOT run `git push` automatically after commits
- DO NOT push after builds or any other operations
- ONLY push when user explicitly requests: "push", "push to remote", or similar
- Commits should be made locally and await user approval before pushing

**Tagging Rules**:

- DO NOT create tags (RELEASE*\*, STABLE*\*, or any other tags) automatically
- DO NOT tag after commits, builds, or any other operations
- ONLY create tags when user explicitly requests: "tag as RELEASE_X.X.X" or similar
- If user says "commit", do NOT push or tag unless explicitly requested
- If user says "commit and push", do NOT tag unless explicitly requested

**Why**: Push and tag operations affect remote repository and mark important milestones. These should only occur when user explicitly approves each action.

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

## Build Instructions

**MANDATORY**: ALWAYS use `make` for building the extension.

**Build Commands**:

- Use `make` or `make build` to build the extension
- DO NOT use `jlpm build` directly
- DO NOT use `npm run build` or other build commands

**Why**: The Makefile ensures proper build sequence and handles all necessary build steps consistently. Direct use of jlpm build may skip important build steps or version synchronization.
