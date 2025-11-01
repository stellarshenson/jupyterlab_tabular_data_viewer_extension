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
  private _currentOffset = 0;
  private _limit = 500;
  private _loading = false;
  private _hasMore = true;
  private _filters: { [key: string]: IFilterSpec } = {};

  private _tableContainer: HTMLDivElement;
  private _table: HTMLTableElement;
  private _thead: HTMLTableSectionElement;
  private _tbody: HTMLTableSectionElement;
  private _filterRow: HTMLTableRowElement;
  private _headerRow: HTMLTableRowElement;
  private _statusBar: HTMLDivElement;

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

    this._renderHeaders();
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
          filters: this._filters
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

      const nameSpan = document.createElement('div');
      nameSpan.className = 'jp-ParquetViewer-columnName';
      nameSpan.textContent = col.name;

      const typeSpan = document.createElement('div');
      typeSpan.className = 'jp-ParquetViewer-columnType';
      typeSpan.textContent = col.type;

      headerCell.appendChild(nameSpan);
      headerCell.appendChild(typeSpan);
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
    return 'Filter text...';
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
   * Update status bar
   */
  private _updateStatusBar(message?: string): void {
    if (message) {
      this._statusBar.textContent = message;
    } else {
      const filterCount = Object.keys(this._filters).length;
      const filterText = filterCount > 0 ? ` (${filterCount} filter${filterCount > 1 ? 's' : ''} active)` : '';
      this._statusBar.textContent = `Showing ${this._data.length} of ${this._totalRows} rows${filterText}`;
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
