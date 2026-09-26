import { expect, test } from '@playwright/test';

test('form warnings reach HTTP callers and seeded bindings render editable values', async ({ page, request }) => {
  const spec = {
    root: 'root',
    state: { postcode: 'nw1 6xe', notes: 'Delivery note', city: 'London' },
    elements: {
      root: { type: 'Stack', props: {}, children: ['literal', 'input', 'textarea', 'select', 'echo'] },
      literal: { type: 'Input', props: { label: 'Unbound postcode', value: 'nw1 6xe' } },
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
  expect(validation.warnings[0]).toContain('elements.literal.props.value');
  const created = await request.post('/api/canvas/json-render', {
    data: { title: 'Form binding regression', spec },
  });
  expect(created.ok()).toBe(true);
  const body = await created.json();
  expect(body.warnings).toEqual(validation.warnings);
  try {
    await page.goto(body.url);
    await expect(page.getByLabel('Unbound postcode', { exact: true })).toHaveValue('');
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
