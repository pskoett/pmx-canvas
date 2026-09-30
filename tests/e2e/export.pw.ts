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

for (const scheme of ['light', 'dark']) {
  test(`export typography and every node type remain readable offline in ${scheme}`, async ({
    page,
    request,
  }, testInfo) => {
    await request.post('/api/canvas/clear', { headers: HUMAN });
    await request.post('/api/canvas/theme', { headers: HUMAN, data: { theme: scheme } });
    const markdown = [
      '# Release review',
      'A readable summary with **clear emphasis**, `inline code`, and enough space to scan.',
      '## Delivery costs',
      '| Team | Owner | Status | Requests | Cost | Notes |',
      '| :--- | :--- | :--- | ---: | ---: | :--- |',
      '| News | Amira | Ready | 1,240 | 37.80 | Reviewed and approved |',
      '| Sports | Jonas | In review | 318 | 9.45 | Waiting for final figures |',
      '| Culture | Lin | Ready | 92 | 2.10 | No outstanding changes |',
      '',
      '> Imported figures should be checked against the source before publishing.',
      '## Follow-up',
      '- Review the figures\n- Publish the approved report\n  - Keep the original attachment private',
      '```ts\nconst result = await exportBoard({ includeFiles: false, includeDerivedText: false });\n```',
      '<script>window.exportUnsafe = true</script>',
    ]
      .join('\n\n')
      .replaceAll('|\n\n|', '|\n|');
    const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="160"><rect width="360" height="160" fill="#176da8"/><text x="24" y="88" fill="white" font-size="24">Quarterly report</text></svg>')}`;
    const fixtures = [
      { type: 'markdown', title: 'Release review', content: markdown },
      {
        type: 'status',
        title: 'Review status',
        content: 'Complete',
        data: { detail: 'All figures checked', activeTool: 'validate' },
      },
      {
        type: 'context',
        title: 'Review context',
        data: {
          currentTokens: 420,
          tokenLimit: 1000,
          cards: [{ title: 'Source report', summary: 'Published quarterly figures' }],
        },
      },
      { type: 'ledger', title: 'Checks', content: 'Passed: 15\\nFailed: 0' },
      {
        type: 'trace',
        title: 'Validation trace',
        content: 'Validated 3 teams',
        data: { status: 'success', duration: '12ms' },
      },
      {
        type: 'file',
        title: 'teams.csv',
        content: 'Team,Cost,Notes\n"News, sports",37.80,"Reviewed, approved"\nCulture,2.10,Ready',
      },
      { type: 'diff', title: 'Report changes', content: '@@ totals @@\n-requests: 1200\n+requests: 1240' },
      { type: 'image', title: 'Report image', content: image, data: { caption: 'Source: quarterly report' } },
      { type: 'html', title: 'HTML report', html: '<h1>Report widget</h1><p>Static HTML content</p>' },
      { type: 'mermaid', title: 'Review flow', content: 'flowchart LR\nA[Review] --> B[Publish]' },
      { type: 'mcp-app', title: 'Live application', data: { url: 'https://app.example/' } },
      {
        type: 'webpage',
        title: 'Report link',
        url: 'https://report.example/',
        data: { description: 'Quarterly report reference' },
      },
      { type: 'board', title: 'Related board', data: { boardId: 'not-exported' } },
      { type: 'prompt', title: 'Review question', data: { text: 'Are the figures ready?\nPlease check the totals.' } },
      { type: 'response', title: 'Review answer', data: { content: 'The **totals** are ready.' } },
      { type: 'group', title: 'Review group' },
    ];
    const seeded = await request.post('/api/canvas/batch', {
      headers: HUMAN,
      data: {
        operations: fixtures.map((fixture, i) => ({
          op: 'node.add',
          args: { ...fixture, x: (i % 4) * 500, y: Math.floor(i / 4) * 360, width: 460, height: 320 },
        })),
      },
    });
    expect(seeded.ok(), await seeded.text()).toBeTruthy();
    const chart = await request.post('/api/canvas/graph', {
      headers: HUMAN,
      data: {
        title: 'Cost chart',
        graphType: 'bar',
        data: [
          { label: 'News', value: 37.8 },
          { label: 'Culture', value: 2.1 },
        ],
        xKey: 'label',
        yKey: 'value',
        x: 0,
        y: 1440,
        width: 460,
        nodeHeight: 320,
        height: 220,
      },
    });
    expect(chart.ok()).toBeTruthy();
    const json = await request.post('/api/canvas/json-render', {
      headers: HUMAN,
      data: {
        title: 'Structured report',
        x: 500,
        y: 1440,
        width: 460,
        height: 320,
        spec: {
          root: 'card',
          elements: {
            card: { type: 'Card', props: { title: 'Report summary' }, children: ['text'] },
            text: { type: 'Text', props: { text: '3 teams reviewed' } },
          },
        },
      },
    });
    expect(json.ok()).toBeTruthy();
    const exported = await request.post('/api/canvas/export', { headers: HUMAN, data: {} });
    expect(exported.ok()).toBeTruthy();
    const { path } = await exported.json();
    await page.goto(`file://${path}`);
    await expect(page.locator('html')).toHaveAttribute('data-scheme', scheme);
    await expect(page.locator('.card')).toHaveCount(18);
    const card = (type: string) => page.locator(`.card[data-node-type="${type}"]`);
    for (const [type, expected] of [
      ['status', 'All figures checked'],
      ['context', 'Published quarterly figures'],
      ['ledger', 'Passed: 15\nFailed: 0'],
      ['trace', 'Validated 3 teams'],
      ['prompt', 'Are the figures ready?'],
      ['response', 'The totals are ready.'],
      ['webpage', 'Quarterly report reference'],
      ['board', 'Linked board is not included'],
      ['mcp-app', 'Live app — open this board'],
      ['group', 'Review group'],
    ])
      await expect(card(type)).toContainText(expected);
    await expect(card('file').locator('tbody tr').first().locator('td')).toHaveText([
      'News, sports',
      '37.80',
      'Reviewed, approved',
    ]);
    await expect(card('diff').locator('.add')).toHaveText('+requests: 1240');
    await expect(card('diff').locator('.del')).toHaveText('-requests: 1200');
    await expect(card('image').locator('img')).toBeVisible();
    expect(
      await card('image')
        .locator('img')
        .evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
    ).toBe(true);
    const caption = await card('image').locator('figcaption').boundingBox();
    const imageBody = await card('image').locator('.card-body').boundingBox();
    expect(caption!.y + caption!.height).toBeLessThanOrEqual(imageBody!.y + imageBody!.height);
    await expect(card('html').frameLocator('iframe').getByRole('heading', { name: 'Report widget' })).toBeVisible();
    await expect(card('mermaid').frameLocator('iframe').locator('svg')).toBeVisible();
    await expect(card('json-render').frameLocator('iframe').getByText('3 teams reviewed')).toBeVisible();
    await expect(card('graph').frameLocator('iframe').locator('.recharts-bar-rectangle')).toHaveCount(2);
    for (const type of ['html', 'mermaid', 'json-render', 'graph']) {
      await expect(card(type).locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
      expect((await card(type).locator('iframe').boundingBox())!.height).toBeGreaterThan(70);
    }

    // Wheel scrolling must read overflowing content, not zoom the whole board.
    const note = card('markdown');
    const transform = await page.locator('#world').getAttribute('style');
    await note.locator('.card-body').hover();
    await page.mouse.wheel(0, 220);
    await expect.poll(() => note.locator('.card-body').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.locator('#world').getAttribute('style')).toBe(transform);
    await note.getByRole('button').focus();
    await page.keyboard.press('Enter');
    const reader = page.getByRole('dialog', { name: 'Release review' });
    await expect(reader.getByRole('button', { name: 'Close' })).toBeFocused();
    await expect(reader.locator('h1')).toHaveText('Release review');
    await expect(reader.locator('th').nth(4)).toHaveCSS('text-align', /^(?:-webkit-)?right$/);
    await expect(reader.locator('td').first()).toHaveCSS('padding', '10px 14px');
    await expect(reader.locator('pre')).toHaveCSS('white-space', 'pre');
    await expect(reader.locator('.card-body')).toContainText('<script>window.exportUnsafe = true</script>');
    expect(await page.evaluate(() => 'exportUnsafe' in window)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`export-${scheme}.png`) });

    // Narrow panes retain all columns with local horizontal scrolling.
    await page.setViewportSize({ width: 600, height: 900 });
    const table = reader.getByRole('region', { name: 'Table' });
    expect(await table.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await table.focus();
    await page.keyboard.press('End');
    await table.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    expect(await table.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    expect(await reader.locator('.card-body').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`export-${scheme}-narrow.png`) });
    await page.keyboard.press('Escape');
    await expect(reader).toBeHidden();
    await expect(note.getByRole('button')).toBeFocused();
  });
}
