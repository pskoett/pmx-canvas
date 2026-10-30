import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// The owner acceptance run (scripts/acceptance.ts): the same suites and server as
// playwright.config.ts, but every test keeps a video so each guide row carries its own proof.
// Videos record at each project's full viewport; Playwright's default scales them to fit 800x800.
export default defineConfig({
  ...base,
  outputDir: 'test-results/acceptance/playwright',
  reporter: [['list'], ['json', { outputFile: 'test-results/acceptance/playwright.json' }]],
  use: { ...base.use, trace: 'retain-on-failure' },
  projects: base.projects?.map((project) => ({
    ...project,
    use: { ...project.use, video: { mode: 'on', size: project.use?.viewport ?? { width: 1440, height: 900 } } },
  })),
});
