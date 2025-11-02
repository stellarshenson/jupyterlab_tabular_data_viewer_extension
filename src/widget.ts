import { Widget } from '@lumino/widgets';
import { requestAPI } from './request';

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
export class ParquetViewer extends Widget {
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

  constructor(filePath: string) {
    super();
    this._filePath = filePath;
    this.addClass('jp-ParquetViewer');

    // Create main container
    this._tableContainer = document.createElement('div');
    this._tableContainer.className = 'jp-ParquetViewer-container';

    // Create table
    this._table = document.createElement('table');
    this._table.className = 'jp-ParquetViewer-table';

    this._thead = document.createElement('thead');
    this._thead.className = 'jp-ParquetViewer-thead';

    this._tbody = document.createElement('tbody');
    this._tbody.className = 'jp-ParquetViewer-tbody';

    // Create filter row
    this._filterRow = document.createElement('tr');
    this._filterRow.className = 'jp-ParquetViewer-filterRow';

    // Create header row
    this._headerRow = document.createElement('tr');
    this._headerRow.className = 'jp-ParquetViewer-headerRow';

    this._thead.appendChild(this._filterRow);
    this._thead.appendChild(this._headerRow);

    this._table.appendChild(this._thead);
    this._table.appendChild(this._tbody);
    this._tableContainer.appendChild(this._table);

    // Create status bar
    this._statusBar = document.createElement('div');
    this._statusBar.className = 'jp-ParquetViewer-statusBar';

    this._statusLeft = document.createElement('div');
    this._statusLeft.className = 'jp-ParquetViewer-statusLeft';

    // Create middle section with case-insensitive checkbox
    const statusMiddle = document.createElement('div');
    statusMiddle.className = 'jp-ParquetViewer-statusMiddle';

    const checkboxLabel = document.createElement('label');
    checkboxLabel.className = 'jp-ParquetViewer-caseInsensitiveLabel';

    this._caseInsensitiveCheckbox = document.createElement('input');
    this._caseInsensitiveCheckbox.type = 'checkbox';
    this._caseInsensitiveCheckbox.className = 'jp-ParquetViewer-caseInsensitiveCheckbox';
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
    regexLabel.className = 'jp-ParquetViewer-regexLabel';

    this._regexCheckbox = document.createElement('input');
    this._regexCheckbox.type = 'checkbox';
    this._regexCheckbox.className = 'jp-ParquetViewer-regexCheckbox';
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
    this._statusRight.className = 'jp-ParquetViewer-statusRight';

    this._statusBar.appendChild(this._statusLeft);
    this._statusBar.appendChild(statusMiddle);
    this._statusBar.appendChild(this._statusRight);
    this._tableContainer.appendChild(this._statusBar);

    this.node.appendChild(this._tableContainer);

    // Set up scroll listener for progressive loading
    this._tableContainer.addEventListener('scroll', () => {
      this._onScroll();
    });

    // Initialize
    this._initialize();
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

      this._renderData(response.data);
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

    this._columns.forEach(col => {
      // Create filter cell
      const filterCell = document.createElement('th');
      filterCell.className = 'jp-ParquetViewer-filterCell';

      const filterInput = document.createElement('input');
      filterInput.type = 'text';
      filterInput.className = 'jp-ParquetViewer-filterInput';
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
      headerCell.className = 'jp-ParquetViewer-headerCell';
      headerCell.style.cursor = 'pointer';
      headerCell.dataset.columnName = col.name;

      // Add click handler for sorting
      headerCell.addEventListener('click', () => {
        this._toggleSort(col.name);
      });

      const headerContent = document.createElement('div');
      headerContent.className = 'jp-ParquetViewer-headerContent';

      const nameSpan = document.createElement('div');
      nameSpan.className = 'jp-ParquetViewer-columnName';
      nameSpan.textContent = col.name;

      const typeSpan = document.createElement('div');
      typeSpan.className = 'jp-ParquetViewer-columnType';
      typeSpan.textContent = this._simplifyType(col.type);

      const sortIndicator = document.createElement('span');
      sortIndicator.className = 'jp-ParquetViewer-sortIndicator';
      sortIndicator.textContent = '';

      headerContent.appendChild(nameSpan);
      headerContent.appendChild(typeSpan);
      headerCell.appendChild(headerContent);
      headerCell.appendChild(sortIndicator);
      this._headerRow.appendChild(headerCell);
    });
  }

  /**
   * Render data rows
   */
  private _renderData(rows: any[]): void {
    rows.forEach(row => {
      const tr = document.createElement('tr');
      tr.className = 'jp-ParquetViewer-row';

      this._columns.forEach(col => {
        const td = document.createElement('td');
        td.className = 'jp-ParquetViewer-cell';
        const value = row[col.name];
        td.textContent = value !== null && value !== undefined ? String(value) : '';
        tr.appendChild(td);
      });

      this._tbody.appendChild(tr);
    });
  }

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
   * Update sort indicators in column headers
   */
  private _updateSortIndicators(): void {
    const headers = this._headerRow.querySelectorAll('th');
    headers.forEach(header => {
      const columnName = header.dataset.columnName;
      const indicator = header.querySelector('.jp-ParquetViewer-sortIndicator') as HTMLElement;

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
        clearLink.className = 'jp-ParquetViewer-clearFilters';
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
    td.className = 'jp-ParquetViewer-error';
    td.textContent = message;
    tr.appendChild(td);
    this._tbody.appendChild(tr);
  }

  /**
   * Dispose of the widget
   */
  dispose(): void {
    this._tableContainer.removeEventListener('scroll', this._onScroll);
    super.dispose();
  }
}
