import { expect, test } from '@playwright/test';
import { loadCopilotCanvas } from '../helpers/copilot-adapter.js';

test.use({ viewport: { width: 600, height: 900 }, deviceScaleFactor: 2 });

for (const recovery of ['automatic', 'button']) {
  test(`Copilot fallback ${recovery} recovery opens real Home and boards`, async ({ page, request, baseURL }, info) => {
    const health = await (await request.get('/health')).json();
    let available = false;
    const canvas = loadCopilotCanvas(async (url, options) => {
      if (!available) throw new Error('Simulated server outage');
      return fetch(url, options);
    });
    const instanceId = `browser-${recovery}`;
    const opened = await canvas.open({
      instanceId,
      input: { serverUrl: baseURL, workspaceRoot: health.workspace, autoStart: false },
    });
    try {
      const { board } = await (
        await request.post('/api/canvas/boards', { data: { name: `Recovered ${recovery} board` } })
      ).json();
      expect((await request.post('/api/canvas/boards/open', { data: { id: board.id } })).ok()).toBe(true);
      await page.goto(opened.url);
      await expect(page.getByRole('heading', { name: 'Connect to PMX Canvas' })).toBeVisible();
      await expect(page.getByRole('status')).toContainText('No matching PMX Canvas server');
      await expect(page.locator('iframe')).toHaveCount(0);
      const start = page.getByRole('button', { name: 'Start server' });
      await expect(start).toBeEnabled();
      expect((await start.boundingBox())!.height).toBeGreaterThanOrEqual(40);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath('copilot-unavailable.png') });

      if (recovery === 'button') {
        await page.route(`${opened.url}start`, (route) =>
          route.fulfill({ status: 500, json: { error: 'Unable to start the local server.' } }),
        );
        await start.click();
        await expect(page.getByRole('status')).toHaveText('Unable to start the local server.');
        await expect(start).toBeEnabled();
        await page.unroute(`${opened.url}start`);
        available = true;
        await start.click();
      } else {
        available = true;
      }

      // Automatic recovery polls every 2s with a 500ms health timeout. Allow a
      // transient slow probe to fail and retry before requiring real navigation.
      await expect(page).toHaveURL(`${baseURL}/workbench?theme=light`, { timeout: 10_000 });
      await expect(page.getByRole('button', { name: `Board: Recovered ${recovery} board` })).toBeVisible();
      const action = canvas.actions.find((candidate) => candidate.name === 'add_work_item')!;
      const result = await action.handler({ instanceId, input: { title: 'Recovered adapter task' } });
      expect(result).toMatchObject({ ok: true });
      const state = await (await request.get('/api/canvas/ax?includeContext=false')).json();
      expect(state.state.workItems.some((item: { title: string }) => item.title === 'Recovered adapter task')).toBe(
        true,
      );

      await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
      await expect(page.getByTestId('home-view')).toBeVisible();
      await expect(
        page.getByTestId('home-view').getByText(`Recovered ${recovery} board`, { exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: info.outputPath('copilot-recovered-home.png') });
    } finally {
      await page.goto('about:blank');
      await canvas.onClose({ instanceId });
    }
  });
}
