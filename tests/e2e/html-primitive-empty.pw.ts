import { expect, test } from '@playwright/test';

for (const mode of ['src', 'srcdoc']) {
  test(`primitive Copy JSON uses current sandbox state from the card menu (${mode})`, async ({
    page,
    request,
    context,
  }) => {
    const headers = { 'x-pmx-workbench': '1' };
    await request.post('/api/canvas/clear', { headers });
    await request.post('/api/canvas/viewport', { headers, data: { x: 0, y: 0, scale: 1 } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    if (mode === 'srcdoc') await page.route('**/api/canvas/iframe-probe', (route) => route.abort());
    const staticData = { items: [{ title: 'Keep exact input', pros: ['One'], cons: [] }] };
    const flags = [
      { key: 'preview', label: 'Preview', enabled: false },
      { key: 'stable', label: 'Stable', enabled: true },
    ];
    const created = [];
    for (const [i, data] of [
      { type: 'html-primitive', kind: 'choice-grid', data: staticData },
      { type: 'html-primitive', kind: 'config-editor', data: { flags } },
      { type: 'html', html: '<p>Not a primitive</p>' },
    ].entries()) {
      const response = await request.post('/api/canvas/node', {
        headers,
        data: { ...data, x: 80 + i * 620, y: 100, width: 580, height: 500, strictSize: true },
      });
      expect(response.ok()).toBe(true);
      created.push((await response.json()).id as string);
    }
    await page.goto('/workbench');
    const card = (id: string) => page.locator(`.canvas-node[data-node-id="${id}"]`);
    const openMenu = async (id: string) => {
      await card(id).focus();
      await page.keyboard.press('Shift+F10');
      await expect(page.getByRole('menu', { name: 'Node actions' })).toBeVisible();
    };
    const copy = async (id: string) => {
      await openMenu(id);
      await page.getByRole('menuitem', { name: 'Copy JSON', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('menu', { name: 'Node actions' })).toHaveCount(0);
    };
    for (const id of created.slice(0, 2)) {
      await expect(card(id).locator('.viewer-fallback')).toHaveCount(0);
      const frame = card(id).frameLocator('iframe:not([inert])');
      await expect(frame.locator('header.hero')).toBeVisible();
      await expect(frame.getByRole('button', { name: /Copy JSON|Copy prompt/ })).toHaveCount(0);
    }
    await page.evaluate(() => navigator.clipboard.writeText('https://example.com/previous-clipboard'));
    await copy(created[0]);
    // The menu closes before the asynchronous sandbox/clipboard handoff ends.
    await expect(async () => {
      expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(staticData);
    }).toPass({ timeout: 5000 });
    const interactive = card(created[1]).frameLocator('iframe:not([inert])');
    await interactive.getByRole('checkbox', { name: /Preview/ }).check();
    await expect(interactive.getByRole('button', { name: 'Copy diff', exact: true })).toBeVisible();
    await copy(created[1]);
    const edited = { flags: [{ ...flags[0], enabled: true }, flags[1]] };
    await expect(async () => {
      expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(edited);
    }).toPass({ timeout: 5000 });
    const state = await (await request.get('/api/canvas/state')).json();
    expect(state.nodes.find((node: { id: string }) => node.id === created[1]).data.primitiveData.flags).toEqual(flags);
    await openMenu(created[1]);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Node actions' })).toHaveCount(0);
    await openMenu(created[2]);
    await expect(page.getByRole('menuitem', { name: 'Copy JSON', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.evaluate(() =>
      Object.defineProperty(navigator.clipboard, 'write', {
        value: () => Promise.reject(new Error('Clipboard denied for test')),
      }),
    );
    await copy(created[1]);
    await expect(page.locator('.attention-toast')).toContainText('Could not copy JSON', { timeout: 15000 });
    expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(edited);
    // Reload installs a new document owner. It must not export the old draft.
    await page.reload();
    await expect(interactive.getByRole('checkbox', { name: /Preview/ })).not.toBeChecked();
    await copy(created[1]);
    await expect(async () => {
      expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual({ flags });
    }).toPass({ timeout: 5000 });
    await openMenu(created[1]);
    await page.getByRole('menuitem', { name: 'Collapse', exact: true }).click();
    await expect(card(created[1]).locator('iframe')).toHaveCount(0);
    await copy(created[1]);
    await expect(page.locator('.attention-toast')).toContainText('Could not copy JSON');
    expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual({ flags });
  });
}

test('empty primitive sections disappear and their scripts still run', async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const cases = [
    ['choice-grid', { items: [] }],
    ['plan-timeline', { milestones: [], flow: [], risks: [] }],
    ['component-gallery', { component: '', variants: [] }],
    ['flowchart', { steps: [], failurePaths: [] }],
    ['deck', { slides: [] }],
    ['presentation', { slides: [] }],
    ['config-editor', { flags: [] }],
    ['prompt-tuner', { template: '', samples: [] }],
    ['ax-flow', { steps: [], note: '' }],
  ] as const;
  for (const [kind, data] of cases) {
    const created = await request.post('/api/canvas/node', {
      headers: { 'x-pmx-workbench': '1' },
      data: { type: 'html-primitive', kind, data },
    });
    expect(created.ok()).toBe(true);
    const { id } = (await created.json()) as { id: string };
    try {
      await page.goto(`/api/canvas/surface/${id}`);
      await expect(page.locator('body section')).toHaveCount(0);
      await page.keyboard.press('ArrowRight');
      if (kind === 'plan-timeline') await page.screenshot({ path: testInfo.outputPath('empty-timeline.png') });
    } finally {
      await request.delete(`/api/canvas/node/${id}`, { headers: { 'x-pmx-workbench': '1' } });
    }
  }
  expect(errors).toEqual([]);
});

for (const theme of ['dark', 'light']) {
  test(`status report omits empty fields but keeps supplied content in ${theme}`, async ({
    page,
    request,
  }, testInfo) => {
    const created = await request.post('/api/canvas/node', {
      headers: { 'x-pmx-workbench': '1' },
      data: {
        type: 'html-primitive',
        kind: 'status-report',
        title: 'Release readiness',
        data: {
          metrics: [{ label: 'Verified checks', value: 12 }],
          shipped: [],
          slipped: null,
          risks: '',
          next: ['Review the verified release'],
        },
      },
    });
    expect(created.ok()).toBe(true);
    const { id } = (await created.json()) as { id: string };
    try {
      await page.goto(`/api/canvas/surface/${id}?theme=${theme}`);
      await expect(page.getByRole('heading', { name: /^(Shipped|Slipped|Risks)$/ })).toHaveCount(0);
      await expect(page.getByText('Review the verified release')).toBeVisible();
      await expect(page.getByText('Verified checks')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`status-empty-${theme}.png`) });
    } finally {
      await request.delete(`/api/canvas/node/${id}`, { headers: { 'x-pmx-workbench': '1' } });
    }
  });
}
