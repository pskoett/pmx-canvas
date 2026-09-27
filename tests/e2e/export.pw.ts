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
      content: 'Readable **everywhere**',
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

  await page.goto('/workbench');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByTestId('export-dialog');
  await expect(dialog).toContainText('2 cards');
  await expect(dialog).toContainText('1 embedded pages, charts or diagrams');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  const result = dialog.getByTestId('export-result');
  await expect(result).toContainText('Saved');
  const path = (await result.locator('code').textContent())?.trim() ?? '';
  expect(path).toMatch(/\.html$/);

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
