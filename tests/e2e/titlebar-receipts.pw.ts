import { expect, test, type APIRequestContext } from '@playwright/test';

const headers = { 'x-pmx-workbench': '1' };
async function post(request: APIRequestContext, path: string, data: object = {}) {
  const response = await request.post(`/api/canvas/${path}`, { data, headers });
  expect(response.ok()).toBe(true);
  return response;
}

test.beforeEach(async ({ request }) => {
  const { presences } = await (await request.get('/api/canvas/ax/presence')).json();
  for (const presence of presences) {
    if (presence.attached) {
      await post(request, 'ax/presence', { source: presence.source, agentId: presence.agentId, attached: false });
    }
  }
  await post(request, 'ax/policy', { scope: null });
  await post(request, 'clear');
  await post(request, 'context-pins', { nodeIds: [] });
  await post(request, 'viewport', { x: 0, y: 0, scale: 1 });
});

test('title click selects for context pinning; shift toggles; dragging preserves selection; groups match', async ({
  page,
  request,
}) => {
  const a = await (
    await post(request, 'node', {
      type: 'markdown',
      title: 'Alpha',
      content: 'First',
      x: 100,
      y: 100,
      width: 300,
      height: 180,
    })
  ).json();
  const b = await (
    await post(request, 'node', {
      type: 'markdown',
      title: 'Beta',
      content: 'Second',
      x: 500,
      y: 100,
      width: 300,
      height: 180,
    })
  ).json();
  await post(request, 'group', { title: 'Review group', x: 150, y: 400, width: 450, height: 200 });
  await page.goto('/workbench');
  const alpha = page.locator(`[data-node-id="${a.id}"]`);
  const beta = page.locator(`[data-node-id="${b.id}"]`);
  await alpha.locator('.node-title').click();
  await expect(alpha).toHaveClass(/selected/);
  await page.getByRole('button', { name: 'Pin as context', exact: true }).click();
  await expect(alpha).toHaveClass(/context-pinned/);
  await alpha.locator('.node-title').click();
  await beta.locator('.node-title').click({ modifiers: ['Shift'] });
  await expect(page.locator('.canvas-node.selected')).toHaveCount(2);
  await beta.locator('.node-title').click({ modifiers: ['Shift'] });
  await expect(page.locator('.canvas-node.selected')).toHaveCount(1);
  const before = await beta.boundingBox();
  const title = await beta.locator('.node-title').boundingBox();
  if (!before || !title) throw new Error('Missing node geometry');
  await page.mouse.move(title.x + 15, title.y + 8);
  await page.mouse.down();
  await page.mouse.move(title.x + 95, title.y + 78, { steps: 10 });
  await page.mouse.up();
  await expect(alpha).toHaveClass(/selected/);
  await expect(beta).not.toHaveClass(/selected/);
  await expect.poll(async () => (await beta.boundingBox())!.x - before.x).toBeGreaterThan(60);
  await beta.locator('.node-title').click();
  await expect(beta).toHaveClass(/selected/);
  await expect(alpha).not.toHaveClass(/selected/);
  const group = page.locator('.group-node');
  await group.locator('.group-name').click();
  await expect(group).toHaveClass(/selected/);
  await expect(beta).not.toHaveClass(/selected/);
  await group.locator('.group-name').click({ modifiers: ['Shift'] });
  await expect(group).not.toHaveClass(/selected/);
  await group.getByRole('button', { name: 'Collapse group', exact: true }).click();
  await page.locator('.group-chip-name').click();
  await expect(page.locator('.group-chip')).toHaveClass(/selected/);
});

test('only changed top-level endings show receipts; workers retain snapshots', async ({ page, request }) => {
  await page.goto('/workbench');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-session-active', 'false');
  const receipt = page.getByTestId('session-receipt');
  const presence = (agentId: string, attached: boolean, parentAgentId?: string) =>
    post(request, 'ax/presence', {
      source: 'api',
      agentId,
      label: agentId,
      attached,
      parentAgentId,
      cursor: { x: 200, y: 200 },
    });
  const end = (agentId: string) => presence(agentId, false);
  await presence('empty-session', true);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-session-active', 'true');
  await end('empty-session');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-session-active', 'false');
  await expect(receipt).toHaveCount(0);
  await post(request, 'node', { type: 'markdown', title: 'Baseline', content: 'Before', x: 100, y: 100 });
  await presence('no-edit-session', true);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-session-active', 'true');
  await end('no-edit-session');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-session-active', 'false');
  await expect(receipt).toHaveCount(0);
  await presence('orchestrator', true);
  await presence('worker', true, 'orchestrator');
  await expect(page.locator('.agent-cursor[data-session-id="worker"]')).toHaveCount(1);
  await post(request, 'node', { type: 'markdown', title: 'Worker result', content: 'After', x: 500, y: 100 });
  await end('worker');
  // SSE presence confirms the worker's detach was consumed.
  await expect(page.locator('.agent-cursor[data-session-id="worker"]')).toHaveCount(0);
  await expect(receipt).toHaveCount(0);
  const snapshots = await (await request.get('/api/canvas/snapshots?all=true')).json();
  expect(snapshots.some((s: { name: string }) => s.name.includes('worker'))).toBe(true);
  await end('orchestrator');
  await expect(receipt).toBeVisible();
  await receipt.getByRole('button', { name: 'View diff' }).click();
  await expect(page.getByTestId('session-receipt-diff')).toHaveText('This session: 1 added · 0 removed · 0 modified');
  await receipt.getByRole('button', { name: 'Dismiss receipt' }).click();
  await expect(receipt).toHaveCount(0);
});
