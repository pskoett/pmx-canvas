import { expect, test, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

function toolbarTooltip(button: Locator): Locator {
  return button.locator('xpath=following-sibling::*[contains(@class,"toolbar-tooltip")]');
}

async function tooltipOpacity(button: Locator): Promise<number> {
  const tooltip = toolbarTooltip(button);
  return await tooltip.evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity));
}

async function clearSnapshots(request: { get: Function; delete: Function }): Promise<void> {
  const response = await request.get('/api/canvas/snapshots?all=true');
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
  nodes: Array<{
    id: string;
    type: string;
    data: Record<string, unknown>;
    position: { x: number; y: number };
    size: { width: number; height: number };
  }>;
  edges: Array<{ id: string; from: string; to: string; type: string }>;
}> {
  const response = await request.get('/api/canvas/state');
  return await response.json() as {
    nodes: Array<{
      id: string;
      type: string;
      data: Record<string, unknown>;
      position: { x: number; y: number };
      size: { width: number; height: number };
    }>;
    edges: Array<{ id: string; from: string; to: string; type: string }>;
  };
}

async function dragNodeTitlebar(page: Page, node: Locator, deltaX: number, deltaY: number): Promise<void> {
  const titlebar = node.locator('.node-titlebar');
  const box = await titlebar.boundingBox();
  if (!box) throw new Error('Node titlebar is not visible for dragging.');
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 });
  await page.mouse.up();
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

test('canvas background context menu exposes user-creatable nodes', async ({ page, request }) => {
  await page.goto('/workbench');

  const viewport = page.locator('.canvas-viewport');
  await viewport.click({
    button: 'right',
    position: { x: 72, y: 120 },
  });

  const menu = page.locator('.context-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.context-menu-item').filter({ hasText: 'New note' })).toBeVisible();
  await expect(menu.locator('.context-menu-item').filter({ hasText: 'Open webpage...' })).toBeVisible();
  await expect(menu.locator('.context-menu-item').filter({ hasText: 'Open file...' })).toBeVisible();
  await expect(menu.locator('.context-menu-item').filter({ hasText: 'Open image...' })).toBeVisible();
  await expect(menu.locator('.context-menu-item').filter({ hasText: 'New group' })).toBeVisible();
  await expect(menu).not.toContainText('status');
  await expect(menu).not.toContainText('trace');
  await expect(menu).not.toContainText('ledger');
  await expect(menu).not.toContainText('context');
  await expect(menu).not.toContainText('response');

  await menu.locator('.context-menu-item').filter({ hasText: 'New note' }).click();

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

test('dragging a group ignores its own children as snap targets', async ({ page, request }) => {
  const childResponse = await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Snap child',
      content: 'Grouped child',
      x: 320,
      y: 220,
      width: 320,
      height: 180,
    },
  });
  const child = await childResponse.json() as { id: string };

  await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Reference',
      content: 'Outside group',
      x: 1400,
      y: 220,
      width: 320,
      height: 180,
    },
  });

  const groupResponse = await request.post('/api/canvas/group', {
    data: {
      title: 'Snap Group',
      childIds: [child.id],
      x: 280,
      y: 148,
      width: 840,
      height: 312,
    },
  });
  const group = await groupResponse.json() as { id: string };

  await page.goto('/workbench');

  const groupNode = page.locator('.canvas-node.group-node').filter({ hasText: 'Snap Group' });
  const childNode = page.locator('.canvas-node:not(.group-node)').filter({ hasText: 'Snap child' });

  await dragNodeTitlebar(page, groupNode, 36, 0);

  await expect.poll(async () => {
    const state = await currentCanvasState(request);
    const nextGroup = state.nodes.find((node) => node.id === group.id);
    const nextChild = state.nodes.find((node) => node.id === child.id);
    return JSON.stringify({
      groupX: nextGroup?.position.x,
      childX: nextChild?.position.x,
    });
  }).toBe(JSON.stringify({
    groupX: 316,
    childX: 356,
  }));
});

test('dragging a grouped child ignores its own parent frame as a snap target', async ({ page, request }) => {
  const childResponse = await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Snap child',
      content: 'Grouped child',
      x: 320,
      y: 220,
      width: 320,
      height: 180,
    },
  });
  const child = await childResponse.json() as { id: string };

  await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Reference',
      content: 'Outside group',
      x: 1400,
      y: 220,
      width: 320,
      height: 180,
    },
  });

  await request.post('/api/canvas/group', {
    data: {
      title: 'Snap Group',
      childIds: [child.id],
      x: 280,
      y: 148,
      width: 840,
      height: 312,
    },
  });

  await page.goto('/workbench');
  const childNode = page.locator('.canvas-node:not(.group-node)').filter({ hasText: 'Snap child' });

  await dragNodeTitlebar(page, childNode, -36, 0);

  await expect.poll(async () => {
    const state = await currentCanvasState(request);
    const nextChild = state.nodes.find((node) => node.id === child.id);
    return nextChild?.position.x;
  }).toBe(284);
});

test('keeps the browser, pinned context, and agent-driven canvas mutations in sync', async ({ page, request }) => {
  const createResponse = await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Roundtrip seed',
      content: 'Human-curated context',
      x: 640,
      y: 260,
    },
  });
  const created = await createResponse.json() as { id: string };

  await page.goto('/workbench');

  const seededNode = page.locator('.canvas-node').filter({ hasText: 'Roundtrip seed' });
  await expect(seededNode).toHaveCount(1);

  await seededNode.locator('.ctx-pin-btn').click();
  await expect(page.locator('.context-pin-bar')).toContainText('1 node in context');

  await expect.poll(async () => {
    const response = await request.get('/api/canvas/pinned-context');
    const pinned = await response.json() as { count: number; nodeIds: string[] };
    return `${pinned.count}:${pinned.nodeIds.join(',')}`;
  }).toBe(`1:${created.id}`);

  const agentCreateResponse = await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Agent reply node',
      content: `Derived from ${created.id}`,
      x: 980,
      y: 260,
    },
  });
  const agentCreated = await agentCreateResponse.json() as { id: string };

  const agentNode = page.locator('.canvas-node').filter({ hasText: 'Agent reply node' });
  await expect(agentNode).toHaveCount(1);

  await expect.poll(async () => {
    const state = await currentCanvasState(request);
    return state.nodes.some(
      (node) => node.id === agentCreated.id && node.data.title === 'Agent reply node',
    );
  }).toBe(true);

  await expect.poll(async () => {
    const response = await request.get('/api/canvas/pinned-context');
    const pinned = await response.json() as { count: number; nodeIds: string[] };
    return `${pinned.count}:${pinned.nodeIds.join(',')}`;
  }).toBe(`1:${created.id}`);
});

test('semantic attention layer shows focus and interpretation history', async ({ page, request }) => {
  await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Bug report',
      content: 'Anchor node',
      x: 460,
      y: 220,
    },
  });
  const authResponse = await request.post('/api/canvas/node', {
    data: {
      type: 'file',
      title: 'auth.ts',
      content: 'export const auth = true;',
      x: 1240,
      y: 220,
    },
  });
  const authNode = await authResponse.json() as { id: string };

  await page.goto('/workbench');

  const bugReport = page.locator('.canvas-node').filter({ hasText: 'Bug report' });
  const authTs = page.locator('.canvas-node').filter({ hasText: 'auth.ts' });
  await expect(bugReport).toHaveCount(1);
  await expect(authTs).toHaveCount(1);

  await bugReport.locator('.ctx-pin-btn').click();

  await expect(page.locator('.attention-toast')).toContainText('Context updated');
  await page.getByRole('button', { name: /recent updates/i }).click();
  await expect(page.locator('.attention-history')).toContainText('Context updated');
  await expect(page.locator('.context-pin-bar')).toHaveCount(0);
  await expect(bugReport).toHaveClass(/attention-focus-primary/);

  await request.patch(`/api/canvas/node/${authNode.id}`, {
    data: {
      position: { x: 700, y: 240 },
    },
  });

  await expect(authTs).toHaveClass(/attention-focus-secondary/);
  await expect(page.locator('.attention-history')).toContainText('Neighborhood changed');
});

test('context dock renders the active pinned nodes instead of stale context cards', async ({ page, request }) => {
  const staleContextResponse = await request.post('/api/canvas/node', {
    data: {
      type: 'context',
      title: 'Stale Dock Cache',
      content: 'This stale card should not appear for active pins.',
      x: 1130,
      y: 80,
    },
  });
  const staleContext = await staleContextResponse.json() as { id: string };
  await request.patch(`/api/canvas/node/${staleContext.id}`, {
    data: { dockPosition: 'right', collapsed: false },
  });

  await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Pinned Alpha',
      content: 'Alpha context body',
      x: 160,
      y: 220,
      width: 360,
      height: 220,
    },
  });
  await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Pinned Beta',
      content: 'Beta context body',
      x: 560,
      y: 220,
      width: 360,
      height: 220,
    },
  });

  await page.goto('/workbench');

  const alpha = page.locator('.canvas-node').filter({ hasText: 'Pinned Alpha' });
  const beta = page.locator('.canvas-node').filter({ hasText: 'Pinned Beta' });
  await alpha.locator('.ctx-pin-btn').click();
  await beta.locator('.ctx-pin-btn').click();

  const dock = page.locator('.context-dock-panel');
  await expect(dock).toBeVisible();
  await expect(dock).toContainText('Pinned Alpha');
  await expect(dock).toContainText('Pinned Beta');
  await expect(dock).not.toContainText('Stale Dock Cache');
  await expect(page.locator('.context-pin-bar')).toHaveCount(0);
});

test('renders webpage node preview content from cached server fetch data', async ({ page, request }) => {
  await request.post('/api/canvas/node', {
    data: {
      type: 'webpage',
      title: 'Previewed page',
      content: 'https://example.com/preview',
      data: {
        description: 'Visible webpage preview',
        pageTitle: 'Previewed page',
        excerpt: 'This cached webpage preview text is visible on the canvas.',
        content: 'This cached webpage preview text is visible on the canvas.',
        status: 'ready',
      },
      x: 640,
      y: 260,
      width: 520,
      height: 420,
    },
  });

  await page.goto('/workbench');

  const webpageNode = page.locator('.canvas-node').filter({ hasText: 'Previewed page' });
  await expect(webpageNode).toHaveCount(1);
  await expect(webpageNode).toContainText('Visible webpage preview');
  await expect(webpageNode).toContainText('This cached webpage preview text is visible on the canvas.');
  await expect(webpageNode.getByRole('button', { name: 'Refresh' })).toBeVisible();
});

test('renders html nodes from server state in the workbench', async ({ page, request }) => {
  await request.post('/api/canvas/node', {
    data: {
      type: 'html',
      title: 'HTML render target',
      html: '<main><h1>HTML render sentinel</h1><p>Sandboxed iframe content</p></main>',
      x: 640,
      y: 260,
      width: 520,
      height: 360,
    },
  });

  await page.goto('/workbench');

  const htmlNode = page.locator('.canvas-node').filter({ hasText: 'HTML render target' });
  await expect(htmlNode).toHaveCount(1);
  await expect(htmlNode.locator('.node-type-badge')).toHaveText('HTML');
  await expect(htmlNode.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(htmlNode.locator('iframe')).not.toHaveAttribute('sandbox', /allow-same-origin/);
  await expect(htmlNode.frameLocator('iframe').getByText('HTML render sentinel')).toBeVisible();

  await htmlNode.getByTitle('Expand (focus mode)').click();
  const overlay = page.locator('.expanded-overlay-panel');
  await expect(overlay).toBeVisible();
  await expect(overlay.getByRole('button', { name: 'Present' })).toHaveCount(0);
  await page.getByTitle('Close (Esc)').click();
});

test('html presentation nodes live-update theme inside sandboxed iframes', async ({ page, request }) => {
  await request.post('/api/canvas/node', {
    data: {
      type: 'html',
      title: 'Theme-aware presentation',
      html: '<main><h1>Theme sentinel</h1><p id="theme-bg">Theme</p><script>document.getElementById("theme-bg").textContent = getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim(); window.addEventListener("message", () => setTimeout(() => { document.getElementById("theme-bg").textContent = getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim(); }, 0));</script></main>',
      presentation: true,
      x: 640,
      y: 260,
      width: 520,
      height: 360,
    },
  });

  await page.goto('/workbench');
  const htmlNode = page.locator('.canvas-node').filter({ hasText: 'Theme-aware presentation' });
  await expect(htmlNode).toHaveCount(1);
  await expect(htmlNode.frameLocator('iframe').getByText('Theme sentinel')).toBeVisible();

  const before = await htmlNode.frameLocator('iframe').locator('#theme-bg').textContent();
  await page.getByRole('button', { name: /Switch to light theme/ }).click();

  await expect.poll(async () => htmlNode.frameLocator('iframe').locator('#theme-bg').textContent()).not.toBe(before);
});

test('presentation mode focuses iframe keyboard navigation and hides review hints', async ({ page, request }) => {
  await request.post('/api/canvas/node', {
    data: {
      type: 'html',
      primitive: 'presentation',
      title: 'Keyboard Deck',
      data: {
        slides: [
          { title: 'First slide', body: 'Start here.' },
          { title: 'Second slide', body: 'Keyboard navigation lands here.' },
        ],
      },
      x: 640,
      y: 260,
    },
  });

  await page.goto('/workbench');
  const deckNode = page.locator('.canvas-node').filter({ hasText: 'Keyboard Deck' });
  await expect(deckNode).toHaveCount(1);
  await deckNode.getByTitle('Expand (focus mode)').click();

  const overlay = page.locator('.expanded-overlay-panel');
  await expect(overlay.frameLocator('iframe').getByText('Arrow keys, Space, Page Up/Down')).toBeVisible();
  await expect(overlay.frameLocator('iframe').getByRole('button', { name: 'Copy JSON' })).toHaveCount(0);
  await expect(overlay.frameLocator('iframe').getByRole('button', { name: 'Copy prompt' })).toHaveCount(0);

  await overlay.getByRole('button', { name: 'Present' }).click();
  const dialog = page.getByRole('dialog', { name: 'Present Keyboard Deck' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.html-presentation-toolbar')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Exit presentation' })).toHaveCSS('opacity', '0');
  const fillsViewport = await dialog.locator('.html-presentation-stage').evaluate((stage) => {
    const rect = stage.getBoundingClientRect();
    return rect.left === 0 && rect.top === 0 && rect.width === window.innerWidth && rect.height === window.innerHeight;
  });
  expect(fillsViewport).toBe(true);
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Exit presentation' })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Exit presentation' })).toHaveCSS('opacity', '1');
  await expect(dialog.frameLocator('iframe').getByText('Arrow keys, Space, Page Up/Down')).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.frameLocator('iframe').getByRole('heading', { name: 'Second slide' })).toBeVisible();
});

test('pasting a URL onto the canvas creates a webpage node', async ({ page, request }) => {
  await page.goto('/workbench');
  await page.evaluate(() => {
    const viewport = document.querySelector('.canvas-viewport');
    if (!(viewport instanceof HTMLElement)) throw new Error('Canvas viewport not found');
    viewport.focus();
    const event = new ClipboardEvent('paste', {
      clipboardData: new DataTransfer(),
      bubbles: true,
      cancelable: true,
    });
    event.clipboardData?.setData('text/plain', 'https://example.com/pasted-url');
    document.dispatchEvent(event);
  });

  await expect.poll(async () => {
    const state = await currentCanvasState(request);
    return state.nodes.some((node) => node.type === 'webpage' && node.data.url === 'https://example.com/pasted-url');
  }).toBe(true);
});

test('dropping a URL onto the canvas creates a webpage node', async ({ page, request }) => {
  await page.goto('/workbench');

  await page.evaluate(() => {
    const viewport = document.querySelector('.canvas-viewport');
    if (!(viewport instanceof HTMLElement)) throw new Error('Canvas viewport not found');
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', 'https://example.com/dropped-url');
    const rect = viewport.getBoundingClientRect();
    viewport.dispatchEvent(new DragEvent('dragenter', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      dataTransfer,
    }));
    viewport.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      dataTransfer,
    }));
  });

  await expect.poll(async () => {
    const state = await currentCanvasState(request);
    return state.nodes.some((node) => node.type === 'webpage' && node.data.url === 'https://example.com/dropped-url');
  }).toBe(true);
});

test('hosts a standard MCP App node and proxies app-only tool calls', async ({ page, request }) => {
  const fixturePath = fileURLToPath(new URL('../fixtures/mcp-app-fixture.ts', import.meta.url));

  await page.goto('/workbench');

  const openResponse = await request.post('/api/canvas/mcp-app/open', {
    data: {
      toolName: 'show_counter',
      toolArguments: { initial: 2 },
      transport: {
        type: 'stdio',
        command: 'bun',
        args: ['run', fixturePath],
        cwd: process.cwd(),
      },
    },
  });
  expect(openResponse.ok()).toBe(true);

  const appNode = page.locator('.canvas-node').filter({ hasText: 'Counter App' });
  await expect(appNode).toHaveCount(1);

  // Ext-app nodes are "expand to interact": in inline mode the iframe is
  // covered by an `ext-app-preview-catcher` overlay so a stray click on the
  // canvas doesn't trigger tool calls. The test opens the fullscreen view
  // before proxying calls, matching the intended human interaction path.
  await appNode.locator('.ext-app-preview-catcher').click();

  // Once expanded, the iframe is re-parented into the ExpandedNodeOverlay
  // (`.expanded-overlay-panel`), so the test follows it there for the
  // interactive assertions.
  const expandedPanel = page.locator('.expanded-overlay-panel');
  const frame = expandedPanel.frameLocator('iframe');
  await expect(frame.getByText('Fixture Counter')).toBeVisible();
  await expect(frame.locator('#count')).toHaveText('2');
  await expect.poll(async () => frame.locator('body').evaluate((body) => body.scrollHeight - body.clientHeight)).toBe(0);

  // The widget's auto-resize notifications can make the iframe's reported
  // bounds waver by a pixel across measurements while it settles, which the
  // default click-stability check reads as motion. The button's *logical*
  // position is fine; `force: true` bypasses the stability wait without
  // changing click semantics.
  await frame.getByRole('button', { name: 'Increment' }).click({ force: true });
  await expect(frame.locator('#count')).toHaveText('3');

  await expect.poll(async () => {
    const state = await currentCanvasState(request);
    const hosted = state.nodes.find((node) => node.type === 'mcp-app' && node.data.title === 'Counter App');
    const appModelContext = hosted?.data.appModelContext as
      | { structuredContent?: { count?: number } }
      | undefined;
    return appModelContext?.structuredContent?.count ?? null;
  }, {
    timeout: 15000,
  }).toBe(3);

  // Collapse back to inline before the reload so the post-reload assertion
  // exercises the inline iframe (count persisted via appModelContext).
  await page.keyboard.press('Escape');

  await page.reload();
  const reloadedNode = page.locator('.canvas-node').filter({ hasText: 'Counter App' });
  await expect(reloadedNode).toHaveCount(1);
  const reloadedFrame = reloadedNode.frameLocator('iframe');
  await expect(reloadedFrame.locator('#count')).toHaveText('3');
});

test('MCP App node resize corner stays above iframe preview overlays', async ({ page, request }) => {
  const fixturePath = fileURLToPath(new URL('../fixtures/mcp-app-fixture.ts', import.meta.url));

  await page.goto('/workbench');

  const openResponse = await request.post('/api/canvas/mcp-app/open', {
    data: {
      toolName: 'show_counter',
      toolArguments: { initial: 1 },
      title: 'Resize Handle App',
      transport: {
        type: 'stdio',
        command: 'bun',
        args: ['run', fixturePath],
        cwd: process.cwd(),
      },
    },
  });
  expect(openResponse.ok()).toBe(true);

  const appNode = page.locator('.canvas-node').filter({ hasText: 'Resize Handle App' });
  await expect(appNode).toHaveCount(1);
  const handle = appNode.locator('.node-resize-handle');

  const hitTarget = await handle.evaluate((element) => {
    const handleRect = element.getBoundingClientRect();
    const nodeRect = element.closest('.canvas-node')?.getBoundingClientRect();
    if (!nodeRect) throw new Error('Resize handle is not inside a canvas node.');
    const hit = document.elementFromPoint(nodeRect.right - 4, nodeRect.bottom - 4);
    return {
      width: handleRect.width,
      height: handleRect.height,
      cursor: getComputedStyle(element).cursor,
      hitIsHandle: hit === element || element.contains(hit),
    };
  });
  expect(hitTarget).toEqual({
    width: 32,
    height: 32,
    cursor: 'nwse-resize',
    hitIsHandle: true,
  });

  const initialState = await currentCanvasState(request);
  const initialNode = initialState.nodes.find((node) => node.type === 'mcp-app' && node.data.title === 'Resize Handle App');
  if (!initialNode) throw new Error('Resize Handle App node missing from canvas state.');

  const box = await appNode.boundingBox();
  if (!box) throw new Error('Resize Handle App node is not visible.');
  await page.mouse.move(box.x + box.width - 8, box.y + box.height - 8);
  await page.mouse.down();
  await expect.poll(async () => page.locator('html').evaluate((html) => html.classList.contains('is-node-resizing'))).toBe(true);
  await page.mouse.move(box.x + box.width + 72, box.y + box.height + 44, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => page.locator('html').evaluate((html) => html.classList.contains('is-node-resizing'))).toBe(false);

  await expect.poll(async () => {
    const state = await currentCanvasState(request);
    const resized = state.nodes.find((node) => node.type === 'mcp-app' && node.data.title === 'Resize Handle App');
    if (!resized) return false;
    return resized.size.width > initialNode.size.width && resized.size.height > initialNode.size.height;
  }).toBe(true);
});

test('MCP App fullscreen edits persist after closing and reopening the app', async ({ page, request }) => {
  const fixturePath = fileURLToPath(new URL('../fixtures/mcp-app-fixture.ts', import.meta.url));

  await page.goto('/workbench');

  const openResponse = await request.post('/api/canvas/mcp-app/open', {
    data: {
      toolName: 'show_counter',
      toolArguments: { initial: 2, editor: true },
      title: 'Persistent Editor App',
      transport: {
        type: 'stdio',
        command: 'bun',
        args: ['run', fixturePath],
        cwd: process.cwd(),
      },
    },
  });
  expect(openResponse.ok()).toBe(true);

  const appNode = page.locator('.canvas-node').filter({ hasText: 'Persistent Editor App' });
  await expect(appNode).toHaveCount(1);

  const panel = page.locator('.expanded-overlay-panel');
  // Opening the fullscreen overlay races the ext-app bridge handshake: the
  // iframe's content can begin parsing before the parent registers its
  // postMessage listener, which loses the iframe's `ui/initialize` request
  // and leaves `app.connect()` hanging. The fixture then receives the
  // fallback `tool-input` notification with `hostContext === null` and
  // renders the counter view permanently. Each remount is independent, so
  // close-and-reopen retries kick a fresh iframe through the handshake. The
  // helper polls the editor view for up to ~15s with that retry loop.
  const openFullscreenEditor = async () => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) {
        await panel.getByTitle('Close (Esc)').click({ timeout: 2_000 }).catch(() => {});
      }
      await appNode.locator('.ext-app-preview-catcher').click();
      try {
        await expect(panel.frameLocator('iframe').getByText('Fixture Editor')).toBeVisible({
          timeout: 5_000,
        });
        return;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  };

  await openFullscreenEditor();
  const frame = panel.frameLocator('iframe');
  await expect(frame.getByText('No saved edit')).toBeVisible();
  await frame.getByRole('button', { name: 'Add Manual Edit' }).click();
  await expect(frame.getByText('Saved manual edit')).toBeVisible();

  await expect.poll(async () => {
    const state = await currentCanvasState(request);
    const hosted = state.nodes.find((node) => node.type === 'mcp-app' && node.data.title === 'Persistent Editor App');
    const appModelContext = hosted?.data.appModelContext as
      | { content?: Array<{ text?: string }> }
      | undefined;
    return appModelContext?.content?.[0]?.text ?? null;
  }, {
    timeout: 15000,
  }).toBe('Saved manual edit');

  await panel.getByTitle('Close (Esc)').click();
  // The same handshake race can hit the reopened iframe, so use the retry
  // helper here too.
  await openFullscreenEditor();
  const reopenedFrame = panel.frameLocator('iframe');
  await expect(reopenedFrame.getByText('Saved manual edit')).toBeVisible();
});

test('markdown edit opens inline WYSIWYG mode, not raw source mode', async ({ page, request }) => {
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

  const editor = overlay.locator('.md-reader-content');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveJSProperty('isContentEditable', true);
  await expect(page.locator('.md-editor-split')).toHaveCount(0);
  await expect(overlay.locator('.md-edit-fab')).toContainText('Source');
});

test('inline markdown save updates authoritative canvas node content', async ({ page, request }) => {
  const createResponse = await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Inline editable note',
      content: 'Original paragraph',
      x: 640,
      y: 260,
    },
  });
  const created = await createResponse.json() as { id: string };

  await page.goto('/workbench');

  const note = page.locator('.canvas-node').filter({ hasText: 'Inline editable note' });
  await expect(note).toHaveCount(1);
  await note.getByRole('button', { name: 'Edit' }).click();

  const overlay = page.locator('.expanded-overlay-panel');
  await expect(overlay).toBeVisible();

  const editor = overlay.locator('.md-reader-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Updated paragraph');
  await expect(editor).toContainText('Updated paragraph');
  await page.keyboard.press('Tab');

  await expect.poll(async () => {
    const response = await request.get(`/api/canvas/node/${created.id}`);
    const node = await response.json() as { data: Record<string, unknown> };
    return node.data.content;
  }, {
    timeout: 15000,
  }).toBe('Updated paragraph');
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

test('restores snapshots from the toolbar only after confirmation', async ({ page, request }) => {
  const createResponse = await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Restore target',
      content: 'Original snapshot body',
      x: 560,
      y: 240,
    },
  });
  const created = await createResponse.json() as { id: string };

  const saveResponse = await request.post('/api/canvas/snapshots', {
    data: { name: 'Toolbar restore snapshot' },
  });
  expect(saveResponse.ok()).toBe(true);

  await request.patch(`/api/canvas/node/${created.id}`, {
    data: { title: 'Mutated title' },
  });

  await page.goto('/workbench');

  await page.getByRole('button', { name: 'Snapshots' }).click();
  await expect(page.locator('.snapshot-panel')).toBeVisible();
  await expect(page.locator('.snapshot-restore-note')).toContainText('Restoring replaces the current canvas');

  const snapshotItem = page.locator('.snapshot-item').filter({ hasText: 'Toolbar restore snapshot' });
  await snapshotItem.getByRole('button', { name: 'Restore' }).click();
  await expect(snapshotItem.getByRole('button', { name: 'Confirm' })).toBeVisible();

  const preConfirm = await request.get(`/api/canvas/node/${created.id}`);
  const preConfirmNode = await preConfirm.json() as { data: Record<string, unknown> };
  expect(preConfirmNode.data.title).toBe('Mutated title');

  await snapshotItem.getByRole('button', { name: 'Confirm' }).click();

  await expect.poll(async () => {
    const response = await request.get(`/api/canvas/node/${created.id}`);
    const node = await response.json() as { data: Record<string, unknown> };
    return node.data.title;
  }).toBe('Restore target');
});

test('toolbar tooltips dismiss after pointer-triggered actions', async ({ page }) => {
  await page.goto('/workbench');

  const buttons = [
    page.getByRole('button', { name: 'Arrange layout' }),
    page.getByRole('button', { name: /minimap/i }),
  ];

  for (const button of buttons) {
    await button.hover();
    await expect.poll(async () => tooltipOpacity(button)).toBeGreaterThan(0.9);

    await button.click();
    await page.mouse.move(80, 860);

    await expect.poll(async () => tooltipOpacity(button)).toBeLessThan(0.1);
  }
});

test('dark bar-chart viewer keeps tooltip without the bright hover cursor overlay', async ({ page, request }) => {
  const createResponse = await request.post('/api/canvas/graph', {
    data: {
      title: 'Hover cursor check',
      graphType: 'bar',
      data: [
        { label: 'Documentation', value: 50 },
        { label: 'Testing', value: 33 },
        { label: 'Release', value: 25 },
      ],
      xKey: 'label',
      yKey: 'value',
      color: '#3ec668',
    },
  });
  const created = await createResponse.json() as { url: string };

  await page.goto(`${created.url}&theme=dark`);

  const firstBar = page.locator('.recharts-bar-rectangle').first();
  await expect(firstBar).toBeVisible();
  await firstBar.hover();

  await expect(page.locator('.recharts-tooltip-wrapper')).toContainText('Documentation');
  await expect(page.locator('.recharts-tooltip-cursor')).toHaveCount(0);
});

test('iframe-backed graph and json-render nodes avoid the sandbox escape warning', async ({ page, request }) => {
  const warnings: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'warning' || msg.type() === 'error') warnings.push(msg.text());
  });
  page.on('pageerror', (error) => warnings.push(error.message));

  await request.post('/api/canvas/graph', {
    data: {
      title: 'Latency trend',
      graphType: 'line',
      data: [
        { week: 'W15', latency: 220 },
        { week: 'W16', latency: 205 },
        { week: 'W17', latency: 198 },
      ],
      xKey: 'week',
      yKey: 'latency',
      color: '#e9c46a',
      x: 420,
      y: 220,
      width: 420,
      height: 320,
    },
  });

  await request.post('/api/canvas/json-render', {
    data: {
      title: 'Structured summary',
      spec: {
        root: 'card',
        elements: {
          card: {
            type: 'Card',
            props: { title: 'Release Summary', description: 'Structured canvas surface' },
            children: ['body'],
          },
          body: {
            type: 'Text',
            props: { text: 'All checks green except the integration suite threshold.' },
            children: [],
          },
        },
      },
      x: 900,
      y: 220,
      width: 420,
      height: 320,
    },
  });

  await page.goto('/workbench');

  const graphNode = page.locator('.canvas-node').filter({ hasText: 'Latency trend' });
  const jsonNode = page.locator('.canvas-node').filter({ hasText: 'Structured summary' });
  await expect(graphNode).toHaveCount(1);
  await expect(jsonNode).toHaveCount(1);

  await expect(graphNode.locator('iframe')).toHaveAttribute('sandbox', /allow-scripts/);
  await expect(graphNode.locator('iframe')).not.toHaveAttribute('sandbox', /allow-same-origin/);
  await expect(jsonNode.locator('iframe')).toHaveAttribute('sandbox', /allow-scripts/);
  await expect(jsonNode.locator('iframe')).not.toHaveAttribute('sandbox', /allow-same-origin/);

  await expect(graphNode.frameLocator('iframe').locator('.recharts-responsive-container')).toBeVisible();
  await expect(jsonNode.frameLocator('iframe').getByText('Release Summary')).toBeVisible();

  await page.waitForTimeout(1000);
  expect(
    warnings.filter((warning) => warning.includes('allow-scripts and allow-same-origin')),
  ).toEqual([]);
});

test('graph nodes keep explicit visual frame size after expand and close', async ({ page, request }) => {
  const createResponse = await request.post('/api/canvas/graph', {
    data: {
      title: 'Stable graph frame',
      graphType: 'bar',
      data: [
        { label: 'A', value: 10 },
        { label: 'B', value: 18 },
      ],
      xKey: 'label',
      yKey: 'value',
      x: 420,
      y: 220,
      width: 480,
      nodeHeight: 380,
      height: 240,
    },
  });
  const created = await createResponse.json() as { id: string };

  await request.post('/api/canvas/viewport', { data: { x: 0, y: 0, scale: 1 } });
  await page.goto('/workbench');

  const graphNode = page.locator('.canvas-node').filter({ hasText: 'Stable graph frame' });
  await expect(graphNode).toHaveCount(1);
  await expect(graphNode.frameLocator('iframe').locator('.recharts-responsive-container')).toBeVisible();

  const before = await graphNode.boundingBox();
  expect(before?.width).toBeCloseTo(480, 1);
  expect(before?.height).toBeCloseTo(380, 1);

  await graphNode.getByTitle('Expand (focus mode)').click();
  await expect(page.locator('.expanded-overlay-panel')).toBeVisible();
  await page.getByTitle('Close (Esc)').click();
  await expect(page.locator('.expanded-overlay-panel')).toHaveCount(0);

  await expect.poll(async () => {
    const box = await graphNode.boundingBox();
    return box ? `${Math.round(box.width)}x${Math.round(box.height)}` : '';
  }).toBe('480x380');

  await expect.poll(async () => {
    const response = await request.get(`/api/canvas/node/${created.id}`);
    const node = await response.json() as { size: { width: number; height: number } };
    return `${node.size.width}x${node.size.height}`;
  }).toBe('480x380');
});

test('expanded graph nodes stretch chart content to the overlay frame', async ({ page, request }) => {
  await request.post('/api/canvas/graph', {
    data: {
      title: 'Expanded graph fill guard',
      graphType: 'bar',
      data: [
        { label: 'Inline', value: 42 },
        { label: 'Expanded', value: 88 },
        { label: 'Fit', value: 72 },
      ],
      xKey: 'label',
      yKey: 'value',
      x: 420,
      y: 220,
      width: 480,
      nodeHeight: 380,
      height: 240,
    },
  });

  await request.post('/api/canvas/viewport', { data: { x: 0, y: 0, scale: 1 } });
  await page.goto('/workbench');

  const graphNode = page.locator('.canvas-node').filter({ hasText: 'Expanded graph fill guard' });
  await expect(graphNode).toHaveCount(1);
  await graphNode.getByTitle('Expand (focus mode)').click();
  const overlay = page.locator('.expanded-overlay-panel');
  await expect(overlay).toBeVisible();

  const expandedFrame = overlay.frameLocator('iframe');
  await expect(expandedFrame.locator('.recharts-responsive-container')).toBeVisible();

  const metrics = await overlay.locator('iframe').evaluate((iframe) => {
    const iframeRect = iframe.getBoundingClientRect();
    return {
      iframeHeight: iframeRect.height,
      iframeWidth: iframeRect.width,
    };
  });

  const chartMetrics = await expandedFrame.locator('.recharts-surface').evaluate((surface) => {
    const rect = surface.getBoundingClientRect();
    return {
      surfaceHeight: rect.height,
      viewportHeight: window.innerHeight,
    };
  });

  expect(metrics.iframeWidth).toBeGreaterThan(900);
  expect(metrics.iframeHeight).toBeGreaterThan(700);
  expect(chartMetrics.surfaceHeight).toBeGreaterThan(metrics.iframeHeight * 0.7);
  expect(chartMetrics.surfaceHeight).toBeLessThanOrEqual(chartMetrics.viewportHeight);
});

test('compact graph charts keep plotted content inside the iframe viewport', async ({ page, request }) => {
  const createResponse = await request.post('/api/canvas/graph', {
    data: {
      title: 'Compact clipping guard',
      graphType: 'stacked-bar',
      data: [
        { label: 'A', north: 10, south: 4 },
        { label: 'B', north: 18, south: 7 },
      ],
      xKey: 'label',
      series: ['north', 'south'],
      showLegend: false,
      x: 420,
      y: 220,
      width: 480,
      nodeHeight: 380,
      height: 240,
    },
  });
  const created = await createResponse.json() as { id: string };

  await request.post('/api/canvas/viewport', { data: { x: 0, y: 0, scale: 1 } });
  await page.goto('/workbench');

  const graphNode = page.locator('.canvas-node').filter({ hasText: 'Compact clipping guard' });
  await expect(graphNode).toHaveCount(1);
  const frame = graphNode.frameLocator('iframe');
  await expect(frame.locator('.recharts-responsive-container')).toBeVisible();

  const chartBounds = await frame.locator('.recharts-surface').evaluate((surface) => {
    const root = document.documentElement.getBoundingClientRect();
    const elements = Array.from(surface.querySelectorAll('text, path, rect, circle, polygon'));
    return elements.flatMap((element) => {
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) return [];
      return [{
        left: box.left - root.left,
        top: box.top - root.top,
        right: box.right - root.left,
        bottom: box.bottom - root.top,
        width: box.width,
        height: box.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        surfaceWidth: surface.getBoundingClientRect().width,
        surfaceHeight: surface.getBoundingClientRect().height,
      }];
    });
  });

  expect(chartBounds.length).toBeGreaterThan(0);
  for (const box of chartBounds) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(box.viewportWidth);
    expect(box.bottom).toBeLessThanOrEqual(box.viewportHeight);
    expect(box.surfaceWidth).toBeGreaterThan(300);
    expect(box.surfaceHeight).toBeGreaterThan(200);
  }

  const response = await request.get(`/api/canvas/node/${created.id}`);
  const node = await response.json() as { data: { spec?: { elements?: Record<string, { props?: Record<string, unknown> }> } } };
  expect(node.data.spec?.elements?.chart?.props?.showLegend).toBe(false);
});

test('ordinary node pin updates the authoritative canvas state', async ({ page, request }) => {
  const createResponse = await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Pin me',
      content: 'Pinned for arrange exclusion',
      x: 640,
      y: 260,
    },
  });
  const created = await createResponse.json() as { id: string };

  await page.goto('/workbench');

  const note = page.locator('.canvas-node').filter({ hasText: 'Pin me' });
  await expect(note).toHaveCount(1);

  await note.click({ button: 'right' });
  await page.locator('.context-menu-item').filter({ hasText: 'Pin (exclude from auto-arrange)' }).click();

  await expect(note).toHaveClass(/pinned/);
  await expect.poll(async () => {
    const response = await request.get(`/api/canvas/node/${created.id}`);
    const node = await response.json() as { pinned: boolean };
    return node.pinned;
  }).toBe(true);
});

test('zoomed-out node chrome keeps usable action hit targets', async ({ page, request }) => {
  await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Zoom chrome note',
      content: 'Zoomed-out controls should stay hittable',
      x: 180,
      y: 180,
    },
  });

  await request.post('/api/canvas/viewport', {
    data: { x: 0, y: 0, scale: 0.56 },
  });

  await page.goto('/workbench');

  const note = page.locator('.canvas-node').filter({ hasText: 'Zoom chrome note' });
  await expect(note).toHaveCount(1);
  await note.hover();

  const controlSizes = await note.locator('.node-controls button').evaluateAll((buttons) => {
    return buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        title: button.getAttribute('title'),
        width: rect.width,
        height: rect.height,
      };
    });
  });

  for (const title of ['Add to context', 'Expand (focus mode)', 'Close']) {
    const control = controlSizes.find((button) => button.title === title);
    expect(control, `expected ${title} control to exist`).toBeDefined();
    expect(control?.width ?? 0, `${title} width`).toBeGreaterThanOrEqual(20);
    expect(control?.height ?? 0, `${title} height`).toBeGreaterThanOrEqual(20);
  }
});

test('group context menu updates the group accent color', async ({ page, request }) => {
  const createResponse = await request.post('/api/canvas/group', {
    data: {
      title: 'Color group',
      x: 520,
      y: 240,
      width: 520,
      height: 280,
    },
  });
  const created = await createResponse.json() as { id: string };

  await page.goto('/workbench');

  const group = page.locator('.canvas-node.group-node').filter({ hasText: 'Color group' });
  await expect(group).toHaveCount(1);

  await group.click({ button: 'right' });
  await page.getByRole('button', { name: 'Set group color to Green' }).click();

  await expect.poll(async () => {
    const response = await request.get(`/api/canvas/node/${created.id}`);
    const node = await response.json() as { data: Record<string, unknown> };
    return node.data.color;
  }).toBe('#22c55e');

  await expect(group).toHaveCSS('border-top-color', 'rgb(34, 197, 94)');
});

test('restored grouped nodes can be dragged without snapping back', async ({ page, request }) => {
  const firstResponse = await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Grouped first',
      content: 'First child',
      x: 560,
      y: 240,
    },
  });
  const first = await firstResponse.json() as { id: string };

  const secondResponse = await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Grouped second',
      content: 'Second child',
      x: 940,
      y: 240,
    },
  });
  const second = await secondResponse.json() as { id: string };

  const groupResponse = await request.post('/api/canvas/group', {
    data: {
      title: 'Restore drag group',
      childIds: [first.id, second.id],
    },
  });
  const group = await groupResponse.json() as { id: string };

  const saveResponse = await request.post('/api/canvas/snapshots', {
    data: { name: 'Grouped drag restore snapshot' },
  });
  const saved = await saveResponse.json() as { snapshot: { id: string } };

  await request.patch(`/api/canvas/node/${first.id}`, {
    data: { position: { x: 1160, y: 740 } },
  });

  await page.goto('/workbench');
  await request.post(`/api/canvas/snapshots/${saved.snapshot.id}`);

  const groupedFirst = page.locator('.canvas-node').filter({ hasText: 'Grouped first' });
  const groupedGroup = page.locator('.canvas-node.group-node').filter({ hasText: 'Restore drag group' });
  await expect(groupedFirst).toHaveCount(1);
  await expect(groupedGroup).toHaveCount(1);

  const beforeGroupResponse = await request.get(`/api/canvas/node/${group.id}`);
  const beforeChildResponse = await request.get(`/api/canvas/node/${first.id}`);
  const beforeGroup = await beforeGroupResponse.json() as { position: { x: number; y: number } };
  const beforeChild = await beforeChildResponse.json() as { position: { x: number; y: number } };

  await dragNodeTitlebar(page, groupedGroup, 180, 120);

  await expect.poll(async () => {
    const groupResponseAfter = await request.get(`/api/canvas/node/${group.id}`);
    const childResponseAfter = await request.get(`/api/canvas/node/${first.id}`);
    const groupNode = await groupResponseAfter.json() as { position: { x: number; y: number } };
    const childNode = await childResponseAfter.json() as { position: { x: number; y: number } };
    const groupDeltaX = groupNode.position.x - beforeGroup.position.x;
    const groupDeltaY = groupNode.position.y - beforeGroup.position.y;
    const childDeltaX = childNode.position.x - beforeChild.position.x;
    const childDeltaY = childNode.position.y - beforeChild.position.y;
    return (
      (Math.abs(groupDeltaX) > 10 || Math.abs(groupDeltaY) > 10) &&
      Math.abs(groupDeltaX - childDeltaX) <= 1 &&
      Math.abs(groupDeltaY - childDeltaY) <= 1
    );
  }).toBe(true);
});

test('light theme uses a high-contrast blue for context-pinned nodes', async ({ page, request }) => {
  const createResponse = await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Light theme pin',
      content: 'Pinned in light theme',
      x: 640,
      y: 260,
    },
  });
  const created = await createResponse.json() as { id: string };

  await page.goto('/workbench');
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
  });

  const note = page.locator('.canvas-node').filter({ hasText: 'Light theme pin' });
  await expect(note).toHaveCount(1);

  await note.locator('.ctx-pin-btn').click();

  await expect.poll(async () => {
    const response = await request.get('/api/canvas/pinned-context');
    const pinned = await response.json() as { nodeIds: string[] };
    return pinned.nodeIds;
  }).toContain(created.id);

  await expect(note).toHaveCSS('border-top-color', 'rgb(75, 188, 255)');
  await expect.poll(async () => {
    return await note.evaluate((element) => getComputedStyle(element).boxShadow);
  }).toContain('75, 188, 255');
});

test('annotations use theme contrast colors and can be erased', async ({ page, request }) => {
  await request.post('/api/canvas/annotation', {
    data: {
      points: [{ x: 100, y: 120 }, { x: 220, y: 120 }],
      color: 'currentColor',
      width: 4,
    },
  });

  await page.goto('/workbench');
  const annotation = page.locator('.annotation-layer path');
  await expect(annotation).toHaveCount(1);
  await expect(annotation).toHaveCSS('stroke', 'rgb(244, 239, 230)');

  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
  });
  await expect(annotation).toHaveCSS('stroke', 'rgb(8, 21, 36)');

  await page.getByLabel('Erase annotations').click();
  await page.mouse.click(160, 120);

  await expect(annotation).toHaveCount(0);
  await expect.poll(async () => {
    const response = await request.get('/api/canvas/state');
    const state = await response.json() as { annotations?: unknown[] };
    return state.annotations?.length ?? 0;
  }).toBe(0);
});

test('can start pen and text annotations over nodes', async ({ page, request }) => {
  await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Annotate target',
      content: 'Draw and type over this node.',
      x: 120,
      y: 100,
      width: 360,
      height: 220,
    },
  });

  await page.goto('/workbench');
  await expect(page.locator('.canvas-node').filter({ hasText: 'Annotate target' })).toHaveCount(1);

  await page.getByLabel('Annotate canvas').click();
  await page.mouse.move(220, 190);
  await page.mouse.down();
  await page.mouse.move(300, 230, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.annotation-layer path')).toHaveCount(1);

  await page.getByLabel('Text annotations').click();
  await page.mouse.click(240, 260);
  await page.locator('.annotation-text-input').fill('Intent note');
  await page.keyboard.press('Enter');
  await expect(page.locator('.annotation-layer text')).toContainText('Intent note');
  await expect(page.locator('.annotation-layer text')).toHaveCSS('fill', 'rgb(244, 239, 230)');

  await expect.poll(async () => {
    const response = await request.get('/api/canvas/state');
    const state = await response.json() as { annotations?: Array<{ type?: string; text?: string }> };
    return state.annotations?.map((annotation) => `${annotation.type}:${annotation.text ?? ''}`).sort() ?? [];
  }).toEqual(['freehand:', 'text:Intent note']);
});

test('annotation toolbar actions preserve the current light theme', async ({ page }) => {
  await page.goto('/workbench');
  await page.getByLabel('Switch to light theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByLabel('Annotate canvas').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByLabel('Stop annotating').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByLabel('Erase annotations').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('server-side focus updates the browser viewport', async ({ page, request }) => {
  const createResponse = await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Focus me',
      content: 'Focus target',
      x: 900,
      y: 700,
    },
  });
  const created = await createResponse.json() as { id: string };

  await page.goto('/workbench');
  await expect(page.locator('.canvas-node').filter({ hasText: 'Focus me' })).toHaveCount(1);

  await request.post('/api/canvas/focus', {
    data: { id: created.id },
  });

  await expect.poll(async () => {
    return await page.evaluate(() => {
      const viewport = document.querySelector('.canvas-viewport > div[style*="position: absolute"]') as HTMLElement | null;
      return viewport?.style.transform ?? null;
    });
  }).toContain('matrix(1, 0, 0, 1, 800, 600)');
});

test('authoritative viewport updates from the server override browser startup state', async ({ page, request }) => {
  await request.post('/api/canvas/viewport', {
    data: { x: 120, y: -80, scale: 1.5 },
  });

  await page.goto('/workbench');

  await expect.poll(async () => {
    return await page.evaluate(() => {
      const viewport = document.querySelector('.canvas-viewport > div[style*="position: absolute"]') as HTMLElement | null;
      return viewport?.style.transform ?? null;
    });
  }).toContain('matrix(1.5, 0, 0, 1.5, 120, -80)');
});
