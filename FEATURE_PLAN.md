# Feature Plan: Column Statistics Modal

## Overview

Implement interactive column statistics feature that displays pandas-style information when users click an info icon on column headers. Users can hover over any column header to reveal an info icon, then click to open a modal dialog showing comprehensive statistics about that column's data.

## Feature Specifications

### User Interaction Flow

1. **Hover state**: When mouse hovers over column header, small info icon (ℹ️) appears next to column name
2. **Click trigger**: Clicking info icon opens modal dialog overlay
3. **Statistics display**: Modal shows column name, data type, and relevant statistics in organized sections
4. **Dismiss**: User can close modal by clicking outside, pressing ESC, or clicking close button

### Statistics Content

**All column types:**
- Column name
- Data type (simplified display: int, float, string, date, datetime, boolean)
- Total row count
- Non-null count and percentage
- Null count and percentage
- Unique value count and percentage

**Numeric columns only (int, float):**
- Minimum value
- Maximum value
- Mean (average)
- Median (50th percentile)
- Standard deviation

**String columns additional:**
- Most common value (mode)
- Shortest string length
- Longest string length
- Average string length

**Date/datetime columns additional:**
- Earliest date
- Latest date
- Date range span

## Technical Architecture

### Backend Implementation

**New API Endpoint:**
- Path: `/jupyterlab-tabular-data-viewer-extension/column-stats`
- Method: POST
- Parameters:
  - `file_path`: string (path to data file)
  - `column_name`: string (column to analyze)
- Returns: JSON object with statistics

**Statistics Computation (PyArrow):**

Use PyArrow compute functions for efficient statistics calculation:

```python
import pyarrow as pc

# Basic statistics (all types)
- pc.count(column)  # Total count
- pc.sum(pc.is_null(column))  # Null count
- pc.count_distinct(column)  # Unique values

# Numeric statistics
- pc.min_max(column)  # Min and max in one call
- pc.mean(column)
- pc.stddev(column)
- pc.quantile(column, q=0.5)  # Median

# String statistics
- pc.utf8_length(column)  # String lengths
- pc.mode(column)  # Most common value

# Date statistics
- pc.min(column) and pc.max(column) for date range
```

**Performance considerations:**
- Statistics computed on demand (not cached initially)
- For large files (>100k rows), consider sampling or computing on filtered view
- Use PyArrow's vectorized operations for speed

### Frontend Implementation

**Column Header Enhancement:**

1. Add info icon container to column headers:
   - Position: absolute, right side of header
   - Initially hidden (opacity: 0)
   - Appears on hover (CSS transition)
   - Z-index ensures icon stays clickable above other elements

2. Event handlers:
   - `mouseenter`/`mouseleave` on header cell: toggle icon visibility
   - `click` on info icon: prevent sort trigger, fetch stats, open modal

**Modal Dialog Component:**

Create new `ColumnStatsModal` class:
- Extends Lumino `Widget`
- Positioned as overlay (fixed positioning, centered)
- Semi-transparent backdrop (rgba(0,0,0,0.5))
- White content box with border radius and shadow
- Responsive sizing (max-width: 500px)

**Modal Content Structure:**

```
┌─────────────────────────────────────┐
│ Column: employee_name          [×]  │
├─────────────────────────────────────┤
│ Type: string                        │
│                                     │
│ Data Summary                        │
│ • Total rows: 1,500                 │
│ • Non-null: 1,498 (99.9%)           │
│ • Null: 2 (0.1%)                    │
│ • Unique values: 1,487 (99.1%)      │
│                                     │
│ String Statistics                   │
│ • Most common: "John Smith" (3)     │
│ • Min length: 5 characters          │
│ • Max length: 42 characters         │
│ • Avg length: 18 characters         │
└─────────────────────────────────────┘
```

**Styling:**
- Use JupyterLab theme variables for colors
- Match existing viewer styling (consistent fonts, spacing)
- Info icon: subtle gray by default, brand color on hover
- Loading state: spinner while fetching statistics
- Error state: friendly message if stats fail to load

## Implementation Steps

### Phase 1: Backend Statistics Endpoint

1. **Create statistics calculation module** (`jupyterlab_tabular_data_viewer_extension/stats.py`):
   - Function `calculate_column_stats(table: pa.Table, column_name: str) -> dict`
   - Handle different data types with appropriate statistics
   - Return formatted dictionary with all statistics

2. **Add API handler** (update `routes.py`):
   - Create `ColumnStatsHandler` class extending `JupyterHandler`
   - POST handler that reads file, extracts column, calculates stats
   - Return JSON response with statistics

3. **Test backend**:
   - Unit tests for stats calculation with different data types
   - Test edge cases: all nulls, all unique, empty column, large values

### Phase 2: Frontend UI Components

1. **Add info icon to column headers** (`src/widget.ts`):
   - Modify `_renderHeaders()` to include info icon span
   - Add CSS for icon positioning and hover effects
   - Add click handler that prevents sort and calls stats fetcher

2. **Create stats fetcher** (`src/request.ts`):
   - Function `fetchColumnStats(filePath: string, columnName: string)`
   - Use existing API base path pattern
   - Handle errors gracefully

3. **Create modal component** (`src/modal.ts`):
   - New `ColumnStatsModal` class extending `Widget`
   - Constructor accepts statistics data object
   - `render()` method builds modal content from stats
   - `show()` and `hide()` methods for visibility control
   - Event handlers for backdrop click and ESC key

4. **Integrate modal with viewer** (`src/widget.ts`):
   - Store reference to current modal
   - Create modal when stats fetched
   - Attach to viewer's parent node
   - Clean up on viewer disposal

### Phase 3: Styling and Polish

1. **Add CSS** (`style/base.css`):
   - Info icon styles (size, color, transitions)
   - Modal overlay and content box
   - Loading spinner animation
   - Responsive adjustments

2. **Loading and error states**:
   - Show spinner while fetching statistics
   - Display error message if fetch fails
   - Disable info icon during active requests

3. **Accessibility**:
   - ARIA labels for info icon and modal
   - Focus trap in modal (tab cycles within)
   - ESC key closes modal
   - Focus return to icon after close

### Phase 4: Testing and Documentation

1. **Frontend tests**:
   - Test info icon appears on hover
   - Test modal opens with correct content
   - Test modal closes on backdrop/ESC
   - Test different column types show appropriate stats

2. **Integration tests**:
   - Add Playwright test for column stats workflow
   - Test with different file types (Parquet, CSV, Excel)
   - Verify statistics accuracy against known data

3. **Documentation updates**:
   - Add feature to README.md
   - Update CHANGELOG.md
   - Add screenshots showing stats modal

## Technical Considerations

### Performance Optimization

**Large datasets:**
- For files >100k rows, compute statistics on currently loaded/filtered data only
- Add note in modal: "Statistics computed on filtered/visible data (X rows)"
- Consider background computation with progress indicator for very large files

**Caching:**
- Cache statistics per column after first computation
- Invalidate cache when filters change
- Store in widget instance state

### Error Handling

**Backend errors:**
- Invalid column name: Return 400 with clear message
- File read failure: Return 500 with error details
- Statistics computation error: Return partial stats with warnings

**Frontend errors:**
- Network failure: Show "Unable to load statistics" message
- Malformed response: Log error, show generic failure message
- Timeout: Add 10-second timeout, show retry option

### Data Type Detection

**Mapping PyArrow types to display types:**
```python
TYPE_MAPPING = {
    'int8', 'int16', 'int32', 'int64': 'int',
    'uint8', 'uint16', 'uint32', 'uint64': 'int',
    'float', 'double': 'float',
    'string', 'utf8', 'large_string': 'string',
    'date32', 'date64': 'date',
    'timestamp': 'datetime',
    'bool': 'boolean',
}
```

### Numeric Precision

Display numbers with appropriate precision:
- Integers: No decimal places
- Floats: 2 decimal places for display
- Percentages: 1 decimal place
- Very large/small numbers: Scientific notation

## Future Enhancements

**Phase 2 features (post-MVP):**
- Histogram visualization for numeric columns
- Value distribution for categorical columns
- Export statistics to CSV/JSON
- Compare statistics across multiple columns
- Statistics for filtered data vs full data comparison
- Correlation analysis between numeric columns

**Advanced statistics:**
- Quartiles (25th, 75th percentiles)
- Skewness and kurtosis
- Outlier detection and count
- Memory usage per column
- Pattern detection for strings (emails, URLs, etc.)

## Testing Checklist

- [ ] Backend statistics calculation for all data types
- [ ] API endpoint returns correct JSON structure
- [ ] Info icon appears on column header hover
- [ ] Info icon click opens modal (doesn't trigger sort)
- [ ] Modal displays all required statistics
- [ ] Modal closes on backdrop click
- [ ] Modal closes on ESC key
- [ ] Modal closes on close button
- [ ] Loading spinner shows during fetch
- [ ] Error message shows on fetch failure
- [ ] Statistics accurate for numeric columns
- [ ] Statistics accurate for string columns
- [ ] Statistics accurate for date columns
- [ ] Works with filtered data
- [ ] Works with sorted data
- [ ] Works across all file types (Parquet, CSV, Excel, TSV)
- [ ] Accessibility: keyboard navigation works
- [ ] Accessibility: screen reader announces modal
- [ ] Responsive: modal fits on small screens
- [ ] Performance: stats compute quickly for large columns

## Success Criteria

1. **Functionality**: Users can view comprehensive statistics for any column with two clicks (hover + click)
2. **Performance**: Statistics load within 2 seconds for files up to 10k rows
3. **Accuracy**: All statistics match pandas .describe() and .info() output
4. **Usability**: Modal is intuitive, visually consistent with viewer, and accessible
5. **Reliability**: Graceful error handling with clear user feedback
