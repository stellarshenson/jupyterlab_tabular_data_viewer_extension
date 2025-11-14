/**
 * Configuration for Playwright using default from @jupyterlab/galata
 */
const baseConfig = require('@jupyterlab/galata/lib/playwright-config');

// Use port 8889 for local development to avoid conflicts, 8888 for CI
const port = process.env.CI ? '8888' : '8889';

module.exports = {
  ...baseConfig,
  webServer: {
    command: process.env.CI
      ? 'jlpm start'
      : `jupyter lab --config jupyter_server_test_config.py --port=${port}`,
    url: `http://localhost:${port}/lab`,
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI
  }
};
