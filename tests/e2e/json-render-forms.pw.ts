import { expect, test } from '@playwright/test';

test.use({ deviceScaleFactor: 2 });

test('literal form values render bound; unbindable values warn', async ({ page, request }) => {
  const spec = {
    root: 'root',
    state: { postcode: 'nw1 6xe', notes: 'Delivery note', city: 'London' },
    elements: {
      root: { type: 'Stack', props: {}, children: ['literal', 'readOnly', 'input', 'textarea', 'select', 'echo'] },
      literal: { type: 'Input', props: { label: 'Literal postcode', value: 'nw1 6xe' } },
      readOnly: { type: 'Input', props: { label: 'Read-only postcode', value: { $state: '/postcode' } } },
      input: { type: 'Input', props: { label: 'Postcode', value: { $bindState: '/postcode' } } },
      textarea: { type: 'Textarea', props: { label: 'Notes', value: { $bindState: '/notes' } } },
      select: {
        type: 'Select',
        props: { label: 'City', options: ['Paris', 'London'], value: { $bindState: '/city' } },
      },
      echo: { type: 'Text', props: { text: { $state: '/postcode' } } },
    },
  };
  const validated = await request.post('/api/canvas/schema/validate', { data: { type: 'json-render', spec } });
  expect(validated.ok()).toBe(true);
  const validation = await validated.json();
  expect(validation.warnings).toHaveLength(1);
  expect(validation.warnings[0]).toContain('elements.readOnly.props.value');
  const created = await request.post('/api/canvas/json-render', {
    data: { title: 'Form binding regression', spec },
  });
  expect(created.ok()).toBe(true);
  const body = await created.json();
  expect(body.warnings).toEqual(validation.warnings);
  try {
    await page.goto(body.url);
    await expect(page.getByLabel('Literal postcode', { exact: true })).toHaveValue('nw1 6xe');
    await page.getByLabel('Literal postcode', { exact: true }).fill('E1 6AN');
    await expect(page.getByLabel('Literal postcode', { exact: true })).toHaveValue('E1 6AN');
    await expect(page.getByLabel('Read-only postcode', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Postcode', { exact: true })).toHaveValue('nw1 6xe');
    await expect(page.getByLabel('Notes')).toHaveValue('Delivery note');
    await expect(page.getByRole('combobox')).toHaveText('London');
    await page.getByLabel('Postcode', { exact: true }).fill('SW1A 1AA');
    await expect(page.getByText('SW1A 1AA', { exact: true })).toBeVisible();
    await page.getByLabel('Notes').fill('Updated note');
    await expect(page.getByLabel('Notes')).toHaveValue('Updated note');
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Paris' }).click();
    await expect(page.getByRole('combobox')).toHaveText('Paris');
  } finally {
    await request.delete(`/api/canvas/node/${body.id}`);
  }
});

for (const mode of ['src', 'srcdoc']) {
  test(`focus mode preserves JSON drafts and lists in both directions (${mode})`, async ({ page, request }, info) => {
    const spec = {
      root: 'root',
      state: { draft: 'Initial', tasks: [{ title: 'Initial item' }] },
      elements: {
        root: { type: 'Stack', props: {}, children: ['input', 'echo', 'more', 'fewer', 'list'] },
        input: { type: 'Input', props: { label: 'Draft', value: { $bindState: '/draft' } } },
        echo: { type: 'Text', props: { text: { $state: '/draft' } } },
        more: {
          type: 'Button',
          props: { label: 'Load list', variant: 'primary' },
          on: {
            press: {
              action: 'setState',
              params: {
                statePath: '/tasks',
                value: Array.from({ length: 16 }, (_, i) => ({ title: `Loaded item ${i + 1}` })),
              },
            },
          },
        },
        fewer: {
          type: 'Button',
          props: { label: 'Replace list', variant: 'secondary' },
          on: {
            press: {
              action: 'setState',
              params: {
                statePath: '/tasks',
                value: [{ title: 'Expanded item A' }, { title: 'Expanded item B' }, { title: 'Expanded item C' }],
              },
            },
          },
        },
        list: { type: 'Stack', props: {}, repeat: { statePath: '/tasks' }, children: ['row'] },
        row: { type: 'Text', props: { text: { $item: 'title' } } },
      },
    };
    const response = await request.post('/api/canvas/json-render', {
      data: { title: 'Focus-state regression', x: 100, y: 80, width: 560, height: 340, spec },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const { id } = await response.json();
    const readNode = async () => (await request.get(`/api/canvas/node/${id}`)).json();
    try {
      // Runtime-state continuity must not depend on AX capability being enabled.
      if (mode === 'srcdoc') {
        expect(
          (
            await request.patch(`/api/canvas/node/${id}`, { data: { data: { axCapabilities: { enabled: false } } } })
          ).ok(),
        ).toBe(true);
        expect((await readNode()).data.axCapabilities.enabled).toBe(false);
      }
      await request.post('/api/canvas/viewport', { data: { x: 0, y: 0, scale: 1 } });
      await page.goto(`/workbench?iframe-mode=${mode}`);
      const node = page.locator(`.canvas-node[data-node-id="${id}"]`);
      const inline = node.frameLocator('iframe:visible');
      await expect(inline.getByLabel('Draft', { exact: true })).toHaveValue('Initial');
      // Test runtime continuity independently of Chromium's early iframe
      // pointer hit-test race (the HTML bridge regressions use the same path).
      await inline.getByRole('button', { name: 'Load list', exact: true }).press('Enter');
      await expect(inline.getByText(/^Loaded item \d+$/)).toHaveCount(16);
      await expect.poll(async () => (await readNode()).size.height).toBeGreaterThan(340);
      await inline.getByLabel('Draft', { exact: true }).fill('DRAFT-MUST-SURVIVE');
      await node.getByTitle('Expand (focus mode)').click();
      const overlay = page.locator('.expanded-overlay-panel');
      const expanded = overlay.frameLocator('iframe');
      await expect(expanded.getByLabel('Draft', { exact: true })).toHaveValue('DRAFT-MUST-SURVIVE');
      await expect(expanded.getByText('DRAFT-MUST-SURVIVE', { exact: true })).toBeVisible();
      await expect(expanded.getByText(/^Loaded item \d+$/)).toHaveCount(16);
      await page.screenshot({ path: info.outputPath('focus-runtime-expanded.png') });
      await expanded.getByRole('button', { name: 'Replace list' }).press('Enter');
      await expect(expanded.getByText(/^Expanded item [ABC]$/)).toHaveCount(3);
      await expanded.getByLabel('Draft', { exact: true }).fill('EXPANDED-MUST-SURVIVE');
      await overlay.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(inline.getByLabel('Draft', { exact: true })).toHaveValue('EXPANDED-MUST-SURVIVE');
      await expect(inline.getByText('EXPANDED-MUST-SURVIVE', { exact: true })).toBeVisible();
      await expect(inline.getByText(/^Expanded item [ABC]$/)).toHaveCount(3);
      await expect(inline.getByText(/^Loaded item \d+$/)).toHaveCount(0);
      await page.screenshot({ path: info.outputPath('focus-runtime-inline.png') });
      // Focus state is ephemeral, not a silent server write. Authored spec updates
      // still replace it; a stale runtime snapshot must not mask a new revision.
      expect((await readNode()).data.spec.state).toEqual(spec.state);
      const updatedSpec = { ...spec, state: { draft: 'Authored replacement', tasks: [{ title: 'Replacement item' }] } };
      expect((await request.patch(`/api/canvas/node/${id}`, { data: { spec: updatedSpec } })).ok()).toBe(true);
      await expect(inline.getByLabel('Draft', { exact: true })).toHaveValue('Authored replacement');
      await expect(inline.getByText('Replacement item', { exact: true })).toBeVisible();
      await node.getByTitle('Expand (focus mode)').click();
      await expect(expanded.getByLabel('Draft', { exact: true })).toHaveValue('Authored replacement');
    } finally {
      await request.delete(`/api/canvas/node/${id}`);
    }
  });
}
