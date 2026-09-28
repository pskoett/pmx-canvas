import { expect, test } from '@playwright/test';

for (const width of [1440, 600]) {
  test(`document attachment, agent draft and human review at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { board } = await (
      await request.post('/api/canvas/boards', { data: { name: `Import review ${width}` } })
    ).json();
    await request.post('/api/canvas/boards/open', { headers: { 'x-pmx-workbench': '1' }, data: { id: board.id } });
    await page.goto('/workbench');
    const source = Buffer.from('%PDF-1.4\n% byte-retention fixture, extraction is agent-supplied\n');
    await page
      .getByLabel('Attach documents')
      .setInputFiles({ name: 'quarterly.pdf', mimeType: 'application/pdf', buffer: source });
    await expect(page.getByText('Original attached', { exact: true })).toBeVisible();
    const { imports } = await (await request.get(`/api/canvas/imports?boardId=${board.id}`)).json();
    const job = imports[0];
    const download = await request.get(`/api/canvas/attachments/${job.attachmentId}/bytes`);
    expect(await download.body()).toEqual(source);
    expect(download.headers()['content-disposition']).toContain('attachment');
    expect(download.headers()['x-content-type-options']).toBe('nosniff');
    const rejected = await request.post(`/api/canvas/imports/${job.id}/request`, { data: { consent: true } });
    expect(rejected.status()).toBe(403);
    await page.getByRole('button', { name: 'Ask agent to import' }).click();
    await expect(page.getByText(/may send this file to its model provider/)).toBeVisible();
    await page.getByRole('button', { name: 'Allow processing & request' }).click();
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
        ],
        warnings: ['Chart artwork was not extracted.'],
      },
    });
    expect(submitted.ok()).toBe(true);
    await page.getByRole('button', { name: /Review Markdown/ }).click();
    const review = page.getByRole('dialog', { name: 'Review imported Markdown' });
    await expect(review).toContainText('Chart artwork was not extracted.');
    await expect(review).toContainText('47');
    await review.getByRole('button', { name: 'Add to board' }).click();
    await expect(page.getByText('Markdown added', { exact: true })).toBeVisible();
    const state = await (await request.get('/api/canvas/state')).json();
    const derived = state.nodes.find((node: { type: string }) => node.type === 'markdown');
    expect(derived.data.source.attachmentId).toBe(job.attachmentId);
    expect(derived.data.content).toContain('47');
    await page.reload();
    await expect(page.getByText('Markdown added', { exact: true })).toBeVisible();
    const search = await (await request.get('/api/canvas/search?q=Quarterly&scope=library')).json();
    expect(JSON.stringify(search)).toContain(derived.id);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export board', exact: true });
    await expect(dialog).toContainText('Original attachments are excluded');
    await expect(dialog.getByRole('checkbox', { name: /Include imported document text/ })).not.toBeChecked();
    await dialog.getByRole('checkbox', { name: /Include imported document text/ }).check();
    await expect(dialog.getByRole('checkbox', { name: /Include imported document text/ })).toBeChecked();
  });
}
