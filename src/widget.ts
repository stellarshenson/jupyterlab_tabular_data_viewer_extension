import { Widget } from '@lumino/widgets';
import { requestAPI, fetchColumnStats } from './request';
import { ColumnStatsModal } from './modal';

/**
 * Column metadata interface
 */
interface IColumnMetadata {
  name: string;
  type: string;
}

/**
 * Filter specification interface
 */
interface IFilterSpec {
  type: 'text' | 'number';
  value: string;
  operator?: string;
}

/**
 * Parquet viewer widget
 */
export class TabularDataViewer extends Widget {
  private _filePath: string;
  private _columns: IColumnMetadata[] = [];
  private _data: any[] = [];
  private _totalRows = 0;
  private _unfilteredTotalRows = 0;
  private _currentOffset = 0;
  private _limit = 500;
  private _loading = false;
  private _hasMore = true;
  private _filters: { [key: string]: IFilterSpec } = {};
  private _sortBy: string | null = null;
  private _sortOrder: 'asc' | 'desc' = 'asc';
  private _fileSize = 0;
  private _caseInsensitive = false;
  private _useRegex = false;
  private _contextMenuOpen = false;
  private _columnWidths: Map<string, number> = new Map();
  private _resizing: { columnName: string; startX: number; startWidth: number } | null = null;

  private _tableContainer: HTMLDivElement;
  private _table: HTMLTableElement;
  private _thead: HTMLTableSectionElement;
  private _tbody: HTMLTableSectionElement;
  private _filterRow: HTMLTableRowElement;
  private _headerRow: HTMLTableRowElement;
  private _statusBar: HTMLDivElement;
  private _statusLeft: HTMLDivElement;
  private _statusRight: HTMLDivElement;
  private _caseInsensitiveCheckbox: HTMLInputElement;
  private _regexCheckbox: HTMLInputElement;
  private _setLastContextMenuRow: (row: any) => void;
  private _cleanupHighlight: (() => void) | null = null;
  private _menuObserver: MutationObserver | null = null;

  constructor(filePath: string, setLastContextMenuRow: (row: any) => void) {
    super();
    this._filePath = filePath;
    this._setLastContextMenuRow = setLastContextMenuRow;
    this.addClass('jp-TabularDataViewer');

    // Create table container (scrollable)
    this._tableContainer = document.createElement('div');
    this._tableContainer.className = 'jp-TabularDataViewer-container';

    // Create table
    this._table = document.createElement('table');
    this._table.className = 'jp-TabularDataViewer-table';

    this._thead = document.createElement('thead');
    this._thead.className = 'jp-TabularDataViewer-thead';

    this._tbody = document.createElement('tbody');
    this._tbody.className = 'jp-TabularDataViewer-tbody';

    // Create filter row
    this._filterRow = document.createElement('tr');
    this._filterRow.className = 'jp-TabularDataViewer-filterRow';

    // Create header row
    this._headerRow = document.createElement('tr');
    this._headerRow.className = 'jp-TabularDataViewer-headerRow';

    this._thead.appendChild(this._filterRow);
    this._thead.appendChild(this._headerRow);

    this._table.appendChild(this._thead);
    this._table.appendChild(this._tbody);
    this._tableContainer.appendChild(this._table);

    // Create status bar (outside scroll container)
    this._statusBar = document.createElement('div');
    this._statusBar.className = 'jp-TabularDataViewer-statusBar';

    this._statusLeft = document.createElement('div');
    this._statusLeft.className = 'jp-TabularDataViewer-statusLeft';

    // Create middle section with case-insensitive checkbox
    const statusMiddle = document.createElement('div');
    statusMiddle.className = 'jp-TabularDataViewer-statusMiddle';

    const checkboxLabel = document.createElement('label');
    checkboxLabel.className = 'jp-TabularDataViewer-caseInsensitiveLabel';

    this._caseInsensitiveCheckbox = document.createElement('input');
    this._caseInsensitiveCheckbox.type = 'checkbox';
    this._caseInsensitiveCheckbox.className = 'jp-TabularDataViewer-caseInsensitiveCheckbox';
    this._caseInsensitiveCheckbox.checked = this._caseInsensitive;
    this._caseInsensitiveCheckbox.addEventListener('change', () => {
      this._caseInsensitive = this._caseInsensitiveCheckbox.checked;
      this._loadData(true);
    });

    const checkboxText = document.createElement('span');
    checkboxText.textContent = ' Case insensitive';

    checkboxLabel.appendChild(this._caseInsensitiveCheckbox);
    checkboxLabel.appendChild(checkboxText);
    statusMiddle.appendChild(checkboxLabel);

    // Create regex checkbox
    const regexLabel = document.createElement('label');
    regexLabel.className = 'jp-TabularDataViewer-regexLabel';

    this._regexCheckbox = document.createElement('input');
    this._regexCheckbox.type = 'checkbox';
    this._regexCheckbox.className = 'jp-TabularDataViewer-regexCheckbox';
    this._regexCheckbox.checked = this._useRegex;
    this._regexCheckbox.addEventListener('change', () => {
      this._useRegex = this._regexCheckbox.checked;
      this._loadData(true);
    });

    const regexText = document.createElement('span');
    regexText.textContent = ' Use regex';

    regexLabel.appendChild(this._regexCheckbox);
    regexLabel.appendChild(regexText);
    statusMiddle.appendChild(regexLabel);

    this._statusRight = document.createElement('div');
    this._statusRight.className = 'jp-TabularDataViewer-statusRight';

    this._statusBar.appendChild(this._statusLeft);
    this._statusBar.appendChild(statusMiddle);
    this._statusBar.appendChild(this._statusRight);

    // Append table container and status bar directly to widget node
    this.node.appendChild(this._tableContainer);
    this.node.appendChild(this._statusBar);

    // Set up scroll listener for progressive loading
    this._tableContainer.addEventListener('scroll', () => {
      this._onScroll();
    });

    // Remove context-active class when clicking anywhere or dismissing context menu
    const removeHighlight = () => {
      this._contextMenuOpen = false;
      this._tbody.classList.remove('jp-TabularDataViewer-context-menu-open');
      this._tbody.querySelectorAll('tr').forEach(r => {
        r.classList.remove('jp-TabularDataViewer-row-context-active');
      });

      // Stop observing when highlight is removed
      if (this._menuObserver) {
        this._menuObserver.disconnect();
        this._menuObserver = null;
      }
    };

    // Store cleanup function for external access
    this._cleanupHighlight = removeHighlight;

    // Initialize
    this._initialize();
  }

  /**
   * Start observing for menu removal when context menu opens
   */
  private _startMenuObserver(): void {
    // Stop any existing observer
    if (this._menuObserver) {
      this._menuObserver.disconnect();
    }

    // Create observer to watch for menu removal from DOM
    this._menuObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.removedNodes.length > 0) {
          // Check if any removed node is a Lumino menu
          for (const node of Array.from(mutation.removedNodes)) {
            if (node instanceof HTMLElement &&
                (node.classList.contains('lm-Menu') || node.classList.contains('p-Menu'))) {
              // Menu was removed, clear highlight
              if (this._cleanupHighlight) {
                this._cleanupHighlight();
              }
              return;
            }
          }
        }
      }
    });

    // Observe document body for child removals
    this._menuObserver.observe(document.body, {
      childList: true,
      subtree: false
    });
  }

  /**
   * Get cleanup function to clear highlight (for external use)
   */
  public getCleanupHighlight(): () => void {
    return this._cleanupHighlight || (() => {});
  }

  /**
   * Initialize the viewer by loading metadata and initial data
   */
  private async _initialize(): Promise<void> {
    try {
      await this._loadMetadata();
      await this._loadData(true);
    } catch (error) {
      this._showError(`Failed to load file: ${error}`);
    }
  }

  /**
   * Load file metadata (columns, types, row count)
   */
  private async _loadMetadata(): Promise<void> {
    const response = await requestAPI<any>('metadata', {
      method: 'POST',
      body: JSON.stringify({ path: this._filePath })
    });

    this._columns = response.columns;
    this._totalRows = response.totalRows;
    this._unfilteredTotalRows = response.totalRows;
    this._fileSize = response.fileSize || 0;

    this._renderHeaders();
    this._updateStatusBar();
  }

  /**
   * Load data from server
   */
  private async _loadData(reset = false): Promise<void> {
    if (this._loading) {
      return;
    }

    this._loading = true;
    this._updateStatusBar('Loading...');

    try {
      if (reset) {
        this._currentOffset = 0;
        this._data = [];
        this._tbody.innerHTML = '';
      }

      const response = await requestAPI<any>('data', {
        method: 'POST',
        body: JSON.stringify({
          path: this._filePath,
          offset: this._currentOffset,
          limit: this._limit,
          filters: this._filters,
          sortBy: this._sortBy,
          sortOrder: this._sortOrder,
          caseInsensitive: this._caseInsensitive,
          useRegex: this._useRegex
        })
      });

      this._data = this._data.concat(response.data);
      this._hasMore = response.hasMore;
      this._currentOffset += response.data.length;

      if (reset) {
        this._totalRows = response.totalRows;
      }

      // Calculate starting row number (1-indexed)
      const startingRowNumber = this._data.length - response.data.length + 1;
      this._renderData(response.data, startingRowNumber);
      this._updateStatusBar();
    } catch (error) {
      this._showError(`Failed to load data: ${error}`);
    } finally {
      this._loading = false;
    }
  }

  /**
   * Render table headers with filter inputs
   */
  private _renderHeaders(): void {
    this._filterRow.innerHTML = '';
    this._headerRow.innerHTML = '';

    // Add row number column header
    const rowNumFilterCell = document.createElement('th');
    rowNumFilterCell.className = 'jp-TabularDataViewer-filterCell jp-TabularDataViewer-rowNumberCell';
    this._filterRow.appendChild(rowNumFilterCell);

    const rowNumHeaderCell = document.createElement('th');
    rowNumHeaderCell.className = 'jp-TabularDataViewer-headerCell jp-TabularDataViewer-rowNumberCell';
    const rowNumContent = document.createElement('div');
    rowNumContent.className = 'jp-TabularDataViewer-headerContent';
    const rowNumName = document.createElement('div');
    rowNumName.className = 'jp-TabularDataViewer-columnName';
    rowNumName.textContent = '';
    rowNumContent.appendChild(rowNumName);
    rowNumHeaderCell.appendChild(rowNumContent);
    rowNumHeaderCell.style.width = '60px';
    rowNumFilterCell.style.width = '60px';
    this._headerRow.appendChild(rowNumHeaderCell);

    this._columns.forEach(col => {
      // Create filter cell
      const filterCell = document.createElement('th');
      filterCell.className = 'jp-TabularDataViewer-filterCell';

      const filterInput = document.createElement('input');
      filterInput.type = 'text';
      filterInput.className = 'jp-TabularDataViewer-filterInput';
      filterInput.placeholder = this._getFilterPlaceholder(col.type);
      filterInput.dataset.columnName = col.name;
      filterInput.dataset.columnType = col.type;

      filterInput.addEventListener('keyup', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          this._applyFilter(col.name, filterInput.value, col.type);
        }
      });

      filterCell.appendChild(filterInput);
      this._filterRow.appendChild(filterCell);

      // Create header cell with column name and type
      const headerCell = document.createElement('th');
      headerCell.className = 'jp-TabularDataViewer-headerCell';
      headerCell.style.cursor = 'pointer';
      headerCell.dataset.columnName = col.name;

      // Add click handler for sorting
      headerCell.addEventListener('click', () => {
        this._toggleSort(col.name);
      });

      const headerContent = document.createElement('div');
      headerContent.className = 'jp-TabularDataViewer-headerContent';

      const nameSpan = document.createElement('div');
      nameSpan.className = 'jp-TabularDataViewer-columnName';
      nameSpan.textContent = col.name;

      // Add info icon for column statistics
      const infoIcon = document.createElement('span');
      infoIcon.className = 'jp-TabularDataViewer-infoIcon';
      infoIcon.textContent = '🛈';
      infoIcon.title = 'Show column statistics';
      infoIcon.addEventListener('click', async (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation(); // Prevent sort from triggering
        await this._showColumnStats(col.name);
      });
      nameSpan.appendChild(infoIcon);

      const typeSpan = document.createElement('div');
      typeSpan.className = 'jp-TabularDataViewer-columnType';
      typeSpan.textContent = this._simplifyType(col.type);

      const sortIndicator = document.createElement('span');
      sortIndicator.className = 'jp-TabularDataViewer-sortIndicator';
      sortIndicator.textContent = '';

      headerContent.appendChild(nameSpan);
      headerContent.appendChild(typeSpan);
      headerCell.appendChild(headerContent);
      headerCell.appendChild(sortIndicator);

      // Add resize handle
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'jp-TabularDataViewer-resizeHandle';
      resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this._startResize(col.name, e.clientX, headerCell);
      });
      // Prevent click events from triggering sort
      resizeHandle.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
      });
      headerCell.appendChild(resizeHandle);

      // Set width - use stored width or default to 200px
      const columnWidth = this._columnWidths.get(col.name) || 200;
      if (!this._columnWidths.has(col.name)) {
        this._columnWidths.set(col.name, columnWidth);
      }
      headerCell.style.width = `${columnWidth}px`;
      filterCell.style.width = `${columnWidth}px`;

      this._headerRow.appendChild(headerCell);
    });

    // Set table width to sum of all column widths plus row number column (60px)
    const totalWidth = Array.from(this._columnWidths.values()).reduce((sum, w) => sum + w, 0) + 60;
    this._table.style.width = `${totalWidth}px`;
  }

  /**
   * Render data rows
   */
  private _renderData(rows: any[], startingRowNumber: number = 1): void {
    rows.forEach((row, index) => {
      const tr = document.createElement('tr');
      tr.className = 'jp-TabularDataViewer-row';

      // Add row number cell
      const rowNumCell = document.createElement('td');
      rowNumCell.className = 'jp-TabularDataViewer-cell jp-TabularDataViewer-rowNumberCell';
      rowNumCell.textContent = String(startingRowNumber + index);
      tr.appendChild(rowNumCell);

      this._columns.forEach(col => {
        const td = document.createElement('td');
        td.className = 'jp-TabularDataViewer-cell';
        const value = row[col.name];
        td.textContent = value !== null && value !== undefined ? String(value) : '';
        tr.appendChild(td);
      });

      // Remove context-active class when hovering over any row (only if context menu not open)
      tr.addEventListener('mouseenter', () => {
        // Don't clear highlight while context menu is open
        if (!this._contextMenuOpen) {
          this._tbody.querySelectorAll('tr').forEach(r => {
            r.classList.remove('jp-TabularDataViewer-row-context-active');
          });
        }
      });

      // Add right-click handler to store row data and maintain hover styling
      tr.addEventListener('contextmenu', (e) => {
        // Mark context menu as open
        this._contextMenuOpen = true;

        // Add class to tbody to disable hover on other rows
        this._tbody.classList.add('jp-TabularDataViewer-context-menu-open');

        // Remove context-active class from all rows
        this._tbody.querySelectorAll('tr').forEach(r => {
          r.classList.remove('jp-TabularDataViewer-row-context-active');
        });

        // Add context-active class to keep hover styling visible
        tr.classList.add('jp-TabularDataViewer-row-context-active');

        // Store row data for context menu
        this._setLastContextMenuRow(row);

        // Start observing for menu removal
        this._startMenuObserver();
      });

      this._tbody.appendChild(tr);
    });
  }

  /**
   * Start column resize
   */
  private _startResize(columnName: string, startX: number, headerCell: HTMLElement): void {
    this._resizing = {
      columnName,
      startX,
      startWidth: headerCell.offsetWidth
    };

    // Add global mouse event listeners
    document.addEventListener('mousemove', this._doResize);
    document.addEventListener('mouseup', this._stopResize);

    // Prevent text selection during resize
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }

  /**
   * Handle column resize drag
   */
  private _doResize = (e: MouseEvent): void => {
    if (!this._resizing) {
      return;
    }

    const deltaX = e.clientX - this._resizing.startX;
    const newWidth = Math.max(80, this._resizing.startWidth + deltaX); // Minimum width of 80px

    // Store the new width
    this._columnWidths.set(this._resizing.columnName, newWidth);

    // Apply the new width to the column header and filter cell only
    // With table-layout: fixed, this automatically applies to all cells in the column
    const columnIndex = this._columns.findIndex(col => col.name === this._resizing!.columnName);
    if (columnIndex !== -1) {
      const headerCell = this._headerRow.children[columnIndex] as HTMLElement;
      const filterCell = this._filterRow.children[columnIndex] as HTMLElement;

      if (headerCell) {
        headerCell.style.width = `${newWidth}px`;
      }
      if (filterCell) {
        filterCell.style.width = `${newWidth}px`;
      }

      // Update table width to sum of all column widths
      const totalWidth = Array.from(this._columnWidths.values()).reduce((sum, w) => sum + w, 0);
      this._table.style.width = `${totalWidth}px`;
    }
  };

  /**
   * Stop column resize
   */
  private _stopResize = (): void => {
    if (!this._resizing) {
      return;
    }

    this._resizing = null;

    // Remove global mouse event listeners
    document.removeEventListener('mousemove', this._doResize);
    document.removeEventListener('mouseup', this._stopResize);

    // Restore user selection and cursor
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  };

  /**
   * Apply filter to a column
   */
  private _applyFilter(columnName: string, value: string, columnType: string): void {
    if (!value.trim()) {
      // Remove filter if empty
      delete this._filters[columnName];
    } else {
      const isNumeric = this._isNumericType(columnType);

      if (isNumeric) {
        // Parse numerical filter with operator
        const match = value.match(/^([><=]+)?\s*(.+)$/);
        if (match) {
          const operator = match[1] || '=';
          const numValue = match[2].trim();

          this._filters[columnName] = {
            type: 'number',
            value: numValue,
            operator: operator
          };
        }
      } else {
        // Text filter
        this._filters[columnName] = {
          type: 'text',
          value: value
        };
      }
    }

    // Reload data with filters
    this._loadData(true);
  }

  /**
   * Simplify type names for display
   */
  private _simplifyType(type: string): string {
    const lowerType = type.toLowerCase();

    // Date types
    if (lowerType.includes('date32') || lowerType.includes('date64')) {
      return 'date';
    }

    // Timestamp/datetime types
    if (lowerType.includes('timestamp')) {
      return 'datetime';
    }

    // Integer types
    if (lowerType.match(/^u?int(8|16|32|64)$/)) {
      return 'int';
    }

    // Float types
    if (lowerType.match(/^(float|double)(16|32|64)?$/)) {
      return 'float';
    }

    // Decimal types
    if (lowerType.includes('decimal')) {
      return 'decimal';
    }

    // Boolean
    if (lowerType === 'bool') {
      return 'boolean';
    }

    // String types
    if (lowerType === 'string' || lowerType === 'utf8' || lowerType === 'large_string' || lowerType === 'large_utf8') {
      return 'string';
    }

    // Binary types
    if (lowerType === 'binary' || lowerType === 'large_binary') {
      return 'binary';
    }

    // List types
    if (lowerType.startsWith('list')) {
      return 'list';
    }

    // Struct types
    if (lowerType.startsWith('struct')) {
      return 'struct';
    }

    // Default: return as-is
    return type;
  }

  /**
   * Check if column type is numeric
   */
  private _isNumericType(type: string): boolean {
    const numericTypes = ['int', 'float', 'double', 'decimal', 'int8', 'int16', 'int32', 'int64', 'uint8', 'uint16', 'uint32', 'uint64'];
    return numericTypes.some(t => type.toLowerCase().includes(t));
  }

  /**
   * Get filter placeholder based on column type
   */
  private _getFilterPlaceholder(type: string): string {
    if (this._isNumericType(type)) {
      return '=, >, <, >=, <=';
    }
    return 'text or regex...';
  }

  /**
   * Handle scroll event for progressive loading
   */
  private _onScroll(): void {
    const container = this._tableContainer;
    const scrollPosition = container.scrollTop + container.clientHeight;
    const scrollHeight = container.scrollHeight;

    // Load more when scrolled to within 200px of bottom
    if (scrollPosition >= scrollHeight - 200 && this._hasMore && !this._loading) {
      this._loadData(false);
    }
  }

  /**
   * Toggle sort on a column
   */
  private _toggleSort(columnName: string): void {
    if (this._sortBy === columnName) {
      // Cycle through: asc -> desc -> off
      if (this._sortOrder === 'asc') {
        this._sortOrder = 'desc';
      } else if (this._sortOrder === 'desc') {
        // Turn off sorting
        this._sortBy = null;
        this._sortOrder = 'asc';
      }
    } else {
      // Sort by new column (ascending)
      this._sortBy = columnName;
      this._sortOrder = 'asc';
    }

    this._updateSortIndicators();
    this._loadData(true);
  }

  /**
   * Show column statistics modal
   */
  private async _showColumnStats(columnName: string): Promise<void> {
    try {
      // Show loading indicator (we could add a spinner here)
      const stats = await fetchColumnStats(this._filePath, columnName);
      const modal = new ColumnStatsModal(stats);
      modal.show();
    } catch (error) {
      console.error('Failed to load column statistics:', error);
      // Could show an error message to user
      alert(`Failed to load statistics for column "${columnName}": ${error}`);
    }
  }

  /**
   * Update sort indicators in column headers
   */
  private _updateSortIndicators(): void {
    const headers = this._headerRow.querySelectorAll('th');
    headers.forEach(header => {
      const columnName = header.dataset.columnName;
      const indicator = header.querySelector('.jp-TabularDataViewer-sortIndicator') as HTMLElement;

      if (columnName === this._sortBy) {
        indicator.textContent = this._sortOrder === 'asc' ? ' ▲' : ' ▼';
      } else {
        indicator.textContent = '';
      }
    });
  }

  /**
   * Clear all filters
   */
  private _clearFilters(): void {
    this._filters = {};

    // Clear filter inputs
    const filterInputs = this._filterRow.querySelectorAll('input');
    filterInputs.forEach(input => {
      (input as HTMLInputElement).value = '';
    });

    this._loadData(true);
  }

  /**
   * Format file size to human-readable string
   */
  private _formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Update status bar
   */
  private _updateStatusBar(message?: string): void {
    if (message) {
      this._statusLeft.textContent = '';
      this._statusRight.textContent = message;
    } else {
      // Left side: file stats (always show unfiltered total)
      const numColumns = this._columns.length;
      const fileSize = this._formatFileSize(this._fileSize);
      this._statusLeft.textContent = `${numColumns} columns • ${this._unfilteredTotalRows} rows • ${fileSize}`;

      // Right side: showing info and clear filters link
      const filterCount = Object.keys(this._filters).length;
      let rightText = `Showing ${this._data.length} of ${this._totalRows} rows`;

      if (filterCount > 0) {
        rightText += ` (${filterCount} filter${filterCount > 1 ? 's' : ''} active)`;
      }

      this._statusRight.innerHTML = rightText;

      if (filterCount > 0) {
        const clearLink = document.createElement('a');
        clearLink.href = '#';
        clearLink.className = 'jp-TabularDataViewer-clearFilters';
        clearLink.textContent = 'Clear filters';
        clearLink.addEventListener('click', (e) => {
          e.preventDefault();
          this._clearFilters();
        });

        this._statusRight.appendChild(document.createTextNode(' • '));
        this._statusRight.appendChild(clearLink);
      }
    }
  }

  /**
   * Show error message
   */
  private _showError(message: string): void {
    this._tbody.innerHTML = '';
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = this._columns.length || 1;
    td.className = 'jp-TabularDataViewer-error';
    td.textContent = message;
    tr.appendChild(td);
    this._tbody.appendChild(tr);
  }

  /**
   * Dispose of the widget
   */
  dispose(): void {
    this._tableContainer.removeEventListener('scroll', this._onScroll);

    // Clean up menu observer
    if (this._menuObserver) {
      this._menuObserver.disconnect();
      this._menuObserver = null;
    }

    // Clean up resize event listeners if still active
    if (this._resizing) {
      document.removeEventListener('mousemove', this._doResize);
      document.removeEventListener('mouseup', this._stopResize);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }

    super.dispose();
  }
}
