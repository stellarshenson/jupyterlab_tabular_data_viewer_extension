/**
 * Configuration for Playwright using default from @jupyterlab/galata
 */
const baseConfig = require('@jupyterlab/galata/lib/playwright-config');

// Use port 8889 for local development to avoid conflicts, 8888 for CI
const port = process.env.CI ? '8888' : '8889';

module.exports = {
  ...baseConfig,
  // Galata resolves the target as use.baseURL -> TARGET_URL -> localhost:8888, and its
  // base config sets no baseURL. Without this the local run drives whatever answers on
  // 8888 (a developer's own lab) instead of the test server on `port`.
  use: { ...baseConfig.use, baseURL: `http://localhost:${port}` },

  // Galata's base timeout is 60s, which is the same budget a single grid wait
  // can consume; a slow file open plus the splash wait then trips the test
  // timeout before the assertion's own timeout can report anything useful.
  timeout: 180 * 1000,

  // One worker: every spec drives the same Jupyter server, and several browsers
  // contending for it is what pushed a file open past 15s in the first place.
  workers: 1,
  fullyParallel: false,

  // One retry on CI only. Runner variance (a cold page load, a slow contents
  // fetch) is real; a genuinely broken test still fails both attempts, so this
  // absorbs noise without hiding a regression.
  retries: process.env.CI ? 1 : 0,
  webServer: {
    command: process.env.CI
      ? 'jlpm start'
      : `jupyter lab --config jupyter_server_test_config.py --port=${port}`,
    url: `http://localhost:${port}/lab`,
    timeout: 120 * 1000,
    // Never adopt a server we did not start. `!process.env.CI` silently
    // attaches to whatever answers on the port - a developer's own lab, or a
    // concurrent suite run whose server then exits mid-test and fails every
    // remaining test with ERR_CONNECTION_REFUSED.
    reuseExistingServer: false
  }
};
