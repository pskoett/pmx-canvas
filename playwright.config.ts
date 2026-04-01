import { defineConfig } from '@playwright/test';

const port = Number(process.env.PMX_PLAYWRIGHT_PORT ?? '4517');
const stateFile = process.env.PMX_PLAYWRIGHT_STATE_FILE ?? 'test-results/playwright/.pmx-canvas.json';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.pw.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: {
      width: 1440,
      height: 900,
    },
  },
  webServer: {
    command: `PMX_CANVAS_STATE_FILE=${stateFile} bun run src/cli/index.ts --no-open --port=${port}`,
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
  },
});
