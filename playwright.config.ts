import { defineConfig } from '@playwright/test';

const port = Number(process.env.PMX_PLAYWRIGHT_PORT ?? '4517');
const stateFile = process.env.PMX_PLAYWRIGHT_STATE_FILE ?? 'test-results/playwright/.pmx-canvas.json';
const dbPath = process.env.PMX_PLAYWRIGHT_DB_PATH ?? 'test-results/playwright/canvas.db';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.pw.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: '**/reference-pane.pw.ts',
      use: { viewport: { width: 1440, height: 900 } },
    },
    // The reference cases (reference-pane.pw.ts) run across the sizes the
    // workbench lives at: an agent-host pane or the Claude desktop side browser,
    // the middle between the 900/1180 px layout breakpoints, and a full window.
    {
      name: 'narrow-600',
      testMatch: '**/reference-pane.pw.ts',
      use: { viewport: { width: 600, height: 900 } },
    },
    {
      name: 'middle-1024',
      testMatch: '**/reference-pane.pw.ts',
      use: { viewport: { width: 1024, height: 768 } },
    },
    {
      name: 'wide-1920',
      testMatch: '**/reference-pane.pw.ts',
      use: { viewport: { width: 1920, height: 1080 } },
    },
  ],
  webServer: {
    command: `PMX_CANVAS_STATE_FILE=${stateFile} PMX_CANVAS_DB_PATH=${dbPath} bun run src/cli/index.ts --no-open --port=${port}`,
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
  },
});
