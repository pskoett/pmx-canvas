import { expect, test } from '@playwright/test';

async function clearSnapshots(request: { get: Function; delete: Function }): Promise<void> {
  const response = await request.get('/api/canvas/snapshots');
  const snapshots = await response.json() as Array<{ id: string }>;
  for (const snapshot of snapshots) {
    await request.delete(`/api/canvas/snapshots/${snapshot.id}`);
  }
}

async function clearCanvas(request: { post: Function }): Promise<void> {
  await request.post('/api/canvas/clear');
  await request.post('/api/canvas/context-pins', {
    data: { nodeIds: [] },
  });
}

async function currentCanvasState(request: { get: Function }): Promise<{
  nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>;
  edges: Array<{ id: string; from: string; to: string; type: string }>;
}> {
  const response = await request.get('/api/canvas/state');
  return await response.json() as {
    nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>;
    edges: Array<{ id: string; from: string; to: string; type: string }>;
  };
}

test.beforeEach(async ({ request }) => {
  await clearCanvas(request);
  await clearSnapshots(request);
});

test('creates a markdown note from the canvas background', async ({ page, request }) => {
  await page.goto('/workbench');

  await expect(page.locator('.welcome-card')).toBeVisible();

  await page.mouse.dblclick(1180, 360);

  const note = page.locator('.canvas-node').filter({ hasText: 'New note' });
  await expect(note).toHaveCount(1);
  await expect(page.locator('.welcome-card')).toBeHidden();

  await expect.poll(async () => {
    const state = await currentCanvasState(request);
    return state.nodes.filter(
      (node) => node.type === 'markdown' && node.data.title === 'New note',
    ).length;
  }).toBe(1);
});

test('renders server-created nodes and syncs context pins from the UI', async ({ page, request }) => {
  const createResponse = await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Seeded note',
      content: 'Seeded content',
      x: 640,
      y: 260,
    },
  });
  const created = await createResponse.json() as { id: string };

  await page.goto('/workbench');

  const seededNode = page.locator('.canvas-node').filter({ hasText: 'Seeded note' });
  await expect(seededNode).toHaveCount(1);
  await seededNode.locator('.ctx-pin-btn').click();

  await expect(page.locator('.context-pin-bar')).toContainText('1 node in context');
  await expect.poll(async () => {
    const response = await request.get('/api/canvas/pinned-context');
    const pinned = await response.json() as { count: number; nodeIds: string[] };
    return `${pinned.count}:${pinned.nodeIds.join(',')}`;
  }).toBe(`1:${created.id}`);
});

test('markdown edit opens focused inline editing before raw source mode', async ({ page, request }) => {
  await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Editable note',
      content: '# Title\n\nParagraph text',
      x: 640,
      y: 260,
    },
  });

  await page.goto('/workbench');

  const note = page.locator('.canvas-node').filter({ hasText: 'Editable note' });
  await expect(note).toHaveCount(1);

  await note.getByRole('button', { name: 'Edit' }).click();

  const overlay = page.locator('.expanded-overlay-panel');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('.md-reader-content')).toBeVisible();
  await expect(page.locator('.md-editor-split')).toHaveCount(0);
  await expect(overlay.locator('.md-edit-fab')).toContainText('Source');

  await overlay.getByText('Paragraph text').click();
  await expect(overlay.locator('.md-block-edit')).toBeVisible();
  await expect(page.locator('.md-editor-split')).toHaveCount(0);
});

test('saves snapshots from the toolbar', async ({ page, request }) => {
  await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Snapshot target',
      content: 'Ready for snapshot',
      x: 560,
      y: 240,
    },
  });

  await page.goto('/workbench');
  await expect(page.locator('.canvas-node').filter({ hasText: 'Snapshot target' })).toHaveCount(1);

  await page.getByRole('button', { name: 'Snapshots' }).click();
  await expect(page.locator('.snapshot-panel')).toBeVisible();
  await page.locator('.snapshot-name-input').fill('Toolbar snapshot');
  await page.locator('.snapshot-save-btn').click();

  await expect(page.locator('.snapshot-item-name')).toContainText('Toolbar snapshot');
  await expect.poll(async () => {
    const response = await request.get('/api/canvas/snapshots');
    const snapshots = await response.json() as Array<{ name: string }>;
    return snapshots.map((snapshot) => snapshot.name).join(',');
  }).toContain('Toolbar snapshot');
});
