import { expect, galata, test } from '@jupyterlab/galata';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Viewer inside the currently visible main area widget
 */
const activeViewer = (page: any) =>
  page.locator('.jp-MainAreaWidget:not(.lm-mod-hidden) .jp-TabularDataViewer');

/**
 * Data rows currently rendered in the grid
 */
const gridRows = (viewer: any) =>
  viewer.locator('.jp-TabularDataViewer-tbody .jp-TabularDataViewer-row');

/**
 * Budget for anything that waits on a fetched grid.
 *
 * Opening a file is not instant: JupyterLab resolves the document context
 * (which pulls the file through /api/contents) before the widget initialises,
 * and only then does the metadata + data round trip run. Measured at ~19s for
 * the widget alone on a developer machine, and CI runners are slower, so a
 * 15s budget failed with 0 rows while the request was still in flight.
 */
const GRID_TIMEOUT = 60000;

/**
 * Wait until the grid has settled - either rows arrived, or an error row did.
 *
 * Waiting on the error row too means a genuine backend failure surfaces as the
 * assertion that follows rather than as a bare timeout.
 */
async function waitForGridReady(viewer: any): Promise<void> {
  await expect
    .poll(
      async () => {
        const rows = await gridRows(viewer).count();
        const errors = await viewer
          .locator('.jp-TabularDataViewer-error')
          .count();
        return rows + errors;
      },
      { timeout: GRID_TIMEOUT }
    )
    .toBeGreaterThan(0);
}

/**
 * Channel bytes and alpha of a computed CSS colour.
 *
 * Chromium serializes a resolved color-mix() as color(srgb ...); older engines
 * return the rgb()/rgba() form. Both parse to the same channel bytes.
 */
function splitColor(value: string): { rgb: number[]; alpha: number } {
  const srgb = value.match(
    /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+) \/ ([\d.]+)\)$/
  );
  if (srgb) {
    return {
      rgb: srgb.slice(1, 4).map(channel => Math.round(Number(channel) * 255)),
      alpha: Number(srgb[4])
    };
  }
  const rgb = value.match(/^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/);
  if (!rgb) {
    throw new Error(`unexpected colour serialization: ${value}`);
  }
  return {
    rgb: rgb.slice(1, 4).map(Number),
    alpha: rgb[4] === undefined ? 1 : Number(rgb[4])
  };
}

/**
 * Sheet/table tab with an exact label
 */
const sheetTab = (viewer: any, name: string) =>
  viewer.locator('.jp-TabularDataViewer-sheetTab', {
    hasText: new RegExp(`^${name}$`)
  });

/**
 * Column names in grid order. The first header cell is the row-number
 * column, which carries the same class with empty text - drop it.
 */
async function columnNames(viewer: any): Promise<string[]> {
  const names = await viewer
    .locator('.jp-TabularDataViewer-columnName')
    .allTextContents();
  return names.slice(1);
}

/**
 * Open a file from the file browser and wait for the viewer to appear.
 *
 * `openWith` names an "Open With" submenu entry, needed for formats another
 * factory owns by default - a double-clicked .csv opens JupyterLab's own CSV
 * viewer, not this one.
 */
async function openInViewer(
  page: any,
  fileName: string,
  openWith?: string
): Promise<any> {
  const item = page
    .locator('.jp-DirListing-content')
    .getByText(fileName, { exact: true });
  await item.waitFor({ state: 'visible', timeout: 30000 });

  if (openWith) {
    await item.click({ button: 'right' });
    await page.waitForSelector('.lm-Menu-content', { timeout: 15000 });
    await page.click('text=Open With');
    await page.waitForSelector(`text=${openWith}`, { timeout: 15000 });
    await page.click(`text=${openWith}`);
  } else {
    await item.dblclick();
  }

  const viewer = activeViewer(page);
  await viewer.waitFor({ state: 'visible', timeout: GRID_TIMEOUT });
  await waitForGridReady(viewer);
  return viewer;
}

/**
 * Open the statistics dialog for a column and return it.
 *
 * The info icon sits in the column header; the dialog renders under
 * `document.body`, outside the viewer, so it is looked up on the page.
 */
async function openStatsDialog(
  page: any,
  viewer: any,
  column: string
): Promise<any> {
  const header = viewer.locator('.jp-TabularDataViewer-headerCell', {
    hasText: column
  });
  await header.locator('.jp-TabularDataViewer-infoIcon').click();
  const dialog = page.locator('[data-testid="stats-dialog"]');
  await expect(dialog).toBeVisible({ timeout: GRID_TIMEOUT });
  return dialog;
}

/**
 * The keyboard-focusable statistics control in a column header
 */
const statsControl = (viewer: any, column: string) =>
  viewer
    .locator('.jp-TabularDataViewer-headerCell', { hasText: column })
    .locator('.jp-TabularDataViewer-infoIcon');

/**
 * Open the committed adaptive-types fixture and the statistics dialog for one
 * of its columns.
 */
async function openAdaptiveStats(page: any, column: string): Promise<any> {
  const viewer = await openInViewer(page, 'adaptive_types.parquet');
  return openStatsDialog(page, viewer, column);
}

/**
 * The value cell of one statistics panel row
 */
const panelValue = (panel: any, key: string) =>
  panel.locator(
    `[data-testid="stats-panel-row-${key}"] .jp-ColumnStatsModal-rowValue`
  );

/**
 * Assert the four summary tiles, in order, as [label, value] pairs
 */
async function expectTiles(
  dialog: any,
  expected: [string, string][]
): Promise<void> {
  const tiles = dialog.locator('.jp-ColumnStatsModal-tile');
  await expect(tiles).toHaveCount(expected.length);
  for (let i = 0; i < expected.length; i++) {
    await expect(
      tiles.nth(i).locator('.jp-ColumnStatsModal-tileLabel')
    ).toHaveText(expected[i][0]);
    await expect(
      tiles.nth(i).locator('.jp-ColumnStatsModal-tileValue')
    ).toHaveText(expected[i][1]);
  }
}

/**
 * One page of rows, as shipped: the `rowsPerPage` setting's default.
 *
 * Every export assertion below is a comparison against this - an export that
 * returned only what the grid shows would come back with this many rows.
 */
const PAGE_SIZE = 500;

/**
 * Committed fixtures, uploaded into the test's tmpPath before every test
 */
const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');

/**
 * The settings plugin id, as the schema registers it
 */
const PLUGIN_ID =
  '@stellarshenson/jupyterlab-tabular-data-viewer-extension:plugin';

/**
 * Trigger one export from the export popup and save it to a local file.
 *
 * The caller owns the file and must delete it. Two things read the payload back
 * - a row count and, for text formats, the content itself - and both need the
 * bytes that actually arrived rather than the request that asked for them.
 */
async function exportToFile(
  page: any,
  viewer: any,
  buttonLabel: string
): Promise<{ target: string; filename: string }> {
  await viewer.locator('.jp-TabularDataViewer-exportLink').click();
  // `.jp-FilterModal` is shared with the column filter modal, so scope to the
  // format buttons - only the export popup renders that container.
  const formats = page.locator('.jp-FilterModal .jp-FilterModal-buttons');
  await expect(formats).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: GRID_TIMEOUT }),
    formats.getByRole('button', { name: buttonLabel, exact: true }).click()
  ]);

  const filename = download.suggestedFilename();
  const target = path.join(os.tmpdir(), `export_${process.pid}_${filename}`);
  await download.saveAs(target);
  return { target, filename };
}

/**
 * Trigger one export from the export popup and count the rows that arrive.
 *
 * The download lands as bytes, so the only honest check that an export covered
 * the whole table is to parse the payload back; `scripts/count_rows.py`
 * dispatches on the extension the server put in Content-Disposition.
 */
async function exportRowCount(
  page: any,
  viewer: any,
  buttonLabel: string
): Promise<{ rows: number; filename: string }> {
  const { target, filename } = await exportToFile(page, viewer, buttonLabel);

  const counter = path.resolve(
    __dirname,
    '..',
    '..',
    'scripts',
    'count_rows.py'
  );
  const rows = parseInt(
    execFileSync('python3', [counter, target], { encoding: 'utf8' }).trim(),
    10
  );
  fs.unlinkSync(target);
  return { rows, filename };
}

/**
 * Trigger one export and return its payload decoded as UTF-8 text.
 *
 * For the text formats only. Row counts prove an export's extent; this exists
 * for the cases where the cell values themselves are the claim.
 */
async function exportText(
  page: any,
  viewer: any,
  buttonLabel: string
): Promise<{ text: string; filename: string }> {
  const { target, filename } = await exportToFile(page, viewer, buttonLabel);
  const text = fs.readFileSync(target, 'utf8');
  fs.unlinkSync(target);
  return { text, filename };
}

test.describe('Tabular Data Viewer Extension', () => {
  test.beforeEach(async ({ page, request, tmpPath }) => {
    // Upload test data files for this test
    const contents = galata.newContentsHelper(request);
    const testFiles = [
      'sample_data.parquet',
      'sample_data.csv',
      'sample_data.xlsx',
      'sample_database.db',
      'blob_sample.db',
      'typed_columns.parquet',
      'adaptive_types.parquet',
      'activity_stats.parquet'
    ];

    // Upload into tmpPath - that is the directory the galata file browser opens
    for (const filename of testFiles) {
      const filePath = path.join(DATA_DIR, filename);
      await contents.uploadFile(filePath, `${tmpPath}/${filename}`);
    }

    // Navigate to JupyterLab
    await page.goto();

    // Wait for JupyterLab to be fully loaded
    await page.waitForSelector('#jupyterlab-splash', {
      state: 'detached',
      timeout: 30000
    });

    // Ensure file browser is visible - click the file browser tab if needed
    const fileBrowserTab = page.locator('.jp-SideBar .jp-FileBrowser-tab');
    if (await fileBrowserTab.isVisible()) {
      await fileBrowserTab.click();
    }

    // Open tmpPath explicitly rather than trusting where `page.goto()` lands.
    // It does not land in the same place everywhere: locally the browser opens
    // inside tmpPath, on CI it opens at the server root with tmpPath shown as a
    // folder. That divergence is why uploading to the root passed CI while
    // failing locally, and uploading to tmpPath did the reverse.
    //
    // Home first: openDirectory walks path segments from wherever the browser
    // currently is, so from inside tmpPath it would look for tmpPath/tmpPath.
    // Starting from a known directory makes this deterministic in both.
    await page.filebrowser.openHomeDirectory();
    await page.filebrowser.openDirectory(tmpPath);
    await expect(
      page.locator('.jp-DirListing-content').getByText(testFiles[0], {
        exact: true
      })
    ).toBeVisible({ timeout: 30000 });
  });

  test('should emit an activation console message', async ({ page }) => {
    const logs: string[] = [];

    page.on('console', message => {
      logs.push(message.text());
    });

    await page.goto();

    expect(
      logs.filter(
        s =>
          s ===
          'JupyterLab extension @stellarshenson/jupyterlab-tabular-data-viewer-extension is activated!'
      )
    ).toHaveLength(1);
  });

  test('should open and display Parquet file', async ({ page }) => {
    // Wait for file to be visible in file browser
    await page.waitForSelector('text=sample_data.parquet', { timeout: 30000 });

    // Open the Parquet file
    await page.dblclick('text=sample_data.parquet');

    // Verify the viewer opens and is visible in the main area
    await page.waitForSelector(
      '.jp-MainAreaWidget:not(.lm-mod-hidden) .jp-TabularDataViewer',
      {
        state: 'visible',
        timeout: GRID_TIMEOUT
      }
    );
  });

  test('should open and display CSV file', async ({ page }) => {
    // Wait for file to be visible in file browser
    await page.waitForSelector('text=sample_data.csv', { timeout: 30000 });

    // Right-click on the CSV file to open context menu
    await page.click('text=sample_data.csv', { button: 'right' });

    // Wait for context menu to appear and click "Open With" -> "Tabular Data Viewer (Text)"
    await page.waitForSelector('.lm-Menu-content', { timeout: 15000 });
    await page.click('text=Open With');
    await page.waitForSelector('text=Tabular Data Viewer (Text)', {
      timeout: 15000
    });
    await page.click('text=Tabular Data Viewer (Text)');

    // Verify the viewer opens and is visible in the main area
    await page.waitForSelector(
      '.jp-MainAreaWidget:not(.lm-mod-hidden) .jp-TabularDataViewer',
      {
        state: 'visible',
        timeout: GRID_TIMEOUT
      }
    );
  });

  test('should open and display Excel file', async ({ page }) => {
    // Another installed viewer claims .xlsx by default, so name this one.
    await openInViewer(
      page,
      'sample_data.xlsx',
      'Tabular Data Viewer (Binary)'
    );
  });

  test('should open all three file types sequentially', async ({ page }) => {
    const fileTypes = [
      'sample_data.parquet',
      'sample_data.csv',
      'sample_data.xlsx'
    ];

    for (const fileName of fileTypes) {
      // Wait for file to be visible in file browser
      await page.waitForSelector(`text=${fileName}`, { timeout: 30000 });

      // Open the file - use explicit "Open With" where another factory owns
      // the format by default: core JupyterLab for CSV, another installed
      // viewer for XLSX.
      if (fileName.endsWith('.csv') || fileName.endsWith('.xlsx')) {
        const factory = fileName.endsWith('.csv')
          ? 'Tabular Data Viewer (Text)'
          : 'Tabular Data Viewer (Binary)';
        // Right-click to open context menu
        await page.click(`text=${fileName}`, { button: 'right' });
        await page.waitForSelector('.lm-Menu-content', { timeout: 15000 });
        await page.click('text=Open With');
        await page.waitForSelector(`text=${factory}`, {
          timeout: 15000
        });
        await page.click(`text=${factory}`);
      } else {
        // Double-click for other file types
        await page.dblclick(`text=${fileName}`);
      }

      // Verify the viewer opens and is visible in the main area
      await page.waitForSelector(
        '.jp-MainAreaWidget:not(.lm-mod-hidden) .jp-TabularDataViewer',
        {
          state: 'visible',
          timeout: GRID_TIMEOUT
        }
      );

      // Close the tab to prepare for next file
      await page.keyboard.press('Control+w');
      await page.waitForTimeout(500);
    }
  });

  test('should open SQLite database and render rows', async ({ page }) => {
    const viewer = await openInViewer(page, 'sample_database.db');

    // Default table is the first one alphabetically - attachments, 4 rows
    await expect(gridRows(viewer)).toHaveCount(4, { timeout: GRID_TIMEOUT });
    expect(await columnNames(viewer)).toEqual([
      'attachment_id',
      'order_id',
      'filename',
      'content'
    ]);
    await expect(gridRows(viewer).first()).toContainText('invoice_0003.pdf');
  });

  test('should list only user tables in the table bar', async ({ page }) => {
    const viewer = await openInViewer(page, 'sample_database.db');
    await expect(gridRows(viewer)).toHaveCount(4, { timeout: GRID_TIMEOUT });

    const tabs = viewer.locator('.jp-TabularDataViewer-sheetTab');
    await expect(tabs).toHaveText([
      'attachments',
      'customers',
      'mixed_types',
      'orders'
    ]);

    // The system table created by AUTOINCREMENT must never be offered
    expect(await tabs.allTextContents()).not.toContain('sqlite_sequence');
    await expect(sheetTab(viewer, 'sqlite_sequence')).toHaveCount(0);

    await expect(
      viewer.locator('.jp-TabularDataViewer-sheetTab.jp-mod-active')
    ).toHaveText('attachments');
  });

  test('should switch table when a tab is clicked', async ({ page }) => {
    const viewer = await openInViewer(page, 'sample_database.db');
    await expect(gridRows(viewer)).toHaveCount(4, { timeout: GRID_TIMEOUT });

    await sheetTab(viewer, 'orders').click();

    await expect(gridRows(viewer)).toHaveCount(30, { timeout: GRID_TIMEOUT });
    expect(await columnNames(viewer)).toEqual([
      'order_id',
      'customer_id',
      'product',
      'quantity',
      'unit_price',
      'ordered_at'
    ]);
    await expect(
      viewer.locator('.jp-TabularDataViewer-sheetTab.jp-mod-active')
    ).toHaveText('orders');
  });

  test('should reset filters when switching tables', async ({ page }) => {
    const viewer = await openInViewer(page, 'sample_database.db');
    await expect(gridRows(viewer)).toHaveCount(4, { timeout: GRID_TIMEOUT });

    await sheetTab(viewer, 'customers').click();
    await expect(gridRows(viewer)).toHaveCount(12, { timeout: GRID_TIMEOUT });

    // Filter on the primary key so exactly one row survives
    const filterInput = viewer.locator(
      '.jp-TabularDataViewer-filterInput[data-column-name="customer_id"]'
    );
    await filterInput.fill('=1');
    await filterInput.press('Enter');
    await expect(gridRows(viewer)).toHaveCount(1, { timeout: GRID_TIMEOUT });

    await sheetTab(viewer, 'orders').click();
    await expect(gridRows(viewer)).toHaveCount(30, { timeout: GRID_TIMEOUT });

    await sheetTab(viewer, 'customers').click();
    await expect(gridRows(viewer)).toHaveCount(12, { timeout: GRID_TIMEOUT });
    await expect(
      viewer.locator(
        '.jp-TabularDataViewer-filterInput[data-column-name="customer_id"]'
      )
    ).toHaveValue('');
  });

  test('should show the datasource type in the status bar', async ({
    page
  }) => {
    const dbViewer = await openInViewer(page, 'sample_database.db');
    await expect(gridRows(dbViewer)).toHaveCount(4, { timeout: GRID_TIMEOUT });
    await expect(
      dbViewer.locator('.jp-TabularDataViewer-sourceType')
    ).toHaveText('SQLite');
    await expect(
      dbViewer.locator('.jp-TabularDataViewer-statusLeft')
    ).toContainText('SQLite • 4 columns • 4 rows');

    await page.keyboard.press('Control+w');
    await page.waitForTimeout(500);

    const parquetViewer = await openInViewer(page, 'sample_data.parquet');
    await expect(gridRows(parquetViewer).first()).toBeVisible({
      timeout: GRID_TIMEOUT
    });
    await expect(
      parquetViewer.locator('.jp-TabularDataViewer-sourceType')
    ).toHaveText('Parquet');
  });

  test('should render BLOB cells as placeholders', async ({ page }) => {
    const viewer = await openInViewer(page, 'sample_database.db');
    await expect(gridRows(viewer)).toHaveCount(4, { timeout: GRID_TIMEOUT });

    // The attachments table has one BLOB per row in the `content` column
    const blobCells = viewer.locator(
      '.jp-TabularDataViewer-tbody .jp-TabularDataViewer-cell',
      { hasText: '<BLOB' }
    );
    await expect(blobCells).toHaveCount(4);
    await expect(blobCells.first()).toHaveText('<BLOB 256 B>');
  });

  test('should report a BLOB column as binary with its size statistics', async ({
    page
  }) => {
    const viewer = await openInViewer(page, 'blob_sample.db');
    await expect(gridRows(viewer)).toHaveCount(3, { timeout: GRID_TIMEOUT });

    // The SQL still serves the placeholder text, and the header calls the
    // column what it holds rather than what it renders.
    const contentHeader = viewer.locator('.jp-TabularDataViewer-headerCell', {
      hasText: 'content'
    });
    await expect(
      contentHeader.locator('.jp-TabularDataViewer-columnType')
    ).toHaveText('binary');
    const blobCells = viewer.locator(
      '.jp-TabularDataViewer-tbody .jp-TabularDataViewer-cell',
      { hasText: '<BLOB' }
    );
    await expect(blobCells).toHaveCount(3);
    await expect(blobCells.first()).toHaveText('<BLOB 512 B>');

    const dialog = await openStatsDialog(page, viewer, 'content');
    await expect(dialog.locator('.jp-ColumnStatsModal-chip')).toHaveText(
      'binary'
    );
    // Binary is always a single 720px column, pane or no pane.
    expect(Math.round((await dialog.boundingBox())!.width)).toBe(720);
    // No unique tile and no unique pane: the grid shows one placeholder per
    // size, so a distinct count would measure sizes, not contents.
    await expectTiles(dialog, [
      ['Total rows', '3'],
      ['Non-null', '3'],
      ['Null', '0']
    ]);
    await expect(dialog.locator('.jp-ColumnStatsModal-tile')).toHaveCount(3);
    await expect(dialog.locator('[data-testid="unique-values"]')).toHaveCount(
      0
    );

    // The size block reads the bytes the reader measured with length()
    const panel = dialog.locator('[data-testid="stats-panel"]');
    await expect(panel).toContainText('Size');
    await expect(panelValue(panel, 'size_min')).toHaveText('512 B');
    await expect(panelValue(panel, 'size_q1')).toHaveText('768 B');
    await expect(panelValue(panel, 'size_median')).toHaveText('1 KB');
    await expect(panelValue(panel, 'size_q3')).toHaveText('1.5 KB');
    await expect(panelValue(panel, 'size_max')).toHaveText('2 KB');
    await expect(panelValue(panel, 'size_mean')).toHaveText('1.2 KB');
    await expect(panelValue(panel, 'size_std_dev')).toHaveText('638.576 B');
    await expect(panelValue(panel, 'size_total')).toHaveText('3.5 KB');
    await expect(panel).not.toContainText('Most common');

    const histogram = dialog.locator('[data-testid="size-histogram"]');
    await expect(histogram).toBeVisible();
    await expect(
      histogram.locator('[data-testid="histogram-bar"]')
    ).toHaveCount(3);
    await expect(
      histogram.locator('.jp-ColumnStatsModal-histAxis span')
    ).toHaveText(['<512 B>', '<1 KB>', '<2 KB>']);
    await expect(panel.locator('.jp-ColumnStatsModal-note')).toHaveText(
      'Sizes are measured with length(); contents are never decoded.'
    );
  });

  test('should open the export popup from the status bar', async ({ page }) => {
    const viewer = await openInViewer(page, 'sample_database.db');
    await expect(gridRows(viewer)).toHaveCount(4, { timeout: GRID_TIMEOUT });

    await viewer.locator('.jp-TabularDataViewer-exportLink').click();

    const modal = page.locator('.jp-FilterModal');
    await expect(modal).toBeVisible();
    // 'Original' is absent for SQLite: the backend cannot write a .db back out,
    // and offering it produced HTTP 400 'Unhandled output format: sqlite'.
    await expect(
      modal.locator('.jp-FilterModal-buttons .jp-FilterModal-button')
    ).toHaveText([
      'Download as Excel (.xlsx)',
      'Download as CSV',
      'Download as Parquet (.parquet)',
      'Download as JSONL (.jsonl)'
    ]);
  });

  test('should still offer the original format for a parquet source', async ({
    page
  }) => {
    const viewer = await openInViewer(page, 'sample_data.parquet');
    // Assert rows before opening the popup. waitForGridReady is satisfied by an
    // error row too, so without this the export popup would still list its
    // formats and this test would pass over a broken data path.
    await expect(gridRows(viewer).first()).toBeVisible();

    await viewer.locator('.jp-TabularDataViewer-exportLink').click();

    const modal = page.locator('.jp-FilterModal');
    await expect(modal).toBeVisible();
    await expect(
      modal.locator('.jp-FilterModal-buttons .jp-FilterModal-button').first()
    ).toHaveText('Download as Original Format');
  });

  test('should open a SQLite database without fetching its contents', async ({
    page
  }) => {
    // The whole file used to be pulled through /api/contents and base64
    // encoded before the widget rendered, even though the viewer only ever
    // uses context.path. Past ~384MB the encoded string exceeds V8's maximum
    // string length and the open fails outright, which is how a 507MB
    // database became unopenable. Assert on the wire, not on timing.
    const contentsRequests: string[] = [];
    page.on('request', (req: any) => {
      const url = req.url();
      if (
        url.includes('/api/contents/') &&
        url.includes('sample_database.db')
      ) {
        contentsRequests.push(url);
      }
    });

    const viewer = await openInViewer(page, 'sample_database.db');
    await expect(gridRows(viewer).first()).toBeVisible();

    // The context still stats the file, so a total absence of requests would
    // mean the filter matched nothing and this test proves nothing
    expect(contentsRequests.length).toBeGreaterThan(0);
    expect(
      contentsRequests.filter(url => /[?&]content=1(&|$)/.test(url))
    ).toEqual([]);
  });

  test('should open a large synthetic database and placeholder its BLOBs', async ({
    page,
    request,
    tmpPath
  }) => {
    // Generated here rather than committed: the point is a file far bigger
    // than anything belonging in git, holding BLOBs that must never leave the
    // server.
    const generator = path.resolve(
      __dirname,
      '..',
      '..',
      'scripts',
      'make_sample_database.py'
    );
    const localPath = path.join(os.tmpdir(), `blob_${process.pid}.db`);
    execFileSync('python3', [generator, '--blob-db', localPath, '--mb', '8']);
    expect(fs.statSync(localPath).size).toBeGreaterThan(8 * 1024 * 1024);

    const contents = galata.newContentsHelper(request);
    await contents.uploadFile(localPath, `${tmpPath}/large_database.db`);
    fs.unlinkSync(localPath);
    await page.filebrowser.refresh();

    const viewer = await openInViewer(page, 'large_database.db');
    await expect(gridRows(viewer).first()).toBeVisible();

    // `labels` sorts before `payloads`, so the database opens on the narrow
    // table; switch to the BLOB one deliberately rather than relying on which
    // table happens to be first
    await expect(gridRows(viewer)).toHaveCount(50, { timeout: GRID_TIMEOUT });
    await sheetTab(viewer, 'payloads').click();
    await expect(gridRows(viewer)).toHaveCount(8, { timeout: GRID_TIMEOUT });

    // 8 rows of 1MB each, every one rendered as a placeholder
    const cells = await gridRows(viewer)
      .first()
      .locator('td')
      .allTextContents();
    expect(cells.join(' ')).toContain('<BLOB 1 MB>');
  });

  test('should export a parquet source in every format, whole table not the visible page', async ({
    page
  }) => {
    const viewer = await openInViewer(page, 'sample_data.parquet');

    // Display is local: one page out of 1500 rows. This is the control for
    // every count below - a page-scoped export would return PAGE_SIZE.
    await expect(gridRows(viewer)).toHaveCount(PAGE_SIZE, {
      timeout: GRID_TIMEOUT
    });

    const formats: [string, string][] = [
      ['Download as Original Format', '.parquet'],
      ['Download as Excel (.xlsx)', '.xlsx'],
      ['Download as CSV', '.csv'],
      ['Download as Parquet (.parquet)', '.parquet'],
      ['Download as JSONL (.jsonl)', '.jsonl']
    ];

    for (const [label, ext] of formats) {
      const { rows, filename } = await exportRowCount(page, viewer, label);
      expect(filename, label).toBe(`sample_data${ext}`);
      expect(rows, label).toBe(1500);
    }
  });

  test('should export a SQLite table in every offered format, whole table not the visible page', async ({
    page,
    request,
    tmpPath
  }) => {
    // The committed fixture's biggest table is 30 rows, which cannot tell a
    // global export from a page-scoped one. Generate a table above the page
    // size instead; 1MB of BLOBs keeps the file cheap.
    const generator = path.resolve(
      __dirname,
      '..',
      '..',
      'scripts',
      'make_sample_database.py'
    );
    const localPath = path.join(os.tmpdir(), `export_${process.pid}.db`);
    execFileSync('python3', [
      generator,
      '--blob-db',
      localPath,
      '--mb',
      '1',
      '--label-rows',
      '1200'
    ]);

    const contents = galata.newContentsHelper(request);
    await contents.uploadFile(localPath, `${tmpPath}/export_database.db`);
    fs.unlinkSync(localPath);
    await page.filebrowser.refresh();

    const viewer = await openInViewer(page, 'export_database.db');

    // Opens on `labels`, which sorts before `payloads` - 1200 rows, one page shown
    await expect(gridRows(viewer)).toHaveCount(PAGE_SIZE, {
      timeout: GRID_TIMEOUT
    });

    // 'Original' is absent for SQLite: the backend cannot write a .db back out
    const formats: [string, string][] = [
      ['Download as Excel (.xlsx)', '.xlsx'],
      ['Download as CSV', '.csv'],
      ['Download as Parquet (.parquet)', '.parquet'],
      ['Download as JSONL (.jsonl)', '.jsonl']
    ];

    for (const [label, ext] of formats) {
      const { rows, filename } = await exportRowCount(page, viewer, label);
      // Table name is slugged into the filename, so the export is traceable
      // to the tab it came from rather than just the database
      expect(filename, label).toBe(`export_database_labels${ext}`);
      expect(rows, label).toBe(1200);
    }

    // Switching tab must change what is exported, not just what is rendered - a
    // frontend that always sent the first table would satisfy every assertion
    // above. `payloads` holds exactly one row at --mb 1, so this pins WHICH
    // TABLE was exported: no single wrong table gives both 1200 for `labels`
    // and 1 here. Row identity is not asserted - nothing here reads a cell.
    await sheetTab(viewer, 'payloads').click();
    await expect(gridRows(viewer)).toHaveCount(1, { timeout: GRID_TIMEOUT });
    const payloads = await exportRowCount(page, viewer, 'Download as CSV');
    expect(payloads.filename).toBe('export_database_payloads.csv');
    expect(payloads.rows).toBe(1);
  });

  test('should export csv and xlsx sources beyond the visible page', async ({
    page
  }) => {
    // Both carry 1500 rows. Covered together because the reader engine differs
    // per source while the export path is shared - a regression in either
    // reader would show up as a short export here.
    const csvViewer = await openInViewer(
      page,
      'sample_data.csv',
      'Tabular Data Viewer (Text)'
    );
    await expect(gridRows(csvViewer)).toHaveCount(PAGE_SIZE, {
      timeout: GRID_TIMEOUT
    });
    // Both viewers resolve to whichever tab is active, so the filename is what
    // ties an export to its source. Every export below asserts one: the sheet
    // slug distinguishes the two sources even for the same output format.
    const csvAsCsv = await exportRowCount(page, csvViewer, 'Download as CSV');
    expect(csvAsCsv.filename).toBe('sample_data.csv');
    expect(csvAsCsv.rows).toBe(1500);
    const csvAsParquet = await exportRowCount(
      page,
      csvViewer,
      'Download as Parquet (.parquet)'
    );
    expect(csvAsParquet.filename).toBe('sample_data.parquet');
    expect(csvAsParquet.rows).toBe(1500);

    const xlsxViewer = await openInViewer(
      page,
      'sample_data.xlsx',
      'Tabular Data Viewer (Binary)'
    );
    await expect(gridRows(xlsxViewer)).toHaveCount(PAGE_SIZE, {
      timeout: GRID_TIMEOUT
    });
    // Slugged as `_sheet1` even though the workbook has a single sheet and the
    // tab bar therefore stays hidden - the active sheet is still set, and it
    // reaches the filename for every output format, not just the original. The
    // csv source has no sheet at all and gets no slug.
    const xlsxAsCsv = await exportRowCount(page, xlsxViewer, 'Download as CSV');
    expect(xlsxAsCsv.filename).toBe('sample_data_sheet1.csv');
    expect(xlsxAsCsv.rows).toBe(1500);
    const xlsxOriginal = await exportRowCount(
      page,
      xlsxViewer,
      'Download as Original Format'
    );
    expect(xlsxOriginal.filename).toBe('sample_data_sheet1.xlsx');
    expect(xlsxOriginal.rows).toBe(1500);
  });

  test('should export a nullable integer without a decimal tail', async ({
    page,
    request,
    tmpPath
  }) => {
    // A nullable INTEGER column used to be promoted to float64 by the reader,
    // because a column's type followed whichever rows were read (DEF-4).
    //
    // Asserted on the exported file, NOT on the grid. The grid was checked first
    // and cannot see this: the backend serialises 42.0, JSON has one number
    // type, and JavaScript stringifies that as "42" - so a DOM assertion passes
    // under the promotion and proves nothing. Re-introducing the float cast in
    // the installed reader left a grid-based version of this test green. The
    // export is where the promotion is visible, because a CSV writer prints the
    // type it is given.
    const generator = path.resolve(
      __dirname,
      '..',
      '..',
      'scripts',
      'make_sample_database.py'
    );
    const localPath = path.join(os.tmpdir(), `nullable_${process.pid}.db`);
    execFileSync('python3', [generator, '--nullable-db', localPath]);

    const contents = galata.newContentsHelper(request);
    await contents.uploadFile(localPath, `${tmpPath}/nullable.db`);
    fs.unlinkSync(localPath);
    await page.filebrowser.refresh();

    const viewer = await openInViewer(page, 'nullable.db');
    await expect(gridRows(viewer)).toHaveCount(12, { timeout: GRID_TIMEOUT });

    const { text, filename } = await exportText(
      page,
      viewer,
      'Download as CSV'
    );
    expect(filename).toBe('nullable_readings.csv');

    const values = text
      .trim()
      .split('\n')
      .slice(1)
      .map(line => line.split(',')[1]);
    // 42 is row 7 (7 * 6). Under the promotion this field read '42.0'
    expect(values).toContain('42');
    // Whole column, not one sentinel - a promotion applies to every value at
    // once, and the nulls must stay empty rather than becoming a written value
    expect(values.filter(v => /\./.test(v))).toEqual([]);
    expect(values.filter(v => v === '')).toHaveLength(2);
  });

  test('should render a mixed-type column as text rather than failing the read', async ({
    page,
    request,
    tmpPath
  }) => {
    // Mixed-type column resolution, asserted through the UI. `AccountID` holds large
    // integers and the string 'ACCFS-108'; a reader that types the column from
    // its leading rows raises on the string and the sheet will not open at all.
    //
    // This sheet is three rows, so it does NOT exercise the inference window -
    // any default would cover it. The window is pinned in
    // test_mixed_column_resolves_when_the_string_arrives_late (pytest), which
    // plants the string past row 200. What this test covers is the UI end of
    // the path: a mixed column reaching the grid with both classes intact.
    const contents = galata.newContentsHelper(request);
    const source = path.resolve(
      __dirname,
      '..',
      '..',
      'data',
      'multi_sheet.xlsx'
    );
    await contents.uploadFile(source, `${tmpPath}/multi_sheet.xlsx`);
    await page.filebrowser.refresh();

    const viewer = await openInViewer(
      page,
      'multi_sheet.xlsx',
      'Tabular Data Viewer (Binary)'
    );
    await sheetTab(viewer, 'MixedTypes').click();
    await expect(gridRows(viewer).first()).toBeVisible({
      timeout: GRID_TIMEOUT
    });

    const cells = await gridRows(viewer).locator('td').allTextContents();
    // Both storage classes survive: the string is not dropped, and the integer
    // is not mangled into scientific notation on its way through a text column
    expect(cells).toContain('ACCFS-108');
    expect(cells).toContain('43216987345427');
  });

  test('should show the spreadsheet icon on the tab and in the file browser', async ({
    page
  }) => {
    // Parquet is the type only this extension registers - core JupyterLab
    // already gives .csv and .tsv a spreadsheet icon, so they cannot tell
    // whether OUR registration carries one.
    await openInViewer(page, 'sample_data.parquet');

    // A LabIcon renders an <svg> into the tab's icon slot; the legacy
    // iconClass renders nothing there.
    const currentTab = page.locator(
      '#jp-main-dock-panel .lm-TabBar-tab.lm-mod-current'
    );
    await expect(currentTab).toContainText('sample_data.parquet');
    await expect(currentTab.locator('.lm-TabBar-tabIcon svg')).toHaveCount(1);

    const listingItem = page.locator('.jp-DirListing-item', {
      hasText: 'sample_data.parquet'
    });
    await expect(
      listingItem.locator('.jp-DirListing-itemIcon svg')
    ).toHaveCount(1);
  });

  test('should open an .xlsx saved under the old .xls name', async ({
    page,
    request,
    tmpPath
  }) => {
    // The backend has typed .xls as excel for a long time; the file browser
    // never offered the viewer for one because no frontend file type claimed
    // the extension (DEF-EXCEL-18). Same bytes, different name.
    const contents = galata.newContentsHelper(request);
    await contents.uploadFile(
      path.join(DATA_DIR, 'sample_data.xlsx'),
      `${tmpPath}/legacy_book.xls`
    );
    await page.filebrowser.refresh();

    const viewer = await openInViewer(page, 'legacy_book.xls');
    await expect(gridRows(viewer).first()).toBeVisible({
      timeout: GRID_TIMEOUT
    });
    expect((await columnNames(viewer)).length).toBeGreaterThan(0);
  });

  test('should not raise a save error on Ctrl+S', async ({
    page,
    request,
    tmpPath
  }) => {
    // The model holds no content, so there is nothing a save could write. It
    // used to send an empty body with no format, which the contents API
    // rejected with a "File Save Error" dialog (DEF-LOAD-5).
    const contents = galata.newContentsHelper(request);
    const filePath = `${tmpPath}/sample_data.parquet`;
    const before = await contents.getContentMetadata(filePath);

    const viewer = await openInViewer(page, 'sample_data.parquet');
    await viewer.click();
    await page.keyboard.press('Control+s');

    // A negative assertion needs a settle: toHaveCount(0) would pass before
    // the dialog had a chance to appear.
    await page.waitForTimeout(2000);
    expect(await page.locator('.jp-Dialog').count()).toBe(0);

    // And the file on disk was not touched
    const after = await contents.getContentMetadata(filePath);
    expect(after?.last_modified).toBe(before?.last_modified);
  });

  test('should render the next window when scrolled to the bottom', async ({
    page
  }) => {
    // 1500 rows, 500 per window. Paging is scroll-driven: within 200px of the
    // container's bottom the next window is fetched and appended.
    const viewer = await openInViewer(
      page,
      'sample_data.csv',
      'Tabular Data Viewer (Text)'
    );
    await expect(gridRows(viewer)).toHaveCount(PAGE_SIZE, {
      timeout: GRID_TIMEOUT
    });

    const container = viewer.locator('.jp-TabularDataViewer-container');
    const scrollToBottom = () =>
      container.evaluate((el: HTMLElement) => {
        el.scrollTop = el.scrollHeight;
      });

    await scrollToBottom();
    await expect(gridRows(viewer)).toHaveCount(2 * PAGE_SIZE, {
      timeout: GRID_TIMEOUT
    });

    await scrollToBottom();
    await expect(gridRows(viewer)).toHaveCount(3 * PAGE_SIZE, {
      timeout: GRID_TIMEOUT
    });
    await expect(
      viewer.locator('.jp-TabularDataViewer-statusRight')
    ).toContainText('Showing 1500 of 1500 rows');

    // Past the end nothing more is fetched and nothing is duplicated
    await scrollToBottom();
    await page.waitForTimeout(1500);
    expect(await gridRows(viewer).count()).toBe(3 * PAGE_SIZE);
  });

  test('should refresh from disk on reload without fetching content', async ({
    page,
    request,
    tmpPath
  }) => {
    // The context loads no file content, so the file-changed signal has to
    // keep working on metadata alone: `docmanager:reload` reverts the context,
    // the widget hears fileChanged and re-reads through its own API.
    const filePath = `${tmpPath}/sample_data.csv`;
    const viewer = await openInViewer(
      page,
      'sample_data.csv',
      'Tabular Data Viewer (Text)'
    );
    await expect(gridRows(viewer)).toHaveCount(PAGE_SIZE, {
      timeout: GRID_TIMEOUT
    });

    // The file's own contents URL only: the revert also lists its checkpoints
    // (`.../sample_data.csv/checkpoints`), which carry no content parameter
    const contentsRequests: string[] = [];
    page.on('request', (req: any) => {
      const url = req.url();
      if (
        req.method() === 'GET' &&
        url.includes('/api/contents/') &&
        url.split('?')[0].endsWith('/sample_data.csv')
      ) {
        contentsRequests.push(url);
      }
    });

    const contents = galata.newContentsHelper(request);
    await contents.uploadContent('a,b\n1,2\n3,4\n5,6\n', 'text', filePath);
    await page.evaluate(() =>
      (window as any).jupyterapp.commands.execute('docmanager:reload')
    );

    await expect(gridRows(viewer)).toHaveCount(3, { timeout: GRID_TIMEOUT });
    expect(await columnNames(viewer)).toEqual(['a', 'b']);

    // The revert re-fetched the contents model, never the bytes
    expect(contentsRequests.length).toBeGreaterThan(0);
    expect(contentsRequests.filter(u => !u.includes('content=0'))).toEqual([]);
  });

  test('should render clock-time and elapsed-time columns', async ({
    page
  }) => {
    // arrow time64 and duration reach the rows request as datetime.time and
    // datetime.timedelta, neither of which the JSON encoder knew (DEF-LOAD-20)
    const viewer = await openInViewer(page, 'typed_columns.parquet');
    await expect(gridRows(viewer)).toHaveCount(12, { timeout: GRID_TIMEOUT });
    expect(await columnNames(viewer)).toEqual([
      'id',
      'clock',
      'elapsed',
      'category'
    ]);

    // The grid fills asynchronously as the first page arrives, so poll the
    // cells instead of sampling them the moment the row count settles.
    await expect
      .poll(async () => gridRows(viewer).locator('td').allTextContents(), {
        timeout: GRID_TIMEOUT
      })
      .toContain('09:01:00');
    await expect
      .poll(async () => gridRows(viewer).locator('td').allTextContents(), {
        timeout: GRID_TIMEOUT
      })
      .toContain('0:05:00');
  });

  test('should sort and report statistics on a dictionary-encoded column', async ({
    page
  }) => {
    // A parquet column written from a pandas Categorical is stored as
    // dictionary<string, int>. Sorting and statistics had no kernel for it and
    // returned 500 (DEF-LOAD-24); decoded on read it is a string column.
    const viewer = await openInViewer(page, 'typed_columns.parquet');
    await expect(gridRows(viewer)).toHaveCount(12, { timeout: GRID_TIMEOUT });

    const header = viewer.locator('.jp-TabularDataViewer-headerCell', {
      hasText: 'category'
    });
    await header.locator('.jp-TabularDataViewer-columnName').click();

    // Ascending: 'blue' sorts first, and only the rows carrying it lead
    await expect(gridRows(viewer)).toHaveCount(12, { timeout: GRID_TIMEOUT });
    const firstRow = await gridRows(viewer)
      .first()
      .locator('td')
      .allTextContents();
    expect(firstRow).toContain('blue');
    expect(firstRow).not.toContain('red');

    await header.locator('.jp-TabularDataViewer-infoIcon').click();
    const dialog = page.locator('[data-testid="stats-dialog"]');
    await expect(dialog).toBeVisible({ timeout: GRID_TIMEOUT });
    await expect(dialog.locator('h3')).toHaveText('category');
    await expect(
      dialog.locator('[data-testid="unique-value-row"]')
    ).toHaveCount(3);
  });

  test('should render the adaptive statistics dialog for a duration column', async ({
    page
  }) => {
    const viewer = await openInViewer(page, 'typed_columns.parquet');
    await expect(gridRows(viewer)).toHaveCount(12, { timeout: GRID_TIMEOUT });
    const statsResponse = page.waitForResponse(
      (response: any) =>
        response.url().includes('/column-stats') &&
        response.request().method() === 'POST'
    );
    const dialog = await openStatsDialog(page, viewer, 'elapsed');
    const payload = await (await statsResponse).json();

    // Every value is distinct, so the unique pane would repeat the grid: the
    // dialog stays a 720px single column.
    const box = await dialog.boundingBox();
    expect(Math.round(box!.width)).toBe(720);
    await expect(dialog.locator('[data-testid="unique-values"]')).toHaveCount(
      0
    );

    // Distribution rows carry the quartiles the backend now reports
    const panel = dialog.locator('[data-testid="stats-panel"]');
    await expect(panel).toContainText('Distribution');
    await expect(
      panel.locator('[data-testid="stats-panel-row-q1"]')
    ).toBeVisible();
    await expect(
      panel.locator('[data-testid="stats-panel-row-q3"]')
    ).toBeVisible();
    await expect(dialog.locator('[data-testid="boxplot"]')).toBeVisible();

    // The histogram sits above the box plot and uses every payload bin
    const histogram = dialog.locator('[data-testid="histogram"]');
    await expect(histogram).toBeVisible();
    await expect(
      histogram.locator('[data-testid="histogram-bar"]')
    ).toHaveCount(payload.histogram.bins.length);
    const histogramBox = await histogram.boundingBox();
    const plotBox = await dialog
      .locator('[data-testid="boxplot"]')
      .boundingBox();
    expect(histogramBox!.y + histogramBox!.height).toBeLessThanOrEqual(
      plotBox!.y
    );

    // The stats column fits, so it does not scroll, and neither the body nor
    // the dialog itself is a scroll region
    const overflow = await dialog.evaluate((node: HTMLElement) => {
      const stats = node.querySelector(
        '.jp-ColumnStatsModal-stats'
      ) as HTMLElement;
      const body = node.querySelector(
        '.jp-ColumnStatsModal-body'
      ) as HTMLElement;
      return {
        stats: stats.scrollHeight - stats.clientHeight,
        body: getComputedStyle(body).overflowY,
        dialog: getComputedStyle(node).overflowY
      };
    });
    expect(overflow.stats).toBeLessThanOrEqual(1);
    expect(overflow.body).not.toBe('auto');
    expect(overflow.dialog).toBe('hidden');

    // A chip is a small-radius tag, never a fully rounded pill
    const chipRadius = await dialog
      .locator('.jp-ColumnStatsModal-chip')
      .evaluate((node: HTMLElement) => getComputedStyle(node).borderRadius);
    expect(chipRadius).toBe('2px');
  });

  test('should cap and center the dialog on a wide window', async ({
    page
  }) => {
    // A pane dialog is capped at 980px and centred rather than filling the
    // window, with the statistics left and the pane right.
    const viewer = await openInViewer(page, 'sample_data.parquet');
    await page.setViewportSize({ width: 2100, height: 1000 });
    const dialog = await openStatsDialog(page, viewer, 'department');

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.width)).toBe(980);

    const overlay = await page.locator('.jp-ColumnStatsModal').boundingBox();
    const windowCentre = overlay!.x + overlay!.width / 2;
    expect(
      Math.abs(box!.x + box!.width / 2 - windowCentre)
    ).toBeLessThanOrEqual(2);

    const statsBox = await dialog
      .locator('.jp-ColumnStatsModal-stats')
      .boundingBox();
    const paneBox = await dialog
      .locator('.jp-ColumnStatsModal-values')
      .boundingBox();
    expect(paneBox!.x).toBeGreaterThanOrEqual(statsBox!.x + statsBox!.width);
  });

  test('should hide the pane for all-distinct values and show it otherwise', async ({
    page
  }) => {
    // salary repeats no value, so a pane listing it would repeat the grid;
    // department has five values and earns the pane.
    const viewer = await openInViewer(page, 'sample_data.parquet');
    const salaryDialog = await openStatsDialog(page, viewer, 'salary');
    await expect(
      salaryDialog.locator('[data-testid="unique-values"]')
    ).toHaveCount(0);
    expect(Math.round((await salaryDialog.boundingBox())!.width)).toBe(720);
    await salaryDialog.locator('[data-testid="close-stats"]').click();
    await expect(salaryDialog).toBeHidden();

    const departmentDialog = await openStatsDialog(page, viewer, 'department');
    const pane = departmentDialog.locator('[data-testid="unique-values"]');
    await expect(pane).toBeVisible();
    await expect(
      departmentDialog.locator('.jp-ColumnStatsModal-valueCols span').nth(1)
    ).toHaveText('Share of rows');
    await expect(
      departmentDialog.locator('[data-testid="unique-value-row"]')
    ).toHaveCount(5);
  });

  test('should size the dialog from the pane and tint the chip by type', async ({
    page
  }) => {
    const viewer = await openInViewer(page, 'sample_data.parquet');

    // age has 63 distinct values of 1,500 rows, inside the default limit of
    // 100, so the pane is shown and the dialog widens to 980px.
    const ageDialog = await openStatsDialog(page, viewer, 'age');
    const ageBox = await ageDialog.boundingBox();
    expect(Math.abs(ageBox!.width - 980)).toBeLessThanOrEqual(2);
    await expect(
      ageDialog.locator('[data-testid="unique-values"]')
    ).toBeVisible();
    const intChip = await ageDialog
      .locator('.jp-ColumnStatsModal-chip')
      .evaluate((node: HTMLElement) => getComputedStyle(node).borderTopColor);
    const intChipBackground = await ageDialog
      .locator('.jp-ColumnStatsModal-chip')
      .evaluate((node: HTMLElement) => getComputedStyle(node).backgroundColor);
    await ageDialog.locator('[data-testid="close-stats"]').click();

    // salary repeats no value: 720px and no pane.
    const salaryDialog = await openStatsDialog(page, viewer, 'salary');
    const salaryBox = await salaryDialog.boundingBox();
    expect(Math.abs(salaryBox!.width - 720)).toBeLessThanOrEqual(2);
    await expect(
      salaryDialog.locator('[data-testid="unique-values"]')
    ).toHaveCount(0);
    await salaryDialog.locator('[data-testid="close-stats"]').click();

    // join_date holds 1,028 distinct values of 1,500 rows, more than the fetch
    // limit can list, so it stays a 720px single column.
    const joinDialog = await openStatsDialog(page, viewer, 'join_date');
    const joinBox = await joinDialog.boundingBox();
    expect(Math.abs(joinBox!.width - 720)).toBeLessThanOrEqual(2);
    await expect(
      joinDialog.locator('[data-testid="unique-values"]')
    ).toHaveCount(0);
    await joinDialog.locator('[data-testid="close-stats"]').click();

    // department is a string column: its chip carries the string tint, which
    // differs from the int tint.
    const departmentDialog = await openStatsDialog(page, viewer, 'department');
    const stringChip = await departmentDialog
      .locator('.jp-ColumnStatsModal-chip')
      .evaluate((node: HTMLElement) => getComputedStyle(node).borderTopColor);
    expect(intChip).toBe('rgb(100, 181, 246)');
    expect(stringChip).toBe('rgb(255, 183, 77)');
    expect(stringChip).not.toBe(intChip);

    // The chip background is the int tint (#64b5f6) at 14 percent, not the
    // layout colour the old rule painted.
    expect(splitColor(intChipBackground)).toEqual({
      rgb: [100, 181, 246],
      alpha: 0.14
    });
  });

  test('should put the age histogram beside the box plot', async ({ page }) => {
    const viewer = await openInViewer(page, 'sample_data.parquet');
    const statsResponse = page.waitForResponse(
      (response: any) =>
        response.url().includes('/column-stats') &&
        response.request().method() === 'POST'
    );
    const dialog = await openStatsDialog(page, viewer, 'age');
    const stats = await (await statsResponse).json();

    const histogram = dialog.locator('[data-testid="histogram"]');
    await expect(histogram).toBeVisible();
    await expect(
      histogram.locator('[data-testid="histogram-bar"]')
    ).toHaveCount(stats.histogram.bins.length);
    const plot = dialog.locator('[data-testid="boxplot"]');
    await expect(plot).toBeVisible();

    const histogramBox = await histogram.boundingBox();
    const plotBox = await plot.boundingBox();
    expect(histogramBox!.y + histogramBox!.height).toBeLessThanOrEqual(
      plotBox!.y
    );
  });

  test('should fit the tile labels and value headers at 2089x1244', async ({
    page
  }) => {
    // 'UNIQUE (NON-NULL)' must stay whole in the narrow statistics column of a
    // pane dialog, and the four value headers must stay legible.
    const viewer = await openInViewer(page, 'sample_data.parquet');
    await page.setViewportSize({ width: 2089, height: 1244 });
    const statsResponse = page.waitForResponse(
      (response: any) =>
        response.url().includes('/column-stats') &&
        response.request().method() === 'POST'
    );
    const uniqueResponse = page.waitForResponse(
      (response: any) =>
        response.url().includes('/unique-values') &&
        response.request().method() === 'POST'
    );
    const dialog = await openStatsDialog(page, viewer, 'age');
    const stats = await (await statsResponse).json();
    const payload = await (await uniqueResponse).json();

    for (const selector of [
      '.jp-ColumnStatsModal-tileLabel',
      '.jp-ColumnStatsModal-valueCols span'
    ]) {
      const elements = dialog.locator(selector);
      await expect(elements).toHaveCount(4);
      const clipped = await elements.evaluateAll((nodes: HTMLElement[]) =>
        nodes
          .filter(
            node =>
              node.scrollWidth > node.clientWidth + 1 ||
              node.scrollHeight > node.clientHeight + 1
          )
          .map(node => node.textContent)
      );
      expect(clipped).toEqual([]);
    }

    // The bar and the percentage both measure the count against all rows, so
    // the two agree on every row.
    const bars = await dialog
      .locator('[data-testid="unique-value-row"]')
      .evaluateAll((nodes: HTMLElement[]) =>
        nodes.map(node => ({
          share: parseFloat(
            (node.querySelector('.jp-ColumnStatsModal-fill') as HTMLElement)
              .style.width
          ),
          pct: parseFloat(
            (node.querySelector('.jp-ColumnStatsModal-valuePct') as HTMLElement)
              .textContent!
          )
        }))
      );
    expect(bars).toHaveLength(payload.counts.length);
    bars.forEach((bar, index) => {
      const share = (payload.counts[index] / stats.total_rows) * 100;
      expect(bar.share).toBeCloseTo(share, 2);
      expect(bar.pct).toBeCloseTo(share, 2);
    });
  });

  test('should not overflow horizontally in a narrow window', async ({
    page
  }) => {
    const viewer = await openInViewer(page, 'sample_data.parquet');
    await page.setViewportSize({ width: 600, height: 900 });
    const dialog = await openStatsDialog(page, viewer, 'age');

    const overflow = await dialog.evaluate((node: HTMLElement) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    // The values pane scrolls vertically and never sideways
    const scroll = await dialog
      .locator('[data-testid="unique-values"]')
      .evaluate((node: HTMLElement) => ({
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth
      }));
    expect(scroll.scrollWidth).toBe(scroll.clientWidth);

    // Every track keeps a share of the row; a zero-width bar track hid the
    // fill and a zero-width value track hid the value.
    const tracks = await dialog
      .locator('[data-testid="unique-value-row"]')
      .first()
      .evaluate((node: HTMLElement) =>
        getComputedStyle(node)
          .gridTemplateColumns.split(' ')
          .map(track => parseFloat(track))
      );
    expect(tracks).toHaveLength(4);
    for (const track of tracks) {
      expect(track).toBeGreaterThan(0);
    }
  });

  test('should keep the distribution and legend inside a short dialog', async ({
    page
  }) => {
    // Below about 620px of viewport height the statistics column was clipped
    // with no scroll region of its own.
    const viewer = await openInViewer(page, 'adaptive_types.parquet');
    await page.setViewportSize({ width: 1280, height: 660 });
    const dialog = await openStatsDialog(page, viewer, 'price');

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    for (const locator of [
      dialog.locator('[data-testid="stats-panel-row-outliers"]'),
      dialog.locator('.jp-ColumnStatsModal-boxlegend')
    ]) {
      const item = await locator.boundingBox();
      expect(item).not.toBeNull();
      expect(item!.y + item!.height).toBeLessThanOrEqual(box!.y + box!.height);
    }

    // Still no second scroll region: the column fits the 75vh dialog
    const statsOverflow = await dialog.evaluate((node: HTMLElement) => {
      const stats = node.querySelector(
        '.jp-ColumnStatsModal-stats'
      ) as HTMLElement;
      return stats.scrollHeight - stats.clientHeight;
    });
    expect(statsOverflow).toBeLessThanOrEqual(1);
  });

  test('should cap the dialog at three quarters of the window height', async ({
    page
  }) => {
    // The dialog stays centred and at most 75vh tall. A statistics column that
    // fits does not scroll; one taller than the space left scrolls, and its
    // last block can be scrolled into view rather than being clipped. At
    // 1280x660 every column fits, so 1280x450 is the case that must scroll.
    const viewer = await openInViewer(page, 'sample_data.parquet');
    const cases: [number, number, string, boolean][] = [
      [2089, 1244, 'age', false],
      [1280, 660, 'age', false],
      [1280, 660, 'salary', false],
      [1280, 450, 'salary', true]
    ];
    for (const [width, height, column, scrolls] of cases) {
      await page.setViewportSize({ width, height });
      const dialog = await openStatsDialog(page, viewer, column);
      const innerHeight = await page.evaluate(() => window.innerHeight);
      const box = await dialog.boundingBox();
      expect(box!.height).toBeLessThanOrEqual(0.75 * innerHeight + 1);
      expect(
        Math.abs(box!.y + box!.height / 2 - innerHeight / 2)
      ).toBeLessThanOrEqual(2);

      const stats = await dialog
        .locator('.jp-ColumnStatsModal-stats')
        .evaluate((node: HTMLElement) => {
          const scrollable = node.scrollHeight > node.clientHeight + 1;
          node.scrollTop = node.scrollHeight;
          const area = node.getBoundingClientRect();
          const last = node.lastElementChild!.getBoundingClientRect();
          return {
            scrollable,
            lastVisible:
              last.top >= area.top - 1 && last.bottom <= area.bottom + 1
          };
        });
      expect(stats).toEqual({ scrollable: scrolls, lastVisible: true });

      await dialog.locator('[data-testid="close-stats"]').click();
      await expect(dialog).toBeHidden();
    }
  });

  test('should format sub-second and negative durations like the grid', async ({
    page
  }) => {
    // Whole-second rounding turned 1500000 us into 0:00:02 and -300000000 us
    // into -0:05:00 where the grid shows str(timedelta) (DEF-STATS-36-DURATION,
    // DEF-STATS-39-NEGDUR). Every short value is distinct, so the formatting
    // is read from the distribution metrics.
    const dialog = await openAdaptiveStats(page, 'short');
    const panel = dialog.locator('[data-testid="stats-panel"]');
    await expect(panelValue(panel, 'min')).toHaveText('-1 day, 23:55:00');
    await expect(panelValue(panel, 'median')).toHaveText('0:00:01.250000');
    // The histogram axis keeps the payload's own timedelta labels
    await expect(
      dialog
        .locator('[data-testid="histogram"] .jp-ColumnStatsModal-histAxis span')
        .first()
    ).toHaveText('-1 day, 23:55:00');
  });

  test('should render duration[ns] statistics with nanosecond precision', async ({
    page,
    request,
    tmpPath
  }) => {
    // A duration[ns] cannot be committed as text, so the fixture is generated
    // here. Its sub-microsecond digits are what the old microsecond formatter
    // dropped from the distribution rows.
    const localPath = path.join(
      os.tmpdir(),
      `ns_durations_${process.pid}.parquet`
    );
    const generator = [
      'import sys',
      'import pyarrow as pa',
      'import pyarrow.parquet as pq',
      'table = pa.table({',
      "    'span_ns': pa.array([1500000001, 2000000002, 2500000003, 3000000004, 3500000005, 4000000006], pa.duration('ns')),",
      "    'span_us': pa.array([1500000, 2000000, 2500000, 3000000, 3500000, 4000001], pa.duration('us')),",
      "    'span_ms': pa.array([1500, 2000, 2500, 3000, 3500, 4000], pa.duration('ms')),",
      "    'span_s': pa.array([2, 3, 4, 5, 6, 7], pa.duration('s')),",
      '})',
      'pq.write_table(table, sys.argv[1])'
    ].join('\n');
    execFileSync('python3', ['-c', generator, localPath]);
    const contents = galata.newContentsHelper(request);
    await contents.uploadFile(localPath, `${tmpPath}/nanoseconds.parquet`);
    fs.unlinkSync(localPath);
    await page.filebrowser.refresh();

    const viewer = await openInViewer(page, 'nanoseconds.parquet');
    await expect(gridRows(viewer)).toHaveCount(6, { timeout: GRID_TIMEOUT });
    // The grid fills asynchronously as the first page arrives, so poll the
    // cells instead of sampling them the moment the row count settles.
    await expect
      .poll(async () => gridRows(viewer).locator('td').allTextContents(), {
        timeout: GRID_TIMEOUT
      })
      .toContain('0 days 00:00:01.500000001');

    const nsDialog = await openStatsDialog(page, viewer, 'span_ns');
    const nsPanel = nsDialog.locator('[data-testid="stats-panel"]');
    await expect(panelValue(nsPanel, 'min')).toHaveText(
      '0 days 00:00:01.500000001'
    );
    await expect(panelValue(nsPanel, 'max')).toHaveText(
      '0 days 00:00:04.000000006'
    );
    await nsDialog.locator('[data-testid="close-stats"]').click();
    await expect(nsDialog).toBeHidden();

    // The coarser units keep the Python timedelta form
    const usDialog = await openStatsDialog(page, viewer, 'span_us');
    await expect(
      panelValue(usDialog.locator('[data-testid="stats-panel"]'), 'min')
    ).toHaveText('0:00:01.500000');
    await usDialog.locator('[data-testid="close-stats"]').click();

    const msDialog = await openStatsDialog(page, viewer, 'span_ms');
    await expect(
      panelValue(msDialog.locator('[data-testid="stats-panel"]'), 'min')
    ).toHaveText('0:00:01.500000');
    await msDialog.locator('[data-testid="close-stats"]').click();

    const sDialog = await openStatsDialog(page, viewer, 'span_s');
    await expect(
      panelValue(sDialog.locator('[data-testid="stats-panel"]'), 'min')
    ).toHaveText('0:00:02');
  });

  test('should not draw a box plot for a constant column', async ({ page }) => {
    // min equals max put every box position at 0 (DEF-STATS-38-CONSTPLOT)
    const dialog = await openAdaptiveStats(page, 'same');
    await expect(dialog.locator('[data-testid="stats-panel"]')).toContainText(
      'Distribution'
    );
    await expect(dialog.locator('[data-testid="boxplot"]')).toHaveCount(0);
  });

  test('should move keyboard focus into the statistics dialog', async ({
    page
  }) => {
    // Focus stayed on the grid behind the overlay (DEF-STATS-35-FOCUS)
    await openAdaptiveStats(page, 'price');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            !!document.activeElement?.closest('[data-testid="stats-dialog"]')
        )
      )
      .toBe(true);
  });

  test('should render the text and time-range statistics blocks', async ({
    page
  }) => {
    const viewer = await openInViewer(page, 'typed_columns.parquet');
    await expect(gridRows(viewer)).toHaveCount(12, { timeout: GRID_TIMEOUT });

    const categoryDialog = await openStatsDialog(page, viewer, 'category');
    const textPanel = categoryDialog.locator('[data-testid="stats-panel"]');
    await expect(textPanel).toContainText('Text');
    await expect(
      textPanel.locator('[data-testid="stats-panel-row-most_common"]')
    ).toContainText('green');
    await expect(
      textPanel.locator('[data-testid="stats-panel-row-top_share"]')
    ).toContainText('50.0%');
    await categoryDialog.locator('[data-testid="close-stats"]').click();
    await expect(categoryDialog).toBeHidden();

    const clockResponse = page.waitForResponse(
      (response: any) =>
        response.url().includes('/column-stats') &&
        response.request().method() === 'POST'
    );
    const clockDialog = await openStatsDialog(page, viewer, 'clock');
    const clockStats = await (await clockResponse).json();
    const timePanel = clockDialog.locator('[data-testid="stats-panel"]');
    await expect(timePanel).toContainText('Distribution');
    await expect(
      timePanel.locator('[data-testid="stats-panel-row-earliest"]')
    ).toContainText('09:00:00');
    await expect(
      timePanel.locator('[data-testid="stats-panel-row-latest"]')
    ).toContainText('09:11:00');
    await expect(
      timePanel.locator('[data-testid="stats-panel-row-span"]')
    ).toContainText('0:11:00');

    // The histogram draws every payload bin and keeps its HH:MM labels
    const clockHistogram = clockDialog.locator('[data-testid="histogram"]');
    await expect(
      clockHistogram.locator('[data-testid="histogram-bar"]')
    ).toHaveCount(clockStats.histogram.bins.length);
    await expect(
      clockHistogram.locator('.jp-ColumnStatsModal-histAxis span').first()
    ).toHaveText(clockStats.histogram.bins[0].label);
  });

  test('should render the summary tiles for an integer column', async ({
    page
  }) => {
    const dialog = await openAdaptiveStats(page, 'id');
    await expectTiles(dialog, [
      ['Total rows', '12'],
      ['Non-null', '12'],
      ['Null', '0'],
      ['Unique (non-null)', '12']
    ]);
  });

  test('should state each tile sublabel as a share of its denominator', async ({
    page
  }) => {
    // One tile read 'all rows' while the others read 'of all rows', so the
    // four sublabels did not follow one pattern.
    const dialog = await openAdaptiveStats(page, 'id');
    const subs = await dialog
      .locator('.jp-ColumnStatsModal-tileSub')
      .allTextContents();
    expect(subs).toEqual([
      '100.0% of all rows',
      '100.0% of all rows',
      '0.0% of all rows',
      '100.0% of non-null values'
    ]);
    await expect(
      dialog.locator('.jp-ColumnStatsModal-tileLabel').nth(3)
    ).toHaveText('Unique (non-null)');
  });

  test('should count non-null distinct values in the Unique tile and null rows in the note', async ({
    page
  }) => {
    // The Unique tile counts distinct non-null values (33 here) while the note
    // counts every listed row, including the null row (34), so both labels
    // must name their own population.
    const viewer = await openInViewer(page, 'activity_stats.parquet');
    const dialog = await openStatsDialog(page, viewer, 'alarm_rate_trend');
    const tiles = dialog.locator('.jp-ColumnStatsModal-tile');
    await expect(
      tiles.nth(1).locator('.jp-ColumnStatsModal-tileSub')
    ).toHaveText('57.1% of all rows');
    await expect(
      tiles.nth(2).locator('.jp-ColumnStatsModal-tileSub')
    ).toHaveText('42.9% of all rows');
    await expect(
      tiles.nth(3).locator('.jp-ColumnStatsModal-tileLabel')
    ).toHaveText('Unique (non-null)');
    await expect(
      tiles.nth(3).locator('.jp-ColumnStatsModal-tileValue')
    ).toHaveText('33');
    await expect(
      tiles.nth(3).locator('.jp-ColumnStatsModal-tileSub')
    ).toHaveText('1.6% of non-null values');

    await expect(dialog.locator('.jp-ColumnStatsModal-valuesNote')).toHaveText(
      '34 of 34 listed, ranked by count'
    );
    const rows = dialog.locator('[data-testid="unique-value-row"]');
    await expect(rows).toHaveCount(34);
    expect(
      await rows.locator('.jp-ColumnStatsModal-value').allTextContents()
    ).toContain('(null)');
  });

  test('should render the date range for a date column', async ({ page }) => {
    const dialog = await openAdaptiveStats(page, 'day');
    const panel = dialog.locator('[data-testid="stats-panel"]');
    await expect(panel).toContainText('Distribution');
    await expect(panelValue(panel, 'earliest')).toHaveText('2026-01-01');
    await expect(panelValue(panel, 'latest')).toHaveText('2026-01-12');
    await expect(panelValue(panel, 'span')).toHaveText('11 days');
  });

  test('should render the date and time range for a timestamp column', async ({
    page
  }) => {
    const viewer = await openInViewer(page, 'adaptive_types.parquet');
    const statsResponse = page.waitForResponse(
      (response: any) =>
        response.url().includes('/column-stats') &&
        response.request().method() === 'POST'
    );
    const dialog = await openStatsDialog(page, viewer, 'created');
    const stats = await (await statsResponse).json();
    const panel = dialog.locator('[data-testid="stats-panel"]');
    await expect(panel).toContainText('Distribution');
    await expect(panelValue(panel, 'earliest')).toHaveText(
      '2026-01-01T09:00:00'
    );
    await expect(panelValue(panel, 'latest')).toHaveText('2026-01-12T09:11:00');
    await expect(panelValue(panel, 'time_of_day')).toHaveText(
      '09:00:00 to 09:11:00'
    );

    // The histogram below the metrics uses every payload bin
    const histogram = dialog.locator('[data-testid="histogram"]');
    await expect(histogram).toBeVisible();
    await expect(
      histogram.locator('[data-testid="histogram-bar"]')
    ).toHaveCount(stats.histogram.bins.length);
    const metricsBox = await dialog
      .locator('[data-testid="stats-panel-row-earliest"]')
      .boundingBox();
    const histogramBox = await histogram.boundingBox();
    expect(metricsBox!.y + metricsBox!.height).toBeLessThanOrEqual(
      histogramBox!.y
    );
  });

  test('should replace the date range with the join_date histogram', async ({
    page
  }) => {
    const viewer = await openInViewer(page, 'sample_data.parquet');
    const statsResponse = page.waitForResponse(
      (response: any) =>
        response.url().includes('/column-stats') &&
        response.request().method() === 'POST'
    );
    const dialog = await openStatsDialog(page, viewer, 'join_date');
    const stats = await (await statsResponse).json();
    const panel = dialog.locator('[data-testid="stats-panel"]');
    await expect(panel).toContainText('Distribution');
    await expect(panelValue(panel, 'earliest')).toHaveText(stats.earliest_date);
    await expect(panelValue(panel, 'latest')).toHaveText(stats.latest_date);

    const histogram = dialog.locator('[data-testid="histogram"]');
    await expect(histogram).toBeVisible();
    await expect(
      histogram.locator('[data-testid="histogram-bar"]')
    ).toHaveCount(stats.histogram.bins.length);
    await expect(
      histogram.locator('.jp-ColumnStatsModal-histAxis span').first()
    ).toHaveText(stats.histogram.bins[0].label);
    await expect(
      histogram.locator('.jp-ColumnStatsModal-histAxis span').last()
    ).toHaveText(stats.histogram.bins[stats.histogram.bins.length - 1].label);
  });

  test('should render fractional seconds in the time range', async ({
    page
  }) => {
    const dialog = await openAdaptiveStats(page, 'tick');
    const panel = dialog.locator('[data-testid="stats-panel"]');
    await expect(panel).toContainText('Distribution');
    await expect(panelValue(panel, 'earliest')).toHaveText('09:30:00.500000');
    await expect(panelValue(panel, 'latest')).toHaveText('09:30:10.250000');
    await expect(panelValue(panel, 'span')).toHaveText('0:00:09.750000');
  });

  test('should render the boolean counts', async ({ page }) => {
    const dialog = await openAdaptiveStats(page, 'flag');
    const panel = dialog.locator('[data-testid="stats-panel"]');
    await expect(panel).toContainText('Boolean');
    await expect(panelValue(panel, 'true')).toHaveText('7 (58.3% of non-null)');
    await expect(panelValue(panel, 'false')).toHaveText(
      '5 (41.7% of non-null)'
    );
  });

  test('should render the distribution for a decimal column', async ({
    page
  }) => {
    const dialog = await openAdaptiveStats(page, 'price');
    const panel = dialog.locator('[data-testid="stats-panel"]');
    await expect(panel).toContainText('Distribution');
    const rows: [string, string][] = [
      ['q1', 'Q1'],
      ['q3', 'Q3'],
      ['mean', 'Mean']
    ];
    for (const [key, label] of rows) {
      await expect(
        panel.locator(`[data-testid="stats-panel-row-${key}"]`)
      ).toContainText(label);
      await expect(panelValue(panel, key)).toHaveText(/[\d.]/);
    }
    // The outlier percentage is a share of the non-null values and says so
    await expect(panelValue(panel, 'outliers')).toHaveText(
      '1 (8.3% of non-null)'
    );
  });

  test('should explain that a binary column has no statistics', async ({
    page
  }) => {
    const dialog = await openAdaptiveStats(page, 'payload');
    // No unique tile and no unique pane, even though the payload reports a
    // distinct count: the dialog describes bytes, not placeholder text.
    await expectTiles(dialog, [
      ['Total rows', '12'],
      ['Non-null', '12'],
      ['Null', '0']
    ]);
    await expect(dialog.locator('[data-testid="unique-values"]')).toHaveCount(
      0
    );
    await expect(
      dialog
        .locator('[data-testid="stats-panel"]')
        .locator('.jp-ColumnStatsModal-note')
    ).toHaveText('No statistics are computed for this column.');
  });

  test('should render a nested column as a text block', async ({ page }) => {
    const dialog = await openAdaptiveStats(page, 'tags');
    const panel = dialog.locator('[data-testid="stats-panel"]');
    await expect(panel).toContainText('Text');
    const mostCommon = panel.locator(
      '[data-testid="stats-panel-row-most_common"]'
    );
    await expect(mostCommon).toBeVisible();
    await expect(
      mostCommon.locator('.jp-ColumnStatsModal-rowLabel')
    ).toHaveText('Most common');
    await expect(panelValue(panel, 'most_common')).toHaveText('["a", "b"] (5)');
  });

  test('should show text and distribution statistics for a numeric-text column', async ({
    page
  }) => {
    // A column of digit strings stays a string column, but it has the numeric
    // aggregates too, so the panel carries both blocks.
    const dialog = await openAdaptiveStats(page, 'zip');
    const panel = dialog.locator('[data-testid="stats-panel"]');
    await expect(panel).toContainText('Text');
    await expect(panel).toContainText('Distribution');
    await expect(panelValue(panel, 'min')).toHaveText('2');
    await expect(panelValue(panel, 'max')).toHaveText('10');
    await expect(panelValue(panel, 'mean')).toHaveText('7.25');
    await expect(panelValue(panel, 'median')).toHaveText('8.5');
  });

  test('should report an all-null column as having no values', async ({
    page
  }) => {
    const dialog = await openAdaptiveStats(page, 'blank');
    await expectTiles(dialog, [
      ['Total rows', '12'],
      ['Non-null', '0'],
      ['Null', '12'],
      ['Unique (non-null)', '0']
    ]);
    await expect(
      dialog
        .locator('[data-testid="stats-panel"]')
        .locator('.jp-ColumnStatsModal-note')
    ).toHaveText('The column has no values.');
    // Nothing repeats when nothing is present, so there is no pane to list
    await expect(dialog.locator('[data-testid="unique-values"]')).toHaveCount(
      0
    );
  });

  test('should rank unique values by count with a share bar each', async ({
    page
  }) => {
    const viewer = await openInViewer(page, 'sample_data.parquet');
    const header = viewer.locator('.jp-TabularDataViewer-headerCell', {
      hasText: 'age'
    });

    // Capture the two payloads the dialog renders from, so the rows below are
    // compared against what the backend sent rather than against arithmetic
    // this test repeats back to itself.
    const statsResponse = page.waitForResponse(
      (response: any) =>
        response.url().includes('/column-stats') &&
        response.request().method() === 'POST'
    );
    const uniqueResponse = page.waitForResponse(
      (response: any) =>
        response.url().includes('/unique-values') &&
        response.request().method() === 'POST'
    );
    await header.locator('.jp-TabularDataViewer-infoIcon').click();
    const dialog = page.locator('[data-testid="stats-dialog"]');
    await expect(dialog).toBeVisible({ timeout: GRID_TIMEOUT });
    const stats = await (await statsResponse).json();
    const payload = await (await uniqueResponse).json();

    // The endpoint orders most frequent first
    expect(payload.counts).toEqual(
      [...payload.counts].sort((a: number, b: number) => b - a)
    );

    const rows = dialog.locator('[data-testid="unique-value-row"]');
    await expect(rows).toHaveCount(payload.values.length);

    for (let i = 0; i < payload.values.length; i++) {
      const row = rows.nth(i);
      await expect(row.locator('.jp-ColumnStatsModal-value')).toHaveText(
        payload.values[i]
      );
      await expect(row.locator('.jp-ColumnStatsModal-valueCount')).toHaveText(
        String(payload.counts[i])
      );
      // The bar and the percentage are both the count's share of all rows
      const width = await row
        .locator('.jp-ColumnStatsModal-fill')
        .evaluate((node: HTMLElement) => parseFloat(node.style.width));
      const share = (payload.counts[i] / stats.total_rows) * 100;
      expect(width).toBeCloseTo(share, 2);
      await expect(row.locator('.jp-ColumnStatsModal-valuePct')).toHaveText(
        `${share.toFixed(2)}%`
      );
    }
  });

  test('should name what the unique-values bar and percentage measure', async ({
    page
  }) => {
    // Both the bar and '%' measure the row's count against all rows, so the
    // two always agree.
    const dialog = await openAdaptiveStats(page, 'zip');
    const headers = await dialog
      .locator('.jp-ColumnStatsModal-valueCols span')
      .allTextContents();
    expect(headers).toEqual(['Value', 'Share of rows', 'Count', '%']);

    const fills = await dialog
      .locator('.jp-ColumnStatsModal-fill')
      .evaluateAll((nodes: HTMLElement[]) =>
        nodes.map(node => parseFloat(node.style.width))
      );
    const pcts = await dialog
      .locator('.jp-ColumnStatsModal-valuePct')
      .allTextContents();
    expect(pcts.length).toBe(fills.length);
    for (let i = 0; i < fills.length; i++) {
      expect(parseFloat(pcts[i])).toBeCloseTo(fills[i], 2);
    }
  });

  test.describe('with maxUniqueValues above the farm_id count', () => {
    test.use({
      mockSettings: {
        ...galata.DEFAULT_SETTINGS,
        [PLUGIN_ID]: { maxUniqueValues: 200 }
      }
    });

    test('should wrap a long unique value', async ({ page }) => {
      // farm_id holds 169 distinct values, so its pane appears only when the
      // limit is raised above the default 100. Its values are 36 characters
      // and the values column is narrower than that, so an ellipsis hid the
      // value; the span wraps instead.
      const viewer = await openInViewer(page, 'activity_stats.parquet');
      const header = viewer.locator('.jp-TabularDataViewer-headerCell').filter({
        has: page.locator('.jp-TabularDataViewer-columnName', {
          hasText: /^farm_id$/
        })
      });
      await header.locator('.jp-TabularDataViewer-infoIcon').click();
      const dialog = page.locator('[data-testid="stats-dialog"]');
      await expect(dialog).toBeVisible({ timeout: GRID_TIMEOUT });

      const value = dialog
        .locator('[data-testid="unique-value-row"] .jp-ColumnStatsModal-value')
        .first();
      await expect(value).toBeVisible();
      const metrics = await value.evaluate((node: HTMLElement) => ({
        text: node.textContent,
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
    });
  });

  test('should plot the mean line apart from the median line', async ({
    page
  }) => {
    const dialog = await openAdaptiveStats(page, 'price');
    const plot = dialog.locator('[data-testid="boxplot"]');
    await expect(plot).toBeVisible();

    const mean = plot.locator('.jp-ColumnStatsModal-mean');
    const median = plot.locator('.jp-ColumnStatsModal-median');
    await expect(mean).toBeVisible();
    await expect(median).toBeVisible();
    expect(
      await mean.evaluate(
        (node: HTMLElement) => getComputedStyle(node).borderLeftStyle
      )
    ).toBe('dotted');

    const meanBox = await mean.boundingBox();
    const medianBox = await median.boundingBox();
    expect(meanBox).not.toBeNull();
    expect(medianBox).not.toBeNull();
    expect(meanBox!.x).not.toBe(medianBox!.x);
  });

  test('should style the header chip and expose copy and close actions', async ({
    page
  }) => {
    const viewer = await openInViewer(page, 'adaptive_types.parquet');
    const dialog = await openStatsDialog(page, viewer, 'price');
    const chip = dialog.locator('.jp-ColumnStatsModal-chip');
    await expect(chip).toBeVisible();
    // The backend reports decimal128(10, 2); the chip shows the same simplified
    // label the grid header shows.
    await expect(chip).toHaveText('decimal');
    await expect(
      viewer
        .locator('.jp-TabularDataViewer-headerCell', { hasText: 'price' })
        .locator('.jp-TabularDataViewer-columnType')
    ).toHaveText('decimal');
    const styles = await chip.evaluate((node: HTMLElement) => {
      const computed = getComputedStyle(node);
      return { borderRadius: computed.borderRadius, height: computed.height };
    });
    expect(styles.borderRadius).toBe('2px');
    expect(styles.height).toBe('22px');
    await expect(dialog.locator('[data-testid="copy-stats"]')).toBeVisible();
    await expect(dialog.locator('[data-testid="close-stats"]')).toBeVisible();
  });

  test('should copy the statistics as JSON', async ({ page }) => {
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write']);
    const dialog = await openAdaptiveStats(page, 'price');
    await dialog.locator('[data-testid="copy-stats"]').click();

    // Reading the clipboard is the assertion: a button that only relabels
    // itself would leave the previous clipboard contents in place.
    let text = '';
    await expect
      .poll(
        async () => {
          text = await page.evaluate(() => navigator.clipboard.readText());
          return text;
        },
        { timeout: 10000 }
      )
      .toContain('"column_name"');
    const copied = JSON.parse(text);
    expect(copied.column_name).toBe('price');
  });

  test('should report a refused clipboard write', async ({ page }) => {
    // A denied clipboard left the button unchanged (DEF-STATS-37-COPYFAIL)
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: () => Promise.reject(new Error('clipboard denied'))
        },
        configurable: true
      });
    });
    const dialog = await openAdaptiveStats(page, 'price');
    const copy = dialog.locator('[data-testid="copy-stats"]');
    await copy.click();
    await expect(copy).toHaveText('Copy failed');
  });

  test('should close the dialog on Escape and leave the grid intact', async ({
    page
  }) => {
    const viewer = await openInViewer(page, 'adaptive_types.parquet');
    const dialog = await openStatsDialog(page, viewer, 'id');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(gridRows(viewer)).toHaveCount(12);
  });

  test.describe('keyboard access to the statistics dialog', () => {
    test('should open the dialog from the header control with Enter and Space', async ({
      page
    }) => {
      // The info icon was a hover-only <i> with a click handler, so the dialog
      // could not be opened without a mouse.
      const viewer = await openInViewer(page, 'adaptive_types.parquet');
      const control = statsControl(viewer, 'price');
      await expect(control).toHaveAttribute('role', 'button');
      await expect(control).toHaveAttribute(
        'aria-label',
        'Show statistics for column price'
      );
      expect(await control.evaluate((node: HTMLElement) => node.tabIndex)).toBe(
        0
      );

      const dialog = page.locator('[data-testid="stats-dialog"]');
      await control.focus();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeVisible({ timeout: GRID_TIMEOUT });

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      await control.focus();
      await page.keyboard.press('Space');
      await expect(dialog).toBeVisible({ timeout: GRID_TIMEOUT });
    });

    test('should focus and keyboard-scroll the unique values pane', async ({
      page
    }) => {
      // The values pane was the only scroll region and could not take focus.
      const viewer = await openInViewer(
        page,
        'sample_data.csv',
        'Tabular Data Viewer (Text)'
      );
      const dialog = await openStatsDialog(page, viewer, 'age');
      const pane = dialog.locator('[data-testid="unique-values"]');
      await expect(pane).toHaveAttribute('aria-label', 'Unique values');
      await pane.focus();
      await expect
        .poll(() =>
          pane.evaluate((node: HTMLElement) => document.activeElement === node)
        )
        .toBe(true);

      const before = await pane.evaluate((node: HTMLElement) => node.scrollTop);
      await page.keyboard.press('PageDown');
      await expect
        .poll(() => pane.evaluate((node: HTMLElement) => node.scrollTop))
        .toBeGreaterThan(before);
    });

    test('should return focus to the header control on Escape', async ({
      page
    }) => {
      const viewer = await openInViewer(page, 'adaptive_types.parquet');
      const control = statsControl(viewer, 'price');
      await control.focus();
      await page.keyboard.press('Enter');
      const dialog = page.locator('[data-testid="stats-dialog"]');
      await expect(dialog).toBeVisible({ timeout: GRID_TIMEOUT });

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect
        .poll(() =>
          control.evaluate(
            (node: HTMLElement) => document.activeElement === node
          )
        )
        .toBe(true);
    });

    test('should open exactly one dialog when activated twice while loading', async ({
      page
    }) => {
      // A second activation while the first request was in flight stacked a
      // second dialog when both requests resolved. The glob would not match:
      // ServerConnection appends a cache-buster query to every request.
      let statsRequests = 0;
      await page.route(/\/column-stats(?:\?|$)/, async route => {
        statsRequests += 1;
        await new Promise(resolve => setTimeout(resolve, 1500));
        await route.continue();
      });

      const viewer = await openInViewer(page, 'adaptive_types.parquet');
      const control = statsControl(viewer, 'price');
      await control.focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');

      const dialogs = page.locator('[data-testid="stats-dialog"]');
      await expect(dialogs).toBeVisible({ timeout: GRID_TIMEOUT });
      // A second dialog would open once the shared load completed.
      await page.waitForTimeout(500);
      await expect(dialogs).toHaveCount(1);
      expect(statsRequests).toBe(1);
    });
  });

  test.describe('with maxUniqueValues set to 5', () => {
    test.use({
      mockSettings: {
        ...galata.DEFAULT_SETTINGS,
        [PLUGIN_ID]: { maxUniqueValues: 5 }
      }
    });

    test('should show the pane only for a column within the limit', async ({
      page
    }) => {
      const viewer = await openInViewer(page, 'activity_stats.parquet');

      // alarm_rate_trend holds 33 distinct values, more than the limit of 5,
      // so the pane cannot list them and the dialog stays 720px.
      const overLimit = await openStatsDialog(page, viewer, 'alarm_rate_trend');
      await expect(
        overLimit.locator('[data-testid="unique-values"]')
      ).toHaveCount(0);
      expect(Math.round((await overLimit.boundingBox())!.width)).toBe(720);
      await overLimit.locator('[data-testid="close-stats"]').click();

      // period holds three values, inside the limit: the pane lists all three.
      const withinLimit = await openStatsDialog(page, viewer, 'period');
      await expect(
        withinLimit.locator('.jp-ColumnStatsModal-valuesNote')
      ).toHaveText('3 of 3 listed, ranked by count');
      await expect(
        withinLimit.locator('[data-testid="unique-value-row"]')
      ).toHaveCount(3);
    });
  });

  test.describe('with rowsPerPage set to 10', () => {
    test.use({
      mockSettings: {
        ...galata.DEFAULT_SETTINGS,
        [PLUGIN_ID]: { rowsPerPage: 10 }
      }
    });

    test('should bound the rendered window and nothing else', async ({
      page
    }) => {
      // The window is a setting, not a constant. It bounds what is rendered;
      // the row count, sorting and filtering still see the whole table.
      const viewer = await openInViewer(
        page,
        'sample_data.csv',
        'Tabular Data Viewer (Text)'
      );
      await expect(gridRows(viewer)).toHaveCount(10, {
        timeout: GRID_TIMEOUT
      });
      await expect(
        viewer.locator('.jp-TabularDataViewer-statusRight')
      ).toContainText('Showing 10 of 1500 rows');
      await expect(
        viewer.locator('.jp-TabularDataViewer-statusLeft')
      ).toContainText('1500 rows');

      // A sort re-fetches from the top of the whole table, still 10 wide. The
      // first header cell is the row-number column, whose name is empty and
      // not clickable; the first data column is the second.
      const firstHeader = viewer
        .locator('.jp-TabularDataViewer-headerCell')
        .nth(1);
      await firstHeader.locator('.jp-TabularDataViewer-columnName').click();
      await expect(
        viewer.locator('.jp-TabularDataViewer-statusRight')
      ).toContainText('Showing 10 of 1500 rows');
      expect(await gridRows(viewer).count()).toBe(10);
    });
  });
});
