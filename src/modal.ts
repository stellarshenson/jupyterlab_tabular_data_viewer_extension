import { Widget } from '@lumino/widgets';
import { IColumnStats, IUniqueValues } from './request';

/**
 * Modal dialog widget for displaying column statistics
 */
export class ColumnStatsModal extends Widget {
  private _stats: IColumnStats;
  private _uniqueValues: IUniqueValues | null;

  constructor(stats: IColumnStats, uniqueValues: IUniqueValues | null = null) {
    super();
    this._stats = stats;
    this._uniqueValues = uniqueValues;
    this.addClass('jp-ColumnStatsModal');
    this._render();
    this._setupEventListeners();
  }

  /**
   * Render the modal content
   */
  private _render(): void {
    const content = document.createElement('div');
    content.className = 'jp-ColumnStatsModal-content';

    // Header with column name and close button
    const header = document.createElement('div');
    header.className = 'jp-ColumnStatsModal-header';
    const title = document.createElement('h3');
    title.textContent = `Column: ${this._stats.column_name}`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'jp-ColumnStatsModal-close';
    closeBtn.textContent = '×';
    closeBtn.onclick = () => this.close();
    header.appendChild(title);
    header.appendChild(closeBtn);
    content.appendChild(header);

    // Copy JSON button
    const copySection = document.createElement('div');
    copySection.className = 'jp-ColumnStatsModal-copy';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'jp-FilterModal-button'; // Use filter modal button style
    copyBtn.textContent = 'Copy Stats as JSON';
    copyBtn.onclick = () => this._copyStatsAsJson();
    copySection.appendChild(copyBtn);
    content.appendChild(copySection);

    // Data type
    const typeDiv = document.createElement('div');
    typeDiv.className = 'jp-ColumnStatsModal-type';
    typeDiv.textContent = `Type: ${this._stats.data_type}`;
    content.appendChild(typeDiv);

    // Data Summary section
    const summarySection = document.createElement('div');
    summarySection.className = 'jp-ColumnStatsModal-section';
    const summaryTitle = document.createElement('h4');
    summaryTitle.textContent = 'Data Summary';
    summarySection.appendChild(summaryTitle);

    const summaryList = document.createElement('ul');
    summaryList.innerHTML = `
      <li>Total rows: ${this._formatNumber(this._stats.total_rows)}</li>
      <li>Non-null: ${this._formatNumber(this._stats.non_null_count)} (${this._stats.non_null_percentage}%)</li>
      <li>Null: ${this._formatNumber(this._stats.null_count)} (${this._stats.null_percentage}%)</li>
      <li>Unique values: ${this._formatNumber(this._stats.unique_count)} (${this._stats.unique_percentage}%)</li>
    `;
    summarySection.appendChild(summaryList);
    content.appendChild(summarySection);

    // Numeric statistics
    if (this._stats.data_type === 'int' || this._stats.data_type === 'float') {
      const numericSection = document.createElement('div');
      numericSection.className = 'jp-ColumnStatsModal-section';
      const numericTitle = document.createElement('h4');
      numericTitle.textContent = 'Numeric Statistics';
      numericSection.appendChild(numericTitle);

      const numericList = document.createElement('ul');
      const items: string[] = [];

      if (this._stats.min_value !== undefined) {
        items.push(`Min: ${this._formatNumber(this._stats.min_value)}`);
      }
      if (this._stats.max_value !== undefined) {
        items.push(`Max: ${this._formatNumber(this._stats.max_value)}`);
      }
      if (this._stats.mean !== undefined) {
        items.push(`Mean: ${this._formatNumber(this._stats.mean)}`);
      }
      if (this._stats.median !== undefined) {
        items.push(`Median: ${this._formatNumber(this._stats.median)}`);
      }
      if (this._stats.std_dev !== undefined) {
        items.push(`Std Dev: ${this._formatNumber(this._stats.std_dev)}`);
      }
      if (this._stats.outlier_count !== undefined) {
        items.push(
          `Outliers: ${this._formatNumber(this._stats.outlier_count)} (${this._stats.outlier_percentage}%)`
        );
      }

      numericList.innerHTML = items.map(item => `<li>${item}</li>`).join('');
      numericSection.appendChild(numericList);
      content.appendChild(numericSection);
    }

    // String statistics
    if (this._stats.data_type === 'string') {
      const items: string[] = [];

      if (this._stats.most_common_value !== undefined) {
        items.push(
          `Most common: "${this._stats.most_common_value}" (${this._stats.most_common_count})`
        );
      }
      if (this._stats.min_length !== undefined) {
        items.push(`Min length: ${this._stats.min_length} characters`);
      }
      if (this._stats.max_length !== undefined) {
        items.push(`Max length: ${this._stats.max_length} characters`);
      }
      if (this._stats.avg_length !== undefined) {
        items.push(
          `Avg length: ${this._formatNumber(this._stats.avg_length)} characters`
        );
      }

      // Only show section if we have stats to display
      if (items.length > 0) {
        const stringSection = document.createElement('div');
        stringSection.className = 'jp-ColumnStatsModal-section';
        const stringTitle = document.createElement('h4');
        stringTitle.textContent = 'String Statistics';
        stringSection.appendChild(stringTitle);

        const stringList = document.createElement('ul');
        stringList.innerHTML = items.map(item => `<li>${item}</li>`).join('');
        stringSection.appendChild(stringList);
        content.appendChild(stringSection);
      }
    }

    // Date/datetime statistics
    if (
      this._stats.data_type === 'date' ||
      this._stats.data_type === 'datetime'
    ) {
      const dateSection = document.createElement('div');
      dateSection.className = 'jp-ColumnStatsModal-section';
      const dateTitle = document.createElement('h4');
      dateTitle.textContent = 'Date Range';
      dateSection.appendChild(dateTitle);

      const dateList = document.createElement('ul');
      const items: string[] = [];

      if (this._stats.earliest_date) {
        items.push(`Earliest: ${this._stats.earliest_date}`);
      }
      if (this._stats.latest_date) {
        items.push(`Latest: ${this._stats.latest_date}`);
      }
      if (this._stats.date_range_days !== undefined) {
        items.push(
          `Span: ${this._formatNumber(this._stats.date_range_days)} days`
        );
      }

      dateList.innerHTML = items.map(item => `<li>${item}</li>`).join('');
      dateSection.appendChild(dateList);
      content.appendChild(dateSection);
    }

    // Unique values section (if provided)
    if (this._uniqueValues && this._uniqueValues.values.length > 0) {
      const uniqueSection = document.createElement('div');
      uniqueSection.className = 'jp-ColumnStatsModal-section';
      const uniqueTitle = document.createElement('h4');
      uniqueTitle.textContent = 'Unique Values';
      uniqueSection.appendChild(uniqueTitle);

      // Info about showing limited values (only if limited)
      const showing = this._uniqueValues.values.length;
      const totalUnique = this._stats.unique_count;
      if (showing < totalUnique) {
        const info = document.createElement('div');
        info.className = 'jp-ColumnStatsModal-info';
        info.textContent = `Showing ${showing} of ${totalUnique} unique values`;
        uniqueSection.appendChild(info);
      }

      // Values list as bullet points
      const valuesList = document.createElement('ul');
      valuesList.className = 'jp-ColumnStatsModal-uniqueValuesList';

      this._uniqueValues.values.forEach((value, index) => {
        const count = this._uniqueValues!.counts[index];
        const percentage = ((count / this._stats.total_rows) * 100).toFixed(2);

        const item = document.createElement('li');
        item.className = 'jp-ColumnStatsModal-uniqueValueItem';

        const valueText = value || '(empty)';
        const statsText = `${count.toLocaleString()} (${percentage}%)`;

        item.textContent = `${valueText}: ${statsText}`;
        valuesList.appendChild(item);
      });

      uniqueSection.appendChild(valuesList);
      content.appendChild(uniqueSection);
    }

    this.node.appendChild(content);
  }

  /**
   * Format number with thousands separator
   */
  private _formatNumber(num: number): string {
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  /**
   * Copy statistics as JSON to clipboard
   */
  private async _copyStatsAsJson(): Promise<void> {
    try {
      const json = JSON.stringify(this._stats, null, 2);
      await navigator.clipboard.writeText(json);
      // Provide visual feedback
      const btn = this.node.querySelector('.jp-FilterModal-button');
      if (btn) {
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      }
    } catch (error) {
      console.error('Failed to copy stats to clipboard:', error);
    }
  }

  /**
   * Setup event listeners for closing the modal
   */
  private _setupEventListeners(): void {
    // Close on ESC key
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        this.close();
      }
    };
    document.addEventListener('keydown', handleKeydown);
    this.disposed.connect(() => {
      document.removeEventListener('keydown', handleKeydown);
    });

    // Close on backdrop click
    this.node.addEventListener('click', (event: MouseEvent) => {
      if (event.target === this.node) {
        this.close();
      }
    });
  }

  /**
   * Show the modal
   */
  show(): void {
    Widget.attach(this, document.body);
    this.node.focus();
  }

  /**
   * Close and dispose the modal
   */
  close(): void {
    this.dispose();
  }
}

/**
 * Modal dialog widget for filtering by unique values
 */
export class FilterModal extends Widget {
  private _columnName: string;
  private _uniqueValues: IUniqueValues;
  private _selectedValues: Set<string>;
  private _onApply: (values: string[] | null) => void;

  constructor(
    columnName: string,
    uniqueValues: IUniqueValues,
    currentFilter: string[],
    onApply: (values: string[] | null) => void
  ) {
    super();
    this._columnName = columnName;
    this._uniqueValues = uniqueValues;
    this._selectedValues = new Set(currentFilter);
    this._onApply = onApply;
    this.addClass('jp-FilterModal');
    this._render();
    this._setupEventListeners();
  }

  /**
   * Render the modal content
   */
  private _render(): void {
    const content = document.createElement('div');
    content.className = 'jp-FilterModal-content';

    // Header with column name and close button
    const header = document.createElement('div');
    header.className = 'jp-FilterModal-header';
    const title = document.createElement('h3');
    title.textContent = `Filter: ${this._columnName}`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'jp-FilterModal-close';
    closeBtn.textContent = '×';
    closeBtn.onclick = () => this.close();
    header.appendChild(title);
    header.appendChild(closeBtn);
    content.appendChild(header);

    // Action buttons at top
    const actionButtons = document.createElement('div');
    actionButtons.className = 'jp-FilterModal-actionButtons';

    const selectAllBtn = document.createElement('button');
    selectAllBtn.className = 'jp-FilterModal-button';
    selectAllBtn.textContent = 'Select All';
    selectAllBtn.onclick = () => this._selectAll();

    const clearBtn = document.createElement('button');
    clearBtn.className = 'jp-FilterModal-button';
    clearBtn.textContent = 'Clear';
    clearBtn.onclick = () => this._clearAll();

    actionButtons.appendChild(selectAllBtn);
    actionButtons.appendChild(clearBtn);
    content.appendChild(actionButtons);

    // Values list container
    const valuesContainer = document.createElement('div');
    valuesContainer.className = 'jp-FilterModal-valuesContainer';

    // Add info about total values
    const info = document.createElement('div');
    info.className = 'jp-FilterModal-info';
    info.textContent = `${this._uniqueValues.values.length} unique values (showing max ${this._uniqueValues.limit})`;
    valuesContainer.appendChild(info);

    // Create checkboxes for each unique value
    const valuesList = document.createElement('div');
    valuesList.className = 'jp-FilterModal-valuesList';

    this._uniqueValues.values.forEach((value, index) => {
      const item = document.createElement('label');
      item.className = 'jp-FilterModal-valueItem';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'jp-FilterModal-checkbox';
      checkbox.dataset.value = value;
      checkbox.checked = this._selectedValues.has(value);
      checkbox.onchange = () => this._toggleValue(value, checkbox.checked);

      const labelContainer = document.createElement('div');
      labelContainer.className = 'jp-FilterModal-valueLabelContainer';

      const label = document.createElement('span');
      label.textContent = value || '(empty)';
      label.className = 'jp-FilterModal-valueLabel';

      const count = document.createElement('span');
      count.textContent = `(${this._uniqueValues.counts[index].toLocaleString()})`;
      count.className = 'jp-FilterModal-valueCount';

      labelContainer.appendChild(label);
      labelContainer.appendChild(count);

      item.appendChild(checkbox);
      item.appendChild(labelContainer);
      valuesList.appendChild(item);
    });

    valuesContainer.appendChild(valuesList);
    content.appendChild(valuesContainer);

    // Bottom buttons
    const bottomButtons = document.createElement('div');
    bottomButtons.className = 'jp-FilterModal-bottomButtons';

    const okBtn = document.createElement('button');
    okBtn.className = 'jp-FilterModal-okButton';
    okBtn.textContent = 'OK';
    okBtn.onclick = () => this._apply();

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'jp-FilterModal-cancelButton';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => this.close();

    bottomButtons.appendChild(cancelBtn);
    bottomButtons.appendChild(okBtn);
    content.appendChild(bottomButtons);

    this.node.appendChild(content);
  }

  /**
   * Select all values
   */
  private _selectAll(): void {
    this._uniqueValues.values.forEach(value => this._selectedValues.add(value));
    this._updateCheckboxes();
  }

  /**
   * Clear all selections
   */
  private _clearAll(): void {
    this._selectedValues.clear();
    this._updateCheckboxes();
  }

  /**
   * Toggle a value selection
   */
  private _toggleValue(value: string, checked: boolean): void {
    if (checked) {
      this._selectedValues.add(value);
    } else {
      this._selectedValues.delete(value);
    }
  }

  /**
   * Update checkbox states
   */
  private _updateCheckboxes(): void {
    const checkboxes = this.node.querySelectorAll<HTMLInputElement>(
      '.jp-FilterModal-checkbox'
    );
    checkboxes.forEach(cb => {
      const value = cb.dataset.value || '';
      cb.checked = this._selectedValues.has(value);
    });
  }

  /**
   * Apply filter and close modal
   */
  private _apply(): void {
    const values = Array.from(this._selectedValues);
    this._onApply(values.length > 0 ? values : null);
    this.close();
  }

  /**
   * Setup event listeners for closing the modal
   */
  private _setupEventListeners(): void {
    // Close on ESC key
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        this.close();
      }
    };
    document.addEventListener('keydown', handleKeydown);
    this.disposed.connect(() => {
      document.removeEventListener('keydown', handleKeydown);
    });

    // Close on backdrop click
    this.node.addEventListener('click', (event: MouseEvent) => {
      if (event.target === this.node) {
        this.close();
      }
    });
  }

  /**
   * Show the modal
   */
  show(): void {
    Widget.attach(this, document.body);
    this.node.focus();
  }

  /**
   * Close and dispose the modal
   */
  close(): void {
    this.dispose();
  }
}
