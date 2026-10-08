import { expect, test } from '@playwright/test';

test.use({ deviceScaleFactor: 2 });

for (const width of [1440, 390]) {
  test(`Attach files accepts images and Markdown with a readable format tooltip at ${width}px`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const { board } = await (await request.post('/api/canvas/boards', { data: { name: 'Attach files' } })).json();
    await request.post('/api/canvas/boards/open', { data: { id: board.id } });
    await page.goto(`/workbench?theme=${width === 390 ? 'light' : 'dark'}`);
    const rail = page.locator('.tool-rail');
    for (const name of ['File (Shift+F)', 'Image (I)', 'HTML surface (H)']) {
      await expect(rail.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    for (const name of ['Markdown note (M)', 'Webpage (W)', 'Group (G)']) {
      await expect(rail.getByRole('button', { name, exact: true })).toBeVisible();
    }
    const attach = rail.getByRole('button', { name: 'Attach files', exact: true });
    await attach.focus();
    const tip = page.getByRole('tooltip', { name: /^Attach files/ });
    await expect(tip).toContainText('Images (PNG, JPEG, SVG…), Markdown and text/code files.');
    await expect(tip).toContainText('PDF, Word, Excel, PowerPoint and OpenDocument use agent import with review.');
    await expect(tip).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath(`attach-tooltip-${width}.png`) });

    const chooser = page.waitForEvent('filechooser');
    await attach.click();
    await (await chooser).setFiles([
      {
        name: 'diagram.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="teal"/></svg>',
        ),
      },
      { name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Attached note\n\nATTACH-MARKDOWN-END') },
    ]);
    await expect(page.locator('.canvas-node[data-node-type="image"] img')).toBeVisible();
    await expect(page.locator('.canvas-node[data-node-type="markdown"]')).toContainText('ATTACH-MARKDOWN-END');
    await expect
      .poll(async () => {
        const state = await (await request.get('/api/canvas/state')).json();
        return state.nodes.map((node: { type: string }) => node.type).sort();
      })
      .toEqual(['image', 'markdown']);
    await page.reload();
    await expect(page.locator('.canvas-node[data-node-type="image"] img')).toBeVisible();
    await expect(page.locator('.canvas-node[data-node-type="markdown"]')).toContainText('ATTACH-MARKDOWN-END');
  });
}

test('dropping originals onto an occupied card keeps every card separate', async ({ page, request }, testInfo) => {
  const human = { 'x-pmx-workbench': '1' };
  const { board } = await (await request.post('/api/canvas/boards', { data: { name: 'Attachment placement' } })).json();
  await request.post('/api/canvas/boards/open', { headers: human, data: { id: board.id } });
  const intro = await (
    await request.post('/api/canvas/node', {
      headers: human,
      data: {
        type: 'markdown',
        title: 'Existing introduction',
        content: '# Existing introduction\n\nDrop documents here without covering this note.',
        x: 0,
        y: 0,
        width: 620,
        height: 420,
      },
    })
  ).json();
  await page.goto('/workbench');
  await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  const note = page.locator('.canvas-node').filter({ hasText: 'Existing introduction' });
  const bounds = await note.boundingBox();
  await page.locator('.canvas-viewport').evaluate(
    (el, point) => {
      const dataTransfer = new DataTransfer();
      for (const name of ['quarterly.pdf', 'appendix.docx']) {
        dataTransfer.items.add(new File(['attachment byte-retention fixture'], name));
      }
      el.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX: point.x, clientY: point.y }),
      );
    },
    { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 },
  );
  await expect(page.getByText('Original attached', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  await expect(note).toBeInViewport();
  const nodes = page.locator('.canvas-node');
  await expect(nodes).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const a = await nodes.nth(i).boundingBox();
    await expect(nodes.nth(i)).toBeInViewport();
    for (let j = 0; j < i; j++) {
      const b = await nodes.nth(j).boundingBox();
      expect(
        a!.x >= b!.x + b!.width || b!.x >= a!.x + a!.width || a!.y >= b!.y + b!.height || b!.y >= a!.y + a!.height,
      ).toBe(true);
    }
  }
  const state = await (await request.get('/api/canvas/state')).json();
  expect(state.nodes.find((node: { id: string }) => node.id === intro.id).position).toEqual({ x: 0, y: 0 });
  await page.screenshot({ path: testInfo.outputPath('attachment-placement.png') });
});

for (const width of [1440, 600]) {
  test(`document attachment, agent draft and human review at ${width}px`, async ({ page, request }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const html = await (await request.get('/workbench')).text();
    const encoded = html.match(/window\.__PMX_WORKBENCH_TOKEN = ("[^"]+")/)?.[1];
    if (!encoded) throw new Error('Workbench token was not present in served HTML.');
    const human = {
      'x-pmx-workbench': '1',
      'x-pmx-workbench-token': JSON.parse(encoded) as string,
    };
    const { board } = await (
      await request.post('/api/canvas/boards', { data: { name: `Import review ${width}` } })
    ).json();
    await request.post('/api/canvas/boards/open', { headers: human, data: { id: board.id } });
    await page.goto(`/workbench?theme=${width === 600 ? 'light' : 'dark'}`);
    const source = Buffer.from('%PDF-1.4\n% byte-retention fixture, extraction is agent-supplied\n');
    const attach = page.getByRole('button', { name: 'Attach files', exact: true });
    expect((await attach.boundingBox())!.width).toBe(36);
    expect((await attach.locator('svg').boundingBox())!.width).toBe(15);
    const switcher = page.getByRole('button', { name: /^Board:/ });
    expect((await switcher.locator('.board-switcher-caret svg').boundingBox())!.width).toBe(16);
    await page.screenshot({ path: info.outputPath('toolbar-icons.png') });
    await switcher.click();
    await expect(page.getByRole('menu', { name: 'Boards', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('toolbar-board-menu.png') });
    await page.keyboard.press('Escape');
    const chooser = page.waitForEvent('filechooser');
    await attach.click();
    await (await chooser).setFiles({ name: 'quarterly.pdf', mimeType: 'application/pdf', buffer: source });
    await expect(page.getByText('Original attached', { exact: true })).toBeVisible();
    const { imports } = await (await request.get(`/api/canvas/imports?boardId=${board.id}`)).json();
    const job = imports[0];
    const download = await request.get(`/api/canvas/attachments/${job.attachmentId}/bytes`);
    expect(await download.body()).toEqual(source);
    expect(download.headers()['content-disposition']).toContain('attachment');
    expect(download.headers()['x-content-type-options']).toBe('nosniff');
    const rejected = await request.post(`/api/canvas/imports/${job.id}/request`, { data: { consent: true } });
    expect(rejected.status()).toBe(403);
    await expect(page.getByText(/allows it to process this file with its tools and model provider/)).toBeVisible();
    await page.getByRole('button', { name: 'Ask agent to import' }).click();
    await expect(page.getByText('Waiting for agent', { exact: true })).toBeVisible();
    const submitted = await request.post(`/api/canvas/imports/${job.id}/submit`, {
      data: {
        agentDescription: 'E2E agent protocol fixture (not a PDF converter)',
        sections: [
          {
            title: 'Quarterly finding',
            markdown: '# Quarterly finding\n\nQ2 revenue was **47**, compared with Q1 at **12**.',
            reference: 'page 1',
          },
          {
            title: 'Supporting detail',
            markdown: Array.from({ length: 30 }, (_, i) => `- Detail ${i + 1}`).join('\n'),
            reference: 'page 2',
          },
        ],
        warnings: ['Chart artwork was not extracted.'],
      },
    });
    expect(submitted.ok()).toBe(true);
    await page.getByRole('button', { name: /Review Markdown/ }).click();
    const review = page.getByRole('dialog', { name: 'Review imported Markdown' });
    await expect(review).toContainText('Chart artwork was not extracted.');
    await expect(review).toContainText('47');
    await expect(review.getByRole('button', { name: 'Add to board' })).toBeInViewport();
    const scroller = page.locator('.expanded-body .attachment-node');
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(review.getByRole('button', { name: 'Add to board' })).toBeInViewport();
    const content = await review.locator('pre').last().boundingBox();
    const actions = await review.locator('.attachment-review-actions').boundingBox();
    expect(actions!.y - (content!.y + content!.height)).toBeGreaterThanOrEqual(20);
    await review.getByRole('button', { name: 'Add to board' }).click();
    await expect(page.getByText('Markdown added', { exact: true })).toBeVisible();
    const state = await (await request.get('/api/canvas/state')).json();
    const derived = state.nodes.find((node: { type: string }) => node.type === 'markdown');
    expect(derived.data.source.attachmentId).toBe(job.attachmentId);
    expect(derived.data.content).toContain('47');
    const group = state.nodes.find((node: { type: string }) => node.type === 'group');
    expect(group.data.title).toBe('quarterly.pdf');
    expect(group.data.children).toHaveLength(2);
    await page.reload();
    await expect(page.locator('.group-name').filter({ hasText: 'quarterly.pdf' })).toHaveCount(1);
    await expect(page.getByText('Markdown added', { exact: true })).toBeVisible();
    const search = await (await request.get('/api/canvas/search?q=Quarterly&scope=library')).json();
    expect(JSON.stringify(search)).toContain(derived.id);
    // At 980 px and below the top bar folds Export into its ⋯ More menu.
    if (width > 980) await page.getByRole('button', { name: 'Export', exact: true }).click();
    else {
      await page.getByRole('button', { name: 'More: export, present, zoom, fit' }).click();
      await page.getByRole('menuitem', { name: 'Export board' }).click();
    }
    const dialog = page.getByRole('dialog', { name: 'Export board', exact: true });
    await expect(dialog).toContainText('Original attachments are excluded');
    await expect(dialog.getByRole('checkbox', { name: /Include imported document text/ })).not.toBeChecked();
    await dialog.getByRole('checkbox', { name: /Include imported document text/ }).check();
    await expect(dialog.getByRole('checkbox', { name: /Include imported document text/ })).toBeChecked();
  });
}
