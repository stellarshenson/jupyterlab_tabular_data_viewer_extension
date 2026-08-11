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
 * One page of rows, as shipped: the `rowsPerPage` setting's default.
 *
 * Every export assertion below is a comparison against this - an export that
 * returned only what the grid shows would come back with this many rows.
 */
const PAGE_SIZE = 500;

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

    const xlsxViewer = await openInViewer(page, 'sample_data.xlsx');
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

    const viewer = await openInViewer(page, 'multi_sheet.xlsx');
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
});
