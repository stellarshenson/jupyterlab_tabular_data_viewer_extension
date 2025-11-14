import { expect, galata, test } from '@jupyterlab/galata';
import * as path from 'path';

test.describe('Tabular Data Viewer Extension', () => {
  test.beforeEach(async ({ page, request, tmpPath }) => {
    // Upload test data files for this test
    const contents = galata.newContentsHelper(request);
    const dataDir = path.resolve(__dirname, '..', '..', 'data');
    const testFiles = [
      'sample_data.parquet',
      'sample_data.csv',
      'sample_data.xlsx'
    ];

    for (const filename of testFiles) {
      const filePath = path.join(dataDir, filename);
      await contents.uploadFile(filePath, filename, tmpPath);
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
    await page.waitForSelector('text=sample_data.parquet', { timeout: 10000 });

    // Open the Parquet file
    await page.dblclick('text=sample_data.parquet');

    // Verify the viewer opens and is visible in the main area
    await page.waitForSelector(
      '.jp-MainAreaWidget:not(.lm-mod-hidden) .jp-TabularDataViewer',
      {
        state: 'visible',
        timeout: 15000
      }
    );
  });

  test('should open and display CSV file', async ({ page }) => {
    // Wait for file to be visible in file browser
    await page.waitForSelector('text=sample_data.csv', { timeout: 10000 });

    // Right-click on the CSV file to open context menu
    await page.click('text=sample_data.csv', { button: 'right' });

    // Wait for context menu to appear and click "Open With" -> "Tabular Data Viewer (Text)"
    await page.waitForSelector('.lm-Menu-content', { timeout: 5000 });
    await page.click('text=Open With');
    await page.waitForSelector('text=Tabular Data Viewer (Text)', {
      timeout: 5000
    });
    await page.click('text=Tabular Data Viewer (Text)');

    // Verify the viewer opens and is visible in the main area
    await page.waitForSelector(
      '.jp-MainAreaWidget:not(.lm-mod-hidden) .jp-TabularDataViewer',
      {
        state: 'visible',
        timeout: 15000
      }
    );
  });

  test('should open and display Excel file', async ({ page }) => {
    // Wait for file to be visible in file browser
    await page.waitForSelector('text=sample_data.xlsx', { timeout: 10000 });

    // Open the Excel file
    await page.dblclick('text=sample_data.xlsx');

    // Verify the viewer opens and is visible in the main area
    await page.waitForSelector(
      '.jp-MainAreaWidget:not(.lm-mod-hidden) .jp-TabularDataViewer',
      {
        state: 'visible',
        timeout: 15000
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
      await page.waitForSelector(`text=${fileName}`, { timeout: 10000 });

      // Open the file - use explicit "Open With" for CSV
      if (fileName.includes('.csv')) {
        // Right-click to open context menu
        await page.click(`text=${fileName}`, { button: 'right' });
        await page.waitForSelector('.lm-Menu-content', { timeout: 5000 });
        await page.click('text=Open With');
        await page.waitForSelector('text=Tabular Data Viewer (Text)', {
          timeout: 5000
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
          timeout: 15000
        }
      );

      // Close the tab to prepare for next file
      await page.keyboard.press('Control+w');
      await page.waitForTimeout(500);
    }
  });
});
