import { expect, test } from '@playwright/test';

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
