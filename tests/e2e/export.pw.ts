/**
 * Static board export (plan 013): export from the top bar, then open the file
 * the way a colleague would — straight from disk — and check it works.
 */
import { expect, test } from '@playwright/test';

const HUMAN = { 'x-pmx-workbench': '1' };

test('export a board from the top bar and open the file with no server', async ({ page, request }) => {
  await request.post('/api/canvas/clear', { headers: HUMAN });
  await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Export note',
      content: 'Readable **everywhere** — [project](https://project.example/docs)',
      x: 0,
      y: 0,
      width: 320,
      height: 180,
    },
  });
  await request.post('/api/canvas/graph', {
    data: {
      title: 'Export chart',
      graphType: 'bar',
      data: [
        { label: 'A', value: 3 },
        { label: 'B', value: 5 },
      ],
      xKey: 'label',
      yKey: 'value',
      x: 380,
      y: 0,
    },
  });
  await request.post('/api/canvas/node', {
    data: {
      type: 'html',
      title: 'Network widget',
      html: '<script src="https://widgets.example/embed.js"></script>',
      x: 760,
      y: 0,
      width: 320,
      height: 180,
    },
  });

  await page.goto('/workbench');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByTestId('export-dialog');
  await expect(dialog).toContainText('3 cards');
  await expect(dialog).toContainText('2 embedded pages, charts or diagrams');
  await expect(dialog).toContainText('Links included in cards: https://project.example/docs');
  await expect(dialog).toContainText(
    'Network destinations referenced by embedded pages: https://widgets.example/embed.js',
  );
  await expect(dialog).toContainText('embedded code can access the network');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  const result = dialog.getByTestId('export-result');
  await expect(result).toContainText('Saved');
  const path = (await result.locator('code').textContent())?.trim() ?? '';
  expect(path).toMatch(/\.html$/);
  for (const name of ['Open', 'Download']) {
    const action = result.getByRole('link', { name, exact: true });
    await expect(action).toBeVisible();
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(38);
    await expect(action).toHaveCSS('text-decoration-line', 'none');
    await action.focus();
    await expect(action).toBeFocused();
  }
  const [opened] = await Promise.all([
    page.waitForEvent('popup'),
    result.getByRole('link', { name: 'Open', exact: true }).click(),
  ]);
  await expect(opened.locator('.card').filter({ hasText: 'Export note' })).toBeVisible();
  await opened.close();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    result.getByRole('link', { name: 'Download', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.html$/);
  expect(await download.failure()).toBeNull();

  // A colleague opens the file from disk: no server, read-only.
  await page.goto(`file://${path}`);
  const note = page.locator('.card').filter({ hasText: 'Export note' });
  await expect(note).toBeInViewport();
  await expect(note.locator('strong')).toHaveText('everywhere');
  const chart = page.locator('.card').filter({ hasText: 'Export chart' });
  await expect(chart.frameLocator('iframe').locator('.recharts-bar-rectangle').first()).toBeVisible();

  // A card expands, and zoom changes what is on screen.
  await note.locator('.card-title').click();
  await expect(page.locator('#overlay')).toBeVisible();
  await expect(page.locator('#overlay')).toContainText('Readable everywhere');
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay')).toBeHidden();
  const before = await note.boundingBox();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  expect((await note.boundingBox())?.width).toBeGreaterThan(before?.width ?? 0);
});
