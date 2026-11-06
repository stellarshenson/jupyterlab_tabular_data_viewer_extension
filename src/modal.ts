import { Widget } from '@lumino/widgets';
import { IColumnStats, IUniqueValues } from './request';

/**
 * Modal dialog widget for displaying column statistics
 */
export class ColumnStatsModal extends Widget {
  private _stats: IColumnStats;
  private _uniqueValues: IUniqueValues | null;
  private _dialog!: HTMLElement;
  private _returnFocus: HTMLElement | null = null;

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
    const dialog = document.createElement('div');
    dialog.className = 'jp-ColumnStatsModal-content';
    dialog.setAttribute('data-testid', 'stats-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Column statistics');
    dialog.tabIndex = -1;
    this._dialog = dialog;

    dialog.appendChild(this._renderHeader());

    const body = document.createElement('div');
    body.className = 'jp-ColumnStatsModal-body';

    const stats = document.createElement('div');
    stats.className = 'jp-ColumnStatsModal-stats';
    stats.appendChild(this._renderTiles());
    stats.appendChild(this._renderPanel());

    body.appendChild(stats);
    body.appendChild(this._renderValues());
    dialog.appendChild(body);
    this.node.appendChild(dialog);
  }

  /**
   * Header: column name, data type chip, copy and close actions
   */
  private _renderHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'jp-ColumnStatsModal-header';

    const title = document.createElement('h3');
    title.textContent = this._stats.column_name;

    const chip = document.createElement('span');
    chip.className = 'jp-ColumnStatsModal-chip';
    chip.textContent = this._simplifyType(this._stats.data_type);

    const actions = document.createElement('div');
    actions.className = 'jp-ColumnStatsModal-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'jp-ColumnStatsModal-copy';
    copyBtn.setAttribute('data-testid', 'copy-stats');
    copyBtn.textContent = 'Copy stats as JSON';
    copyBtn.onclick = () => this._copyStatsAsJson(copyBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'jp-ColumnStatsModal-close';
    closeBtn.setAttribute('data-testid', 'close-stats');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    closeBtn.onclick = () => this.close();

    actions.appendChild(copyBtn);
    actions.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(chip);
    header.appendChild(actions);
    return header;
  }

  /**
   * Summary tiles: total, non-null, null and unique counts
   */
  private _renderTiles(): HTMLElement {
    const tiles = document.createElement('div');
    tiles.className = 'jp-ColumnStatsModal-tiles';
    tiles.setAttribute('data-testid', 'stats-tiles');

    const share = (percentage: number): string => `${percentage.toFixed(1)}%`;
    const uniqueShare =
      this._stats.non_null_count > 0
        ? (this._stats.unique_count / this._stats.non_null_count) * 100
        : 0;

    tiles.appendChild(
      this._tile(
        'Total rows',
        this._formatNumber(this._stats.total_rows),
        `${share(100)} of all rows`
      )
    );
    tiles.appendChild(
      this._tile(
        'Non-null',
        this._formatNumber(this._stats.non_null_count),
        `${share(this._stats.non_null_percentage)} of all rows`
      )
    );
    tiles.appendChild(
      this._tile(
        'Null',
        this._formatNumber(this._stats.null_count),
        `${share(this._stats.null_percentage)} of all rows`
      )
    );
    tiles.appendChild(
      this._tile(
        this._stats.binary_placeholder === true
          ? 'Unique (as shown)'
          : 'Unique (non-null)',
        this._formatNumber(this._stats.unique_count),
        `${share(uniqueShare)} of non-null values`
      )
    );
    return tiles;
  }

  /**
   * One summary tile
   */
  private _tile(label: string, value: string, sub: string): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'jp-ColumnStatsModal-tile';

    const key = document.createElement('div');
    key.className = 'jp-ColumnStatsModal-tileLabel';
    key.textContent = label;

    const valueEl = document.createElement('div');
    valueEl.className = 'jp-ColumnStatsModal-tileValue';
    valueEl.textContent = value;

    const subEl = document.createElement('div');
    subEl.className = 'jp-ColumnStatsModal-tileSub';
    subEl.textContent = sub;

    tile.appendChild(key);
    tile.appendChild(valueEl);
    tile.appendChild(subEl);
    return tile;
  }

  /**
   * Type-specific statistics block below the tiles
   */
  private _renderPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'jp-ColumnStatsModal-panel';
    panel.setAttribute('data-testid', 'stats-panel');

    const stats = this._stats;
    const type = stats.data_type;

    if (stats.non_null_count === 0) {
      panel.appendChild(this._note('The column has no values.'));
    } else if (type === 'boolean') {
      const total = stats.non_null_count;
      panel.appendChild(this._heading('Boolean'));
      if (stats.true_count !== undefined && stats.true_count !== null) {
        panel.appendChild(
          this._row('true', 'True', this._countShare(stats.true_count, total))
        );
      }
      if (stats.false_count !== undefined && stats.false_count !== null) {
        panel.appendChild(
          this._row(
            'false',
            'False',
            this._countShare(stats.false_count, total)
          )
        );
      }
    } else if (type === 'date') {
      panel.appendChild(this._heading('Date range'));
      this._appendDateRows(panel);
    } else if (type === 'datetime') {
      panel.appendChild(this._heading('Date and time range'));
      this._appendDateRows(panel);
      if (stats.time_of_day_min && stats.time_of_day_max) {
        panel.appendChild(
          this._row(
            'time_of_day',
            'Time of day',
            `${stats.time_of_day_min} to ${stats.time_of_day_max}`
          )
        );
      }
    } else if (type.startsWith('time')) {
      panel.appendChild(this._heading('Time range'));
      if (stats.earliest_time) {
        panel.appendChild(
          this._row('earliest', 'Earliest', stats.earliest_time)
        );
      }
      if (stats.latest_time) {
        panel.appendChild(this._row('latest', 'Latest', stats.latest_time));
      }
      if (
        stats.time_range_seconds !== undefined &&
        stats.time_range_seconds !== null
      ) {
        panel.appendChild(
          this._row(
            'span',
            'Span',
            this._formatSeconds(stats.time_range_seconds)
          )
        );
      }
    } else if (
      type === 'int' ||
      type === 'float' ||
      type.startsWith('decimal') ||
      type.startsWith('duration')
    ) {
      this._appendNumericPanel(panel);
    } else if (type === 'string') {
      this._appendTextPanel(panel);
      if (stats.min_value !== undefined && stats.min_value !== null) {
        this._appendNumericPanel(panel);
      }
    } else {
      panel.appendChild(
        this._note('No statistics are computed for this column.')
      );
    }
    return panel;
  }

  /**
   * Shared earliest, latest and span rows for date and datetime columns
   */
  private _appendDateRows(panel: HTMLElement): void {
    const stats = this._stats;
    if (stats.earliest_date) {
      panel.appendChild(this._row('earliest', 'Earliest', stats.earliest_date));
    }
    if (stats.latest_date) {
      panel.appendChild(this._row('latest', 'Latest', stats.latest_date));
    }
    if (stats.date_range_days !== undefined && stats.date_range_days !== null) {
      const days = stats.date_range_days;
      panel.appendChild(
        this._row(
          'span',
          'Span',
          `${this._formatNumber(days)} ${days === 1 ? 'day' : 'days'}`
        )
      );
    }
  }

  /**
   * Distribution block with quartiles, outliers and a box plot
   */
  private _appendNumericPanel(panel: HTMLElement): void {
    const stats = this._stats;
    panel.appendChild(this._heading('Distribution'));

    const add = (key: string, label: string, value?: number): void => {
      if (value !== undefined && value !== null) {
        panel.appendChild(this._row(key, label, this._formatNumeric(value)));
      }
    };

    add('min', 'Min', stats.min_value);
    add('q1', 'Q1', stats.q1);
    add('median', 'Median', stats.median);
    add('q3', 'Q3', stats.q3);
    add('max', 'Max', stats.max_value);
    add('mean', 'Mean', stats.mean);
    add('std_dev', 'Std dev', stats.std_dev);

    if (stats.outlier_count !== undefined && stats.outlier_count !== null) {
      const percentage = stats.outlier_percentage ?? 0;
      panel.appendChild(
        this._row(
          'outliers',
          'Outliers',
          `${this._formatNumber(stats.outlier_count)} (${percentage}% of non-null)`
        )
      );
    }

    if (
      stats.min_value !== undefined &&
      stats.min_value !== null &&
      stats.max_value !== undefined &&
      stats.max_value !== null &&
      stats.min_value !== stats.max_value &&
      stats.q1 !== undefined &&
      stats.q1 !== null &&
      stats.median !== undefined &&
      stats.median !== null &&
      stats.q3 !== undefined &&
      stats.q3 !== null &&
      stats.mean !== undefined &&
      stats.mean !== null
    ) {
      panel.appendChild(
        this._boxPlot(
          stats.min_value,
          stats.q1,
          stats.median,
          stats.q3,
          stats.max_value,
          stats.mean
        )
      );
      panel.appendChild(this._boxLegend());
    }
  }

  /**
   * Text block for string columns, including nested columns served as text
   */
  private _appendTextPanel(panel: HTMLElement): void {
    const stats = this._stats;
    panel.appendChild(this._heading('Text'));

    if (
      stats.most_common_value !== undefined &&
      stats.most_common_count !== undefined &&
      stats.most_common_count !== null
    ) {
      const value = stats.most_common_value || '(empty)';
      panel.appendChild(
        this._row(
          'most_common',
          'Most common',
          `${value} (${this._formatNumber(stats.most_common_count)})`
        )
      );
    }
    if (stats.top_share !== undefined && stats.top_share !== null) {
      panel.appendChild(
        this._row('top_share', 'Top share', `${stats.top_share.toFixed(1)}%`)
      );
    }
    if (stats.min_length !== undefined && stats.min_length !== null) {
      panel.appendChild(
        this._row(
          'min_length',
          'Min length',
          this._formatNumber(stats.min_length)
        )
      );
    }
    if (stats.max_length !== undefined && stats.max_length !== null) {
      panel.appendChild(
        this._row(
          'max_length',
          'Max length',
          this._formatNumber(stats.max_length)
        )
      );
    }
    if (stats.avg_length !== undefined && stats.avg_length !== null) {
      panel.appendChild(
        this._row('avg_length', 'Avg length', stats.avg_length.toFixed(1))
      );
    }
  }

  /**
   * Unique values pane: heading, column headers and the scrolling rows
   */
  private _renderValues(): HTMLElement {
    const valuesPane = document.createElement('div');
    valuesPane.className = 'jp-ColumnStatsModal-values';

    const values = this._stats.non_null_count === 0 ? null : this._uniqueValues;
    const shown = values ? values.values.length : 0;
    const total = values ? values.total_count : 0;
    const valuesLabel =
      this._stats.binary_placeholder === true
        ? 'Unique values (as shown)'
        : 'Unique values';

    const head = document.createElement('div');
    head.className = 'jp-ColumnStatsModal-valuesHead';
    const heading = document.createElement('h4');
    heading.textContent = valuesLabel;
    const note = document.createElement('span');
    note.className = 'jp-ColumnStatsModal-valuesNote';
    note.textContent = `${shown} of ${total} listed rows · ranked by count`;
    head.appendChild(heading);
    head.appendChild(note);
    valuesPane.appendChild(head);

    const columns = document.createElement('div');
    columns.className = 'jp-ColumnStatsModal-valueCols';
    columns.setAttribute('aria-hidden', 'true');
    for (const label of ['Value', 'Share', 'Count', '%']) {
      const column = document.createElement('span');
      column.textContent = label;
      columns.appendChild(column);
    }
    valuesPane.appendChild(columns);

    const scroll = document.createElement('div');
    scroll.className = 'jp-ColumnStatsModal-valuesScroll';
    scroll.setAttribute('data-testid', 'unique-values');
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', valuesLabel);
    scroll.tabIndex = 0;

    if (!values || values.values.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'jp-ColumnStatsModal-empty';
      empty.textContent = 'No values to list';
      scroll.appendChild(empty);
    } else {
      const maxCount = values.counts.reduce(
        (largest, count) => Math.max(largest, count),
        1
      );
      values.values.forEach((value, index) => {
        const count = values.counts[index];
        const percentage =
          this._stats.total_rows > 0
            ? ((count / this._stats.total_rows) * 100).toFixed(2)
            : '0.00';

        const row = document.createElement('div');
        row.className = 'jp-ColumnStatsModal-valueRow';
        row.setAttribute('data-testid', 'unique-value-row');

        const name = document.createElement('span');
        name.className = 'jp-ColumnStatsModal-value';
        name.textContent = value === '' ? '(empty)' : value;

        const track = document.createElement('span');
        track.className = 'jp-ColumnStatsModal-track';
        const fill = document.createElement('span');
        fill.className = 'jp-ColumnStatsModal-fill';
        fill.style.width = `${(count / maxCount) * 100}%`;
        track.appendChild(fill);

        const countEl = document.createElement('span');
        countEl.className = 'jp-ColumnStatsModal-valueCount';
        countEl.textContent = this._formatNumber(count);

        const percentageEl = document.createElement('span');
        percentageEl.className = 'jp-ColumnStatsModal-valuePct';
        percentageEl.textContent = `${percentage}%`;

        row.appendChild(name);
        row.appendChild(track);
        row.appendChild(countEl);
        row.appendChild(percentageEl);
        scroll.appendChild(row);
      });
    }

    valuesPane.appendChild(scroll);
    return valuesPane;
  }

  /**
   * Small heading inside the statistics panel
   */
  private _heading(text: string): HTMLElement {
    const heading = document.createElement('h4');
    heading.textContent = text;
    return heading;
  }

  /**
   * One label/value row inside the statistics panel
   */
  private _row(key: string, label: string, value: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'jp-ColumnStatsModal-row';
    row.setAttribute('data-testid', `stats-panel-row-${key}`);

    const keyEl = document.createElement('span');
    keyEl.className = 'jp-ColumnStatsModal-rowLabel';
    keyEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.className = 'jp-ColumnStatsModal-rowValue';
    valueEl.textContent = value;

    row.appendChild(keyEl);
    row.appendChild(valueEl);
    return row;
  }

  /**
   * Muted line shown when a type block has no statistics
   */
  private _note(text: string): HTMLElement {
    const note = document.createElement('p');
    note.className = 'jp-ColumnStatsModal-note';
    note.textContent = text;
    return note;
  }

  /**
   * Horizontal box plot: axis spans min to max, box spans Q1 to Q3, the
   * median is a solid line and the mean a dotted one
   */
  private _boxPlot(
    min: number,
    q1: number,
    median: number,
    q3: number,
    max: number,
    mean: number
  ): HTMLElement {
    const plot = document.createElement('div');
    plot.className = 'jp-ColumnStatsModal-boxplot';
    plot.setAttribute('data-testid', 'boxplot');
    plot.setAttribute('aria-hidden', 'true');

    const span = max - min || 1;
    const at = (value: number): number => ((value - min) / span) * 100;

    const axis = document.createElement('span');
    axis.className = 'jp-ColumnStatsModal-axis';

    const box = document.createElement('span');
    box.className = 'jp-ColumnStatsModal-box';
    box.style.left = `${at(q1)}%`;
    box.style.width = `${at(q3) - at(q1)}%`;

    const medianLine = document.createElement('span');
    medianLine.className = 'jp-ColumnStatsModal-median';
    medianLine.style.left = `calc(${at(median)}% - 1px)`;

    const meanLine = document.createElement('span');
    meanLine.className = 'jp-ColumnStatsModal-mean';
    meanLine.style.left = `calc(${at(mean)}% - 1px)`;

    plot.appendChild(axis);
    plot.appendChild(box);
    plot.appendChild(medianLine);
    plot.appendChild(meanLine);
    return plot;
  }

  /**
   * Legend naming the median and mean lines of the box plot
   */
  private _boxLegend(): HTMLElement {
    const legend = document.createElement('div');
    legend.className = 'jp-ColumnStatsModal-boxlegend';

    const median = document.createElement('span');
    const medianKey = document.createElement('span');
    medianKey.className = 'jp-ColumnStatsModal-key';
    median.appendChild(medianKey);
    median.appendChild(document.createTextNode('median'));

    const mean = document.createElement('span');
    const meanKey = document.createElement('span');
    meanKey.className = 'jp-ColumnStatsModal-key jp-ColumnStatsModal-keyMean';
    mean.appendChild(meanKey);
    mean.appendChild(document.createTextNode('mean'));

    legend.appendChild(median);
    legend.appendChild(mean);
    return legend;
  }

  /**
   * Format a count with its share of the non-null values
   */
  private _countShare(count: number, total: number): string {
    const percentage = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
    return `${this._formatNumber(count)} (${percentage}% of non-null)`;
  }

  /**
   * Simplify a type label the way the grid header does.
   *
   * The backend already reports int, float, string, binary, date, datetime and
   * boolean simplified; these three are the ones it passes through as the raw
   * arrow type string.
   */
  private _simplifyType(type: string): string {
    const lowerType = type.toLowerCase();
    if (lowerType.includes('decimal')) {
      return 'decimal';
    }
    if (lowerType.startsWith('list')) {
      return 'list';
    }
    if (lowerType.startsWith('struct')) {
      return 'struct';
    }
    return type;
  }

  /**
   * Format number with thousands separator
   */
  private _formatNumber(num: number): string {
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  /**
   * A statistic whose unit is the duration's own unit
   */
  private _formatNumeric(value: number): string {
    return this._isDuration()
      ? this._formatDuration(value)
      : this._formatNumber(value);
  }

  /**
   * Whether the column is an Arrow duration, whose statistics are integers
   * counted in the unit named by data_type
   */
  private _isDuration(): boolean {
    return this._stats.data_type.startsWith('duration');
  }

  /**
   * Microseconds in one unit of the column's duration type
   */
  private _durationUnitMicroseconds(): number {
    const match = /^duration\[(\w+)\]$/.exec(this._stats.data_type);
    switch (match?.[1]) {
      case 'ns':
        return 1e-3;
      case 'ms':
        return 1e3;
      case 's':
        return 1e6;
      default:
        return 1;
    }
  }

  /**
   * Format an integer count of the column's duration unit as Python's
   * str(timedelta) does, negative values normalised into days too
   */
  private _formatDuration(value: number): string {
    if (this._stats.data_type === 'duration[ns]') {
      return this._formatNanoseconds(value);
    }
    const total = Math.round(value * this._durationUnitMicroseconds());
    const day = 86400000000;
    const days = Math.floor(total / day);
    const rest = total - days * day;
    const seconds = Math.floor(rest / 1e6);
    const micros = rest - seconds * 1e6;
    let text = `${Math.floor(seconds / 3600)}:${String(
      Math.floor((seconds % 3600) / 60)
    ).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    if (days !== 0) {
      text = `${days} day${Math.abs(days) === 1 ? '' : 's'}, ${text}`;
    }
    if (micros !== 0) {
      text += `.${String(micros).padStart(6, '0')}`;
    }
    return text;
  }

  /**
   * Format an integer count of nanoseconds as the grid shows it.
   *
   * The rows path converts a duration[ns] cell through pandas' Timedelta, whose
   * text keeps all nine fractional digits and normalises a negative value into
   * negative days plus a positive time of day.
   */
  private _formatNanoseconds(value: number): string {
    const day = 86400000000000;
    const total = Math.round(value);
    const days = Math.floor(total / day);
    const rest = total - days * day;
    const seconds = Math.floor(rest / 1e9);
    const nanos = rest - seconds * 1e9;
    const time = `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(
      Math.floor((seconds % 3600) / 60)
    ).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    let text = `${days} days ${days < 0 ? '+' : ''}${time}`;
    if (nanos !== 0) {
      text += `.${String(nanos).padStart(9, '0')}`;
    }
    return text;
  }

  /**
   * Format seconds as H:MM:SS, keeping fractional seconds when present
   */
  private _formatSeconds(seconds: number): string {
    const sign = seconds < 0 ? '-' : '';
    const total = Math.round(Math.abs(seconds) * 1e6);
    const whole = Math.floor(total / 1e6);
    const micros = total % 1e6;
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const remainder = whole % 60;
    let text = `${sign}${hours}:${String(minutes).padStart(2, '0')}:${String(
      remainder
    ).padStart(2, '0')}`;
    if (micros !== 0) {
      text += `.${String(micros).padStart(6, '0')}`;
    }
    return text;
  }

  /**
   * Copy statistics as JSON to clipboard
   */
  private async _copyStatsAsJson(button: HTMLButtonElement): Promise<void> {
    const originalText = button.textContent;
    try {
      const json = JSON.stringify(this._stats, null, 2);
      await navigator.clipboard.writeText(json);
      // Provide visual feedback
      button.textContent = 'Copied!';
      setTimeout(() => {
        button.textContent = originalText;
      }, 2000);
    } catch (error) {
      console.error('Failed to copy stats to clipboard:', error);
      button.textContent = 'Copy failed';
      setTimeout(() => {
        button.textContent = originalText;
      }, 2000);
    }
  }

  /**
   * Setup event listeners for closing the modal
   */
  private _setupEventListeners(): void {
    // Close on ESC, and cycle Tab inside the dialog
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        this.close();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const focusable = Array.from(
        this._dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      // The dialog itself is focusable but not part of the cycle, so Shift+Tab
      // from it must wrap to the last control instead of leaving the overlay.
      const inside = active !== this._dialog && this._dialog.contains(active);
      if (event.shiftKey) {
        if (active === first || !inside) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !inside) {
        event.preventDefault();
        first.focus();
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
    this._returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    Widget.attach(this, document.body);
    this._dialog.focus();
  }

  /**
   * Close and dispose the modal
   */
  close(): void {
    const returnFocus = this._returnFocus;
    this._returnFocus = null;
    this.dispose();
    returnFocus?.focus();
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

/**
 * Modal dialog widget for selecting download format
 */
export class DownloadModal extends Widget {
  private _onDownload: (format: string) => void;
  private _hasFilters: boolean;
  private _canExportOriginal: boolean;

  constructor(
    onDownload: (format: string) => void,
    hasFilters = false,
    canExportOriginal = true
  ) {
    super();
    this._onDownload = onDownload;
    this._hasFilters = hasFilters;
    this._canExportOriginal = canExportOriginal;
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

    // Header with title and close button
    const header = document.createElement('div');
    header.className = 'jp-FilterModal-header';
    const title = document.createElement('h3');
    title.textContent = 'Export';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'jp-FilterModal-close';
    closeBtn.textContent = '×';
    closeBtn.onclick = () => this.close();
    header.appendChild(title);
    header.appendChild(closeBtn);
    content.appendChild(header);

    // Filter notice (only when filters are active)
    if (this._hasFilters) {
      const notice = document.createElement('div');
      notice.className = 'jp-FilterModal-notice';
      notice.textContent =
        'Filters are active - export will include only the filtered rows.';
      content.appendChild(notice);
    }

    // Format buttons
    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'jp-FilterModal-buttons';

    // Omitted for sources the backend cannot write back out (e.g. SQLite)
    if (this._canExportOriginal) {
      const originalBtn = this._createFormatButton(
        'Download as Original Format',
        'original'
      );
      buttonsDiv.appendChild(originalBtn);
    }

    const excelBtn = this._createFormatButton(
      'Download as Excel (.xlsx)',
      'xlsx'
    );
    buttonsDiv.appendChild(excelBtn);

    const csvBtn = this._createFormatButton('Download as CSV', 'csv');
    buttonsDiv.appendChild(csvBtn);

    const parquetBtn = this._createFormatButton(
      'Download as Parquet (.parquet)',
      'parquet'
    );
    buttonsDiv.appendChild(parquetBtn);

    const jsonlBtn = this._createFormatButton(
      'Download as JSONL (.jsonl)',
      'jsonl'
    );
    buttonsDiv.appendChild(jsonlBtn);

    content.appendChild(buttonsDiv);

    // Cancel button
    const cancelDiv = document.createElement('div');
    cancelDiv.className = 'jp-FilterModal-footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'jp-FilterModal-button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => this.close();
    cancelDiv.appendChild(cancelBtn);
    content.appendChild(cancelDiv);

    this.node.appendChild(content);
  }

  /**
   * Create a format button
   */
  private _createFormatButton(
    label: string,
    format: string
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'jp-FilterModal-button';
    btn.textContent = label;
    btn.onclick = () => {
      this._onDownload(format);
      this.close();
    };
    return btn;
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
