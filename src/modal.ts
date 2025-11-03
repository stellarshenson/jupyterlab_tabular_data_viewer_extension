import { Widget } from '@lumino/widgets';
import { IColumnStats } from './request';

/**
 * Modal dialog widget for displaying column statistics
 */
export class ColumnStatsModal extends Widget {
  private _stats: IColumnStats;

  constructor(stats: IColumnStats) {
    super();
    this._stats = stats;
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
    copyBtn.className = 'jp-ColumnStatsModal-copyButton';
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
        items.push(`Outliers (IQR×1.5): ${this._formatNumber(this._stats.outlier_count)} (${this._stats.outlier_percentage}%)`);
      }

      numericList.innerHTML = items.map(item => `<li>${item}</li>`).join('');
      numericSection.appendChild(numericList);
      content.appendChild(numericSection);
    }

    // String statistics
    if (this._stats.data_type === 'string') {
      const items: string[] = [];

      if (this._stats.most_common_value !== undefined) {
        items.push(`Most common: "${this._stats.most_common_value}" (${this._stats.most_common_count})`);
      }
      if (this._stats.min_length !== undefined) {
        items.push(`Min length: ${this._stats.min_length} characters`);
      }
      if (this._stats.max_length !== undefined) {
        items.push(`Max length: ${this._stats.max_length} characters`);
      }
      if (this._stats.avg_length !== undefined) {
        items.push(`Avg length: ${this._formatNumber(this._stats.avg_length)} characters`);
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
    if (this._stats.data_type === 'date' || this._stats.data_type === 'datetime') {
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
        items.push(`Span: ${this._formatNumber(this._stats.date_range_days)} days`);
      }

      dateList.innerHTML = items.map(item => `<li>${item}</li>`).join('');
      dateSection.appendChild(dateList);
      content.appendChild(dateSection);
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
      const btn = this.node.querySelector('.jp-ColumnStatsModal-copyButton');
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
