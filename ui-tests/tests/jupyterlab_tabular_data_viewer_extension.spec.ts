import { expect, galata, test } from '@jupyterlab/galata';
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
 * Open a file from the file browser and wait for the viewer to appear
 */
async function openInViewer(page: any, fileName: string): Promise<any> {
  const item = page
    .locator('.jp-DirListing-content')
    .getByText(fileName, { exact: true });
  await item.waitFor({ state: 'visible', timeout: 30000 });
  await item.dblclick();

  const viewer = activeViewer(page);
  await viewer.waitFor({ state: 'visible', timeout: GRID_TIMEOUT });
  await waitForGridReady(viewer);
  return viewer;
}

test.describe('Tabular Data Viewer Extension', () => {
  test.beforeEach(async ({ page, request, tmpPath }) => {
    // Upload test data files for this test
    const contents = galata.newContentsHelper(request);
    const dataDir = path.resolve(__dirname, '..', '..', 'data');
    const testFiles = [
      'sample_data.parquet',
      'sample_data.csv',
      'sample_data.xlsx',
      'sample_database.db'
    ];

    // Upload into tmpPath - that is the directory the galata file browser opens
    for (const filename of testFiles) {
      const filePath = path.join(dataDir, filename);
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
          'JupyterLab extension jupyterlab_tabular_data_viewer_extension is activated!'
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
    // Wait for file to be visible in file browser
    await page.waitForSelector('text=sample_data.xlsx', { timeout: 30000 });

    // Open the Excel file
    await page.dblclick('text=sample_data.xlsx');

    // Verify the viewer opens and is visible in the main area
    await page.waitForSelector(
      '.jp-MainAreaWidget:not(.lm-mod-hidden) .jp-TabularDataViewer',
      {
        state: 'visible',
        timeout: GRID_TIMEOUT
      }
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

      // Open the file - use explicit "Open With" for CSV
      if (fileName.includes('.csv')) {
        // Right-click to open context menu
        await page.click(`text=${fileName}`, { button: 'right' });
        await page.waitForSelector('.lm-Menu-content', { timeout: 15000 });
        await page.click('text=Open With');
        await page.waitForSelector('text=Tabular Data Viewer (Text)', {
          timeout: 15000
        });
        await page.click('text=Tabular Data Viewer (Text)');
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
});
