import { expect, test } from '@playwright/test';

const dangerousMarkdown = [
  '<img src="/missing-markdown-xss" onerror="globalThis.__markdownXss = true">',
  '<a href="javascript:globalThis.__markdownXss=true">bad link</a>',
  '<svg><a href="javascript:globalThis.__markdownXss=true"><text>svg hazard</text></a></svg>',
  '<form action="javascript:globalThis.__markdownXss=true"><button>submit hazard</button></form>',
  '<script>globalThis.__markdownXss = true</script>',
  '',
  '## Safe heading',
  '',
  '| Column |',
  '| --- |',
  '| cell |',
  '',
  '[safe link](https://example.com/docs)',
  '',
  '- [x] preserved task',
].join('\n');

test('Markdown is sanitized in card and rich editor boundaries', async ({ page, request }) => {
  const { board } = await (
    await request.post('/api/canvas/boards', { data: { name: 'Markdown sanitization' } })
  ).json();
  await request.post('/api/canvas/boards/open', { data: { id: board.id } });
  await page.addInitScript(() => {
    (globalThis as typeof globalThis & { __markdownXss?: boolean }).__markdownXss = false;
  });
  const response = await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Markdown safety probe',
      content: dangerousMarkdown,
      x: 120,
      y: 120,
      width: 500,
      height: 520,
    },
  });
  const { id } = (await response.json()) as { id: string };

  await page.goto('/workbench');
  const node = page.locator(`[data-node-id="${id}"]`);
  await expect(node.getByRole('heading', { name: 'Safe heading' })).toBeVisible();
  await expect(node.locator('table')).toContainText('cell');
  await expect(node.locator('input[type="checkbox"]')).toBeChecked();
  await expect(
    node.locator('.md-card-content').locator('script, svg, form, [onerror], a[href^="javascript:"]'),
  ).toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __markdownXss?: boolean }).__markdownXss)).toBe(
    false,
  );

  await node.getByRole('button', { name: 'Edit' }).click();
  const editor = page.locator('.md-reader-editable');
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('heading', { name: 'Safe heading' })).toBeVisible();
  await expect(editor.locator('script, svg, form, [onerror], a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __markdownXss?: boolean }).__markdownXss)).toBe(
    false,
  );
});
