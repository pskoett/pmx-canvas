import { expect, test } from '@playwright/test';

const baseUrl = process.env.PMX_CANVAS_URL ?? 'http://127.0.0.1:4513';

test.skip(!process.env.PMX_CANVAS_URL, 'published-consumer smoke requires PMX_CANVAS_URL from the install-style workflow');

test('renders the published-consumer SDLC workspace', async ({ page, request }) => {
  await page.goto(`${baseUrl}/workbench`);

  await expect(page.locator('.canvas-node').filter({ hasText: 'Synthetic SDLC Report' })).toHaveCount(1);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Pipeline Atlas' })).toHaveCount(1);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Artifact App' })).toHaveCount(1);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Control Tower Widgets' })).toHaveCount(1);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Release Gate Intake' })).toHaveCount(1);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Service Readiness Matrix' })).toHaveCount(1);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Lead Time Trend' })).toHaveCount(1);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Defects by Stage' })).toHaveCount(1);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Operational Load' })).toHaveCount(1);

  await expect(page.locator('.context-pin-bar')).toContainText('3 nodes in context');
  await expect(page.getByText('npm pack')).toBeVisible();
  await expect(page.getByText('canvas.buildWebArtifact')).toBeVisible();
  await expect(page.getByText('playwright')).toBeVisible();

  const artifactFrame = page.frameLocator('.canvas-node:has-text("SDLC Control Room Artifact") iframe.mcp-app-frame');
  await expect(artifactFrame.getByText('Delivery Control Room')).toBeVisible();

  const dashboardFrame = page.frameLocator('.canvas-node:has-text("Control Tower Widgets") iframe.mcp-app-frame');
  await expect(dashboardFrame.getByText('Control Tower Widgets')).toBeVisible();

  const intakeFrame = page.frameLocator('.canvas-node:has-text("Release Gate Intake") iframe.mcp-app-frame');
  await expect(intakeFrame.getByText('Release Gate Intake')).toBeVisible();

  const graphFrame = page.frameLocator('.canvas-node:has-text("Lead Time Trend") iframe.mcp-app-frame');
  await expect(graphFrame.getByText('Lead Time Trend')).toBeVisible();

  await expect.poll(async () => {
    const response = await request.get(`${baseUrl}/api/canvas/state`);
    const state = await response.json() as { nodes: Array<{ type: string }> };
    const typeSet = new Set(state.nodes.map((node) => node.type));
    return [
      state.nodes.length >= 18,
        ['markdown', 'image', 'file', 'status', 'context', 'ledger', 'trace', 'mcp-app', 'webpage', 'json-render', 'graph', 'group']
          .every((type) => typeSet.has(type)),
    ].every(Boolean);
  }).toBe(true);

  const snapshotResponse = await request.get(`${baseUrl}/api/canvas/snapshots`);
  const snapshots = await snapshotResponse.json() as Array<{ name: string }>;
  expect(snapshots.some((snapshot) => snapshot.name === 'published-consumer-baseline')).toBe(true);
});
