import { expect, test, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const playwrightPort = Number(process.env.PMX_PLAYWRIGHT_PORT ?? '4517');

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
  await request.post('/api/canvas/theme', {
    data: { theme: 'dark' },
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

test('renders every canvas node type in the browser', async ({ page, request }) => {
  const mcpFrameResponse = await request.post('/api/canvas/frame-documents', {
    data: {
      html: '<!doctype html><main><h1>MCP App Renderer</h1><p>Iframe-backed app node.</p></main>',
      sandbox: 'allow-scripts',
    },
  });
  const mcpFrame = await mcpFrameResponse.json() as { url: string };

  const webpageFrameResponse = await request.post('/api/canvas/frame-documents', {
    data: {
      html: [
        '<!doctype html>',
        '<html><head><title>Webpage Renderer Fixture</title>',
        '<meta name="description" content="Local webpage renderer description.">',
        '</head><body><main>Webpage renderer body.</main></body></html>',
      ].join(''),
      sandbox: 'allow-scripts',
    },
  });
  const webpageFrame = await webpageFrameResponse.json() as { url: string };
  const webpageUrl = `http://127.0.0.1:${playwrightPort}${webpageFrame.url}`;
  const imageSvg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90">',
    '<rect width="160" height="90" fill="#1d4ed8"/>',
    '<text x="16" y="50" fill="white" font-size="16">IMG node</text>',
    '</svg>',
  ].join('');

  await request.post('/api/canvas/batch', {
    data: {
      operations: [
        {
          op: 'node.add',
          args: {
            type: 'markdown',
            title: 'All Types Markdown',
            content: 'Markdown renderer body',
            x: 0,
            y: 0,
            width: 360,
            height: 220,
          },
        },
        {
          op: 'node.add',
          args: {
            type: 'status',
            title: 'All Types Status',
            data: {
              phase: 'testing',
              detail: 'status renderer detail',
              message: 'status renderer message',
            },
            x: 430,
            y: 0,
            width: 360,
            height: 220,
          },
        },
        {
          op: 'node.add',
          args: {
            type: 'context',
            title: 'All Types Context',
            data: {
              currentTokens: 420,
              tokenLimit: 1000,
              utilization: 0.42,
              messagesLength: 7,
              cards: [
                {
                  title: 'Context renderer card',
                  summary: 'Context renderer summary',
                  pathDisplay: 'tests/context.md',
                  sourceKind: 'workspace',
                },
              ],
            },
            x: 860,
            y: 0,
            width: 360,
            height: 260,
          },
        },
        {
          op: 'node.add',
          args: {
            type: 'ledger',
            title: 'All Types Ledger',
            data: { passedChecks: 15, failedChecks: 0 },
            x: 1290,
            y: 0,
            width: 360,
            height: 220,
          },
        },
        {
          op: 'node.add',
          args: {
            type: 'trace',
            title: 'All Types Trace',
            data: {
              toolName: 'canvas_render_all_types',
              category: 'mcp',
              status: 'success',
              duration: '12ms',
              resultSummary: 'trace renderer result',
            },
            x: 0,
            y: 330,
            width: 360,
            height: 140,
          },
        },
        {
          op: 'node.add',
          args: {
            type: 'file',
            title: 'all-types-fixture.ts',
            content: 'export const fileRenderer = "file renderer body";',
            x: 430,
            y: 330,
            width: 420,
            height: 260,
          },
        },
        {
          op: 'node.add',
          args: {
            type: 'image',
            title: 'All Types Image',
            content: `data:image/svg+xml,${encodeURIComponent(imageSvg)}`,
            data: {
              alt: 'All node types image',
              caption: 'Image renderer caption',
            },
            x: 860,
            y: 330,
            width: 360,
            height: 260,
          },
        },
        {
          op: 'node.add',
          args: {
            type: 'html',
            title: 'All Types HTML',
            html: '<main><h1>HTML Renderer</h1><p>HTML renderer body.</p></main>',
            x: 1290,
            y: 330,
            width: 420,
            height: 300,
          },
        },
        {
          op: 'node.add',
          args: {
            type: 'prompt',
            title: 'All Types Prompt',
            data: {
              text: 'Prompt renderer question',
              turns: [{ role: 'user', text: 'Prompt renderer question', status: 'pending' }],
              threadStatus: 'pending',
              status: 'pending',
            },
            x: 0,
            y: 680,
            width: 420,
            height: 260,
          },
        },
        {
          op: 'node.add',
          args: {
            type: 'response',
            title: 'All Types Response',
            data: {
              content: 'Response renderer answer',
              status: 'complete',
            },
            x: 430,
            y: 680,
            width: 420,
            height: 260,
          },
        },
        {
          op: 'node.add',
          args: {
            type: 'mcp-app',
            title: 'All Types MCP App',
            data: {
              url: mcpFrame.url,
              title: 'All Types MCP App',
              sourceServer: 'all-types-fixture',
              trustedDomain: true,
            },
            x: 860,
            y: 680,
            width: 420,
            height: 300,
          },
        },
      ],
    },
  });

  await request.post('/api/canvas/node', {
    data: {
      type: 'webpage',
      title: 'All Types Webpage',
      url: webpageUrl,
      x: 1290,
      y: 680,
      width: 420,
      height: 300,
    },
  });

  await request.post('/api/canvas/json-render', {
    data: {
      title: 'All Types JSON Render',
      spec: {
        root: 'card',
        elements: {
          card: {
            type: 'Card',
            props: { title: 'JSON Renderer Card', description: 'JSON renderer description' },
            children: ['body'],
          },
          body: {
            type: 'Text',
            props: { text: 'JSON renderer body' },
            children: [],
          },
        },
      },
      x: 0,
      y: 1030,
      width: 420,
      height: 300,
    },
  });

  await request.post('/api/canvas/graph', {
    data: {
      title: 'All Types Graph',
      graphType: 'bar',
      data: [
        { label: 'One', value: 12 },
        { label: 'Two', value: 18 },
      ],
      xKey: 'label',
      yKey: 'value',
      x: 430,
      y: 1030,
      width: 420,
      nodeHeight: 300,
      height: 220,
    },
  });

  await request.post('/api/canvas/group', {
    data: {
      title: 'All Types Group',
      x: 860,
      y: 1030,
      width: 420,
      height: 260,
    },
  });

  await request.post('/api/canvas/viewport', {
    data: { x: 80, y: 100, scale: 0.5, recordHistory: false },
  });

  await page.goto('/workbench');

  await expect.poll(async () => {
    const state = await currentCanvasState(request);
    return state.nodes.map((node) => node.type).sort();
  }).toEqual([
    'context',
    'file',
    'graph',
    'group',
    'html',
    'image',
    'json-render',
    'ledger',
    'markdown',
    'mcp-app',
    'prompt',
    'response',
    'status',
    'trace',
    'webpage',
  ]);

  const node = (title: string) => page.locator('.canvas-node').filter({ hasText: title });

  await expect(node('All Types Markdown')).toContainText('Markdown renderer body');
  await expect(node('All Types Status')).toContainText('testing');
  await expect(node('All Types Status')).toContainText('status renderer message');
  await page.getByRole('button', { name: 'Context — 1 item' }).click();
  await expect(page.locator('.context-dock-panel')).toContainText('Context renderer card');
  await expect(page.locator('.context-dock-panel')).toContainText('42%');
  await expect(node('All Types Ledger')).toContainText('Passed Checks');
  await expect(node('All Types Trace')).toContainText('canvas_render_all_types');
  await expect(node('All Types Trace')).toContainText('trace renderer result');
  await expect(node('all-types-fixture.ts')).toContainText('file renderer body');
  await expect(node('All Types Image').locator('.image-node img')).toBeVisible();
  await expect(node('All Types Image')).toContainText('Image renderer caption');
  await expect(node('All Types Webpage')).toContainText('Webpage Renderer Fixture');
  await expect(node('All Types Webpage')).toContainText('Local webpage renderer description.');
  await expect(node('All Types Prompt')).toContainText('Prompt renderer question');
  await expect(node('All Types Response')).toContainText('Response renderer answer');
  await expect(node('All Types Group')).toContainText('Drag nodes here');

  await expect(node('All Types HTML').frameLocator('iframe').getByRole('heading', { name: 'HTML Renderer' })).toBeVisible();
  await expect(node('All Types MCP App').frameLocator('iframe').getByRole('heading', { name: 'MCP App Renderer' })).toBeVisible();
  await expect(node('All Types JSON Render').frameLocator('iframe').getByText('JSON Renderer Card', { exact: true })).toBeVisible();
  await expect(node('All Types Graph').frameLocator('iframe').locator('.recharts-responsive-container')).toBeVisible();
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

test('dragging nodes suppresses attention field overlays', async ({ page, request }) => {
  await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Blue overlay drag guard',
      content: 'Drag me without repainting focus fields.',
      x: 420,
      y: 260,
      width: 420,
      height: 220,
    },
  });

  await page.goto('/workbench');

  await page.evaluate(() => {
    const worldLayer = document.querySelector('.canvas-viewport > div');
    if (!worldLayer) throw new Error('Canvas world layer not found.');
    const field = document.createElement('div');
    field.className = 'attention-field-layer';
    field.setAttribute('data-test-attention-field', 'true');
    worldLayer.prepend(field);
  });

  const node = page.locator('.canvas-node').filter({ hasText: 'Blue overlay drag guard' });
  await expect(node).toHaveCount(1);

  const titlebar = node.locator('.node-titlebar');
  const box = await titlebar.boundingBox();
  if (!box) throw new Error('Node titlebar is not visible for dragging.');
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await expect.poll(async () => page.locator('html').evaluate((html) => html.classList.contains('is-node-dragging'))).toBe(true);
  await expect(page.locator('[data-test-attention-field="true"]')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('html')).toHaveCSS('user-select', 'none');
  await expect.poll(async () => page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');

  await page.mouse.move(startX + 80, startY + 50, { steps: 6 });
  await expect.poll(async () => page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  await page.mouse.up();
  await expect.poll(async () => page.locator('html').evaluate((html) => html.classList.contains('is-node-dragging'))).toBe(false);
  await expect(page.locator('[data-test-attention-field="true"]')).toHaveCSS('visibility', 'visible');
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

test('core canvas API workflows stay synchronized with the browser', async ({ page, request }) => {
  const batchResponse = await request.post('/api/canvas/batch', {
    data: {
      operations: [
        {
          op: 'node.add',
          assign: 'alpha',
          args: {
            type: 'markdown',
            title: 'Workflow Alpha',
            content: 'Alpha searchable body',
            x: 120,
            y: 160,
            width: 360,
            height: 220,
          },
        },
        {
          op: 'node.add',
          assign: 'beta',
          args: {
            type: 'markdown',
            title: 'Workflow Beta',
            content: 'Beta linked body',
            x: 660,
            y: 160,
            width: 360,
            height: 220,
          },
        },
        {
          op: 'edge.add',
          args: {
            from: '$alpha.id',
            to: '$beta.id',
            type: 'flow',
            label: 'workflow edge',
            animated: true,
          },
        },
        {
          op: 'pin.set',
          args: { nodeIds: ['$alpha.id'] },
        },
        {
          op: 'snapshot.save',
          assign: 'baseline',
          args: { name: 'workflow-baseline' },
        },
      ],
    },
  });
  expect(batchResponse.ok()).toBe(true);
  const batch = await batchResponse.json() as {
    ok: boolean;
    refs: {
      alpha: { id: string };
      beta: { id: string };
      baseline: { snapshot: { id: string } };
    };
  };
  expect(batch.ok).toBe(true);

  await page.goto('/workbench');
  const alphaNode = page.locator('.canvas-node').filter({ hasText: 'Workflow Alpha' });
  const betaNode = page.locator('.canvas-node').filter({ hasText: 'Workflow Beta' });
  await expect(alphaNode).toHaveCount(1);
  await expect(betaNode).toHaveCount(1);
  await expect(page.getByText('workflow edge')).toBeVisible();
  await expect(page.locator('.context-pin-bar')).toContainText('1 node in context');

  const search = await request.get('/api/canvas/search?q=searchable');
  const searchBody = await search.json() as { results: Array<{ id: string; title?: string }> };
  expect(searchBody.results.map((result) => result.id)).toContain(batch.refs.alpha.id);

  const pinned = await request.get('/api/canvas/pinned-context');
  const pinnedBody = await pinned.json() as { count: number; nodeIds: string[] };
  expect(pinnedBody.count).toBe(1);
  expect(pinnedBody.nodeIds).toEqual([batch.refs.alpha.id]);

  const spatial = await request.get('/api/canvas/spatial-context');
  const spatialBody = await spatial.json() as {
    pinnedNeighborhoods?: Array<{ pinnedNodeId: string; nearbyNodes?: Array<{ id: string }> }>;
  };
  expect(spatialBody.pinnedNeighborhoods?.some((entry) => entry.pinnedNodeId === batch.refs.alpha.id)).toBe(true);

  const axFocus = await request.post('/api/canvas/ax/focus', {
    data: { nodeIds: [batch.refs.beta.id], source: 'codex' },
  });
  expect(axFocus.ok()).toBe(true);
  await expect.poll(async () => {
    const ax = await request.get('/api/canvas/ax');
    const body = await ax.json() as { state?: { focus?: { nodeIds?: string[]; source?: string } } };
    return {
      nodeIds: body.state?.focus?.nodeIds,
      source: body.state?.focus?.source,
    };
  }).toEqual({ nodeIds: [batch.refs.beta.id], source: 'codex' });

  await request.post('/api/canvas/focus', {
    data: { id: batch.refs.beta.id },
  });
  await expect(betaNode).toHaveClass(/active/);

  const beforeArrange = await currentCanvasState(request);
  const beforeAlpha = beforeArrange.nodes.find((node) => node.id === batch.refs.alpha.id)?.position;
  await request.post('/api/canvas/arrange', { data: { layout: 'column' } });
  await expect.poll(async () => {
    const state = await currentCanvasState(request);
    const alpha = state.nodes.find((node) => node.id === batch.refs.alpha.id);
    return alpha?.position;
  }).not.toEqual(beforeAlpha);

  const fitResponse = await request.post('/api/canvas/fit', {
    data: { nodeIds: [batch.refs.alpha.id, batch.refs.beta.id], width: 1440, height: 900, padding: 80 },
  });
  expect(fitResponse.ok()).toBe(true);
  await expect.poll(async () => {
    const state = await currentCanvasState(request);
    return state.nodes.length;
  }).toBe(2);

  const gammaResponse = await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Workflow Gamma',
      content: 'Undo target',
      x: 1200,
      y: 160,
    },
  });
  expect(gammaResponse.ok()).toBe(true);
  const gamma = await gammaResponse.json() as { id: string };
  await expect(page.locator('.canvas-node').filter({ hasText: 'Workflow Gamma' })).toHaveCount(1);

  const diffResponse = await request.get(`/api/canvas/snapshots/${batch.refs.baseline.snapshot.id}/diff`);
  const diff = await diffResponse.json() as { text: string };
  expect(diff.text).toContain('Workflow Gamma');

  const undoResponse = await request.post('/api/canvas/undo');
  expect(undoResponse.ok()).toBe(true);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Workflow Gamma' })).toHaveCount(0);
  await expect.poll(async () => {
    const state = await currentCanvasState(request);
    return state.nodes.some((node) => node.id === gamma.id);
  }).toBe(false);

  const redoResponse = await request.post('/api/canvas/redo');
  expect(redoResponse.ok()).toBe(true);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Workflow Gamma' })).toHaveCount(1);

  const historyResponse = await request.get('/api/canvas/history');
  const history = await historyResponse.json() as { canUndo: boolean; entries: unknown[]; text: string };
  expect(history.canUndo).toBe(true);
  expect(history.entries.length).toBeGreaterThan(0);
  expect(history.text).toContain('Added markdown node');

  const validateResponse = await request.get('/api/canvas/validate');
  const validation = await validateResponse.json() as { ok: boolean };
  expect(validation.ok).toBe(true);
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
  await expect(overlay.getByRole('button', { name: 'Open as site' })).toHaveCount(1);
  await expect(overlay.getByRole('button', { name: 'Open in system browser' })).toHaveCount(0);
  await page.getByTitle('Close (Esc)').click();
});

test('opens an html node as a standalone site with the current theme', async ({ page, context, request }) => {
  await request.post('/api/canvas/node', {
    data: {
      type: 'html',
      title: 'Open As Site Target',
      html: '<main><h1>Standalone surface render</h1></main>',
      x: 640,
      y: 260,
      width: 520,
      height: 360,
    },
  });

  await request.post('/api/canvas/theme', {
    data: { theme: 'light' },
  });

  await page.goto('/workbench');
  const htmlNode = page.locator('.canvas-node').filter({ hasText: 'Open As Site Target' });
  await expect(htmlNode).toHaveCount(1);

  const openButton = htmlNode.locator('.node-controls button[title="Open as site"]');
  await expect(openButton).toHaveCount(1);
  await expect(htmlNode.getByTitle('Open in system browser')).toHaveCount(0);

  const popupPromise = context.waitForEvent('page');
  await openButton.click();
  const popup = await popupPromise;

  // Same stable surface URL the in-canvas iframe loads — one render path.
  await expect(popup).toHaveURL(/\/api\/canvas\/surface\/.*theme=light/);
  await expect(popup.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(popup.getByText('Standalone surface render')).toBeVisible();
  await popup.close();
});

test('html bridge: an opted-in html node emits an AX interaction via window.PMX_AX', async ({ page, request }) => {
  await request.post('/api/canvas/node', {
    data: {
      type: 'html',
      title: 'AX bridge html',
      html: '<main><h1>Bridge</h1><button onclick="window.PMX_AX.emit(\'ax.work.create\', { title: \'from-html-bridge\' })">emit</button></main>',
      data: { axCapabilities: { enabled: true, allowed: ['ax.work.create'] } },
      x: 640, y: 260, width: 520, height: 360,
    },
  });
  await page.goto('/workbench');
  const node = page.locator('.canvas-node').filter({ hasText: 'AX bridge html' });
  await expect(node).toHaveCount(1);
  await node.frameLocator('iframe').getByRole('button', { name: 'emit' }).click();

  await expect.poll(async () => {
    const ax = await request.get('/api/canvas/ax');
    const body = await ax.json() as { state?: { workItems?: Array<{ title: string }> } };
    return (body.state?.workItems ?? []).some((w) => w.title === 'from-html-bridge');
  }).toBe(true);
});

test('html bridge: window.PMX_AX.emit resolves with the result so the surface can self-confirm (#55)', async ({ page, request }) => {
  // The surface awaits emit() and flips a status label on the ack — the built-in
  // confirmation that fixes "clicks look like nothing happened".
  const html = '<main><button onclick="go()">emit</button><span id="st">idle</span>'
    + '<script>async function go(){var r=await window.PMX_AX.emit("ax.work.create",{title:"ack-confirmed"});'
    + 'document.getElementById("st").textContent=r&&r.ok?"queued OK":"failed";}</script></main>';
  await request.post('/api/canvas/node', {
    data: {
      type: 'html',
      title: 'AX ack html',
      html,
      data: { axCapabilities: { enabled: true, allowed: ['ax.work.create'] } },
      x: 640, y: 260, width: 520, height: 360,
    },
  });
  await page.goto('/workbench');
  const node = page.locator('.canvas-node').filter({ hasText: 'AX ack html' });
  await expect(node).toHaveCount(1);
  const frame = node.frameLocator('iframe');
  await frame.getByRole('button', { name: 'emit' }).click();
  // The promise resolved with { ok: true } via the parent's ack postMessage.
  await expect(frame.locator('#st')).toHaveText('queued OK');
});

test('ext-app bridge: window.PMX_AX.emit resolves with the result so the app can self-confirm (#55)', async ({ page, request }) => {
  const html = '<main><button onclick="go()">emit</button><span id="st">idle</span>'
    + '<script>async function go(){var r=await window.PMX_AX.emit("ax.work.create",{title:"ack-confirmed-ext-app"});'
    + 'document.getElementById("st").textContent=r&&r.ok?"queued OK":"failed";}</script></main>';
  await request.post('/api/canvas/node', {
    data: {
      type: 'mcp-app',
      title: 'AX ack ext app',
      data: {
        mode: 'ext-app',
        html,
        axCapabilities: { enabled: true, allowed: ['ax.work.create'] },
        sessionStatus: 'ready',
      },
      x: 640, y: 260, width: 520, height: 360,
    },
  });
  await page.goto('/workbench');
  const node = page.locator('.canvas-node').filter({ hasText: 'AX ack ext app' });
  await expect(node).toHaveCount(1);
  await node.getByLabel('Open full view to edit').click();
  const expandedNode = page.locator('.expanded-overlay-panel').filter({ hasText: 'AX ack ext app' });
  await expect(expandedNode).toHaveCount(1);
  const frame = expandedNode.frameLocator('iframe');
  await frame.getByRole('button', { name: 'emit' }).click();
  await expect(frame.locator('#st')).toHaveText('queued OK');
});

test('#61: hosted ext-app nodes are not openable as a standalone site', async ({ page, request }) => {
  const created = await request.post('/api/canvas/node', {
    data: {
      type: 'mcp-app',
      title: 'Ext app no open-as-site',
      data: { mode: 'ext-app', html: '<main><h1>Hosted App</h1></main>', sessionStatus: 'ready' },
      x: 360, y: 200, width: 480, height: 320,
    },
  });
  const id = (await created.json() as { id: string }).id;
  expect(id).toBeTruthy();

  // Server: the standalone surface route refuses cleanly (404), instead of serving
  // the live MCP-app shell that errored with `-32601` (report #61).
  const surface = await request.get(`/api/canvas/surface/${id}`, { maxRedirects: 0 });
  expect(surface.status()).toBe(404);

  // Client: the node shows NO "Open as site" control.
  await page.goto('/workbench');
  const node = page.locator('.canvas-node').filter({ hasText: 'Ext app no open-as-site' });
  await expect(node).toHaveCount(1);
  await expect(node.getByTitle('Open as site')).toHaveCount(0);
});

test('#63: node context menu pins to the human-curated context set (primary "Pin as context")', async ({ page, request }) => {
  await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'Ctx pin target', content: '# pin me', x: 360, y: 220 },
  });
  await page.goto('/workbench');
  const node = page.locator('.canvas-node').filter({ hasText: 'Ctx pin target' });
  await expect(node).toHaveCount(1);

  await node.locator('.node-titlebar').click({ button: 'right' });
  const menu = page.locator('.context-menu');
  await expect(menu.locator('.context-menu-item').filter({ hasText: 'Pin as context' })).toBeVisible();
  // The arrange-lock item is renamed off the word "Pin" so it no longer collides.
  await expect(menu.locator('.context-menu-item').filter({ hasText: 'Lock position' })).toBeVisible();

  await menu.locator('.context-menu-item').filter({ hasText: 'Pin as context' }).click();
  // The node's context-pin indicator becomes active (same signal that drives the count).
  await expect(node.locator('.ctx-pin-btn.ctx-pin-active')).toBeVisible();
});

test('#64: status nodes expose the standard remove (×) control', async ({ page, request }) => {
  await request.post('/api/canvas/node', {
    data: { type: 'status', title: 'Removable status', data: { title: 'Removable status', status: 'success', message: 'done' }, x: 360, y: 220 },
  });
  await page.goto('/workbench');
  const node = page.locator('.canvas-node').filter({ hasText: 'Removable status' });
  await expect(node).toHaveCount(1);

  const closeBtn = node.locator('.node-titlebar').getByTitle('Close');
  await expect(closeBtn).toBeVisible();
  await closeBtn.click();
  await expect(node).toHaveCount(0);
});

test('json-render bridge: a spec action named ax.* emits an AX interaction via the viewer', async ({ page, request }) => {
  // json-render is AX-enabled by default with ax.work.create in its ceiling. The
  // viewer bundle wires spec actions named after AX types to a postMessage bridge;
  // McpAppViewer validates (iframe source + nonce + node id) and submits server-side.
  await request.post('/api/canvas/json-render', {
    data: {
      title: 'AX bridge json-render',
      spec: {
        root: 'btn',
        elements: {
          btn: {
            type: 'Button',
            props: { label: 'emit', variant: 'primary' },
            on: { press: { action: 'ax.work.create', params: { title: 'from-jsonrender-bridge' } } },
          },
        },
      },
      x: 640, y: 260, width: 480, height: 320,
    },
  });
  await page.goto('/workbench');
  const node = page.locator('.canvas-node').filter({ hasText: 'AX bridge json-render' });
  await expect(node).toHaveCount(1);
  await node.frameLocator('iframe').getByRole('button', { name: 'emit' }).click();

  await expect.poll(async () => {
    const ax = await request.get('/api/canvas/ax');
    const body = await ax.json() as { state?: { workItems?: Array<{ title: string }> } };
    return (body.state?.workItems ?? []).some((w) => w.title === 'from-jsonrender-bridge');
  }).toBe(true);
});

test('AX read path: an AX-enabled html board reflects live AX state (window.PMX_AX.state + pmx-ax-update)', async ({ page, request }) => {
  // A board that renders the live work-item count from the read-side bridge.
  const html = '<div id="c">init</div><script>'
    + 'function r(s){document.getElementById("c").textContent="work:"+((s&&s.workItems)?s.workItems.length:0);}'
    + 'r(window.PMX_AX&&window.PMX_AX.state);'
    + 'window.addEventListener("pmx-ax-update",function(e){r(e.detail);});'
    + '</script>';
  const created = await request.post('/api/canvas/node', {
    data: { type: 'html', title: 'AX read board', html, data: { axCapabilities: { enabled: true, allowed: ['ax.work.create'] } }, x: 640, y: 260, width: 480, height: 320 },
  });
  const nodeId = ((await created.json()) as { id: string }).id;

  await page.goto('/workbench');
  const node = page.locator('.canvas-node').filter({ hasText: 'AX read board' });
  await expect(node).toHaveCount(1);
  const frame = node.frameLocator('iframe');
  // Seeded from the server-injected snapshot at load.
  await expect(frame.locator('#c')).toHaveText('work:0');

  // An external work-item create propagates live via SSE → client → iframe push.
  await request.post('/api/canvas/ax/interaction', {
    data: { type: 'ax.work.create', sourceNodeId: nodeId, payload: { title: 'Ship it' } },
  });
  await expect(frame.locator('#c')).toHaveText('work:1');
});

test('file node evidence control records AX evidence', async ({ page, request }) => {
  await request.post('/api/canvas/node', {
    data: { type: 'file', content: 'console.log(1)', data: { path: '/tmp/evidence-file.ts' }, x: 640, y: 260 },
  });
  await page.goto('/workbench');
  const node = page.locator('.canvas-node').filter({ hasText: 'evidence-file.ts' });
  await expect(node).toHaveCount(1);
  await node.getByTitle('Mark this file as AX evidence').click();

  await expect.poll(async () => {
    const tl = await request.get('/api/canvas/ax/timeline');
    return JSON.stringify(await tl.json()).includes('evidence-file.ts');
  }).toBe(true);
});

test('ledger nodes render content as split log lines without a label or literal newlines', async ({ page, request }) => {
  await request.post('/api/canvas/node', {
    data: {
      type: 'ledger',
      title: 'Ledger render target',
      // Literal backslash-n, exactly as the shell passes through
      // `--content "a\nb"` (it does not expand the escape inside quotes).
      content: 'Entry 1: foo\\nEntry 2: bar\\nEntry 3: baz',
      x: 680,
      y: 280,
    },
  });

  await page.goto('/workbench');

  const ledgerNode = page.locator('.canvas-node').filter({ hasText: 'Ledger render target' });
  await expect(ledgerNode).toHaveCount(1);
  // Each entry renders...
  await expect(ledgerNode).toContainText('Entry 1: foo');
  await expect(ledgerNode).toContainText('Entry 2: bar');
  await expect(ledgerNode).toContainText('Entry 3: baz');
  // ...with the literal "\n" turned into line breaks (not shown verbatim) and
  // no stray "Content" field label running into the first entry.
  await expect(ledgerNode).not.toContainText('\\n');
  await expect(ledgerNode).not.toContainText('Content');
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
  await expandedPanel.getByTitle('Close (Esc)').click();
  await expect(expandedPanel).toHaveCount(0);
  const inlineFill = await appNode.evaluate((node) => {
    const iframe = node.querySelector('iframe');
    const host = iframe?.parentElement;
    if (!iframe || !host) return null;
    const iframeRect = iframe.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    return {
      iframeHeight: iframeRect.height,
      hostHeight: hostRect.height,
    };
  });
  expect(inlineFill).not.toBeNull();
  expect(inlineFill!.iframeHeight).toBeGreaterThanOrEqual(inlineFill!.hostHeight - 1);

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
    const iframe = element.closest('.canvas-node')?.querySelector('iframe');
    const previewCatcher = element.closest('.canvas-node')?.querySelector('.ext-app-preview-catcher');
    const previewRect = previewCatcher?.getBoundingClientRect();
    if (!nodeRect) throw new Error('Resize handle is not inside a canvas node.');
    const hit = document.elementFromPoint(nodeRect.right - 4, nodeRect.bottom - 4);
    return {
      width: handleRect.width,
      height: handleRect.height,
      cursor: getComputedStyle(element).cursor,
      iframePointerEvents: iframe ? getComputedStyle(iframe).pointerEvents : null,
      previewCatcherLeavesResizeCorner: previewRect ? previewRect.right <= nodeRect.right - 48 && previewRect.bottom <= nodeRect.bottom - 48 : null,
      hitIsHandle: hit === element || element.contains(hit),
    };
  });
  expect(hitTarget).toEqual({
    width: 32,
    height: 32,
    cursor: 'nwse-resize',
    iframePointerEvents: 'none',
    previewCatcherLeavesResizeCorner: true,
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
  const activeResizeStyles = await appNode.evaluate((node) => {
    const iframe = node.querySelector('iframe');
    const previewCatcher = node.querySelector('.ext-app-preview-catcher');
    return {
      nodeTransitionProperty: getComputedStyle(node).transitionProperty,
      iframePointerEvents: iframe ? getComputedStyle(iframe).pointerEvents : null,
      previewCatcherPointerEvents: previewCatcher ? getComputedStyle(previewCatcher).pointerEvents : null,
    };
  });
  expect(activeResizeStyles).toEqual({
    nodeTransitionProperty: 'box-shadow',
    iframePointerEvents: 'none',
    previewCatcherPointerEvents: 'none',
  });
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

test('MCP App fullscreen dimensions settle after layout and edits persist (#62)', async ({ page, request }) => {
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
  // #62: expansion must deliver the post-layout fullscreen dimensions, not the
  // stale inline frame size that caused hosted apps to clip reflowed text.
  await expect.poll(async () => {
    const iframeBox = await panel.locator('iframe').boundingBox();
    const reported = await frame.locator('#host-dimensions').evaluate((element) => ({
      width: Number(element.getAttribute('data-width')),
      height: Number(element.getAttribute('data-height')),
    }));
    if (!iframeBox) return Number.POSITIVE_INFINITY;
    return Math.max(
      Math.abs(reported.width - iframeBox.width),
      Math.abs(reported.height - iframeBox.height),
    );
  }).toBeLessThan(4);
  const reportedFullscreenHeight = Number(await frame.locator('#host-dimensions').getAttribute('data-height'));
  expect(reportedFullscreenHeight).toBeGreaterThan(600);
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

test('graph nodes content-fit to a stable size across expand and close', async ({ page, request }) => {
  // Created at nodeHeight 380, but the chart + title need more than that — content-fit
  // grows the node (grow-only) so nothing clips ("nodes = size of content"). Width is
  // the stable lever (stays 480); the explicit nodeHeight is a floor, not a cap.
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
  const fetchSize = async () => {
    const response = await request.get(`/api/canvas/node/${created.id}`);
    return (await response.json() as { size: { width: number; height: number } }).size;
  };

  await request.post('/api/canvas/viewport', { data: { x: 0, y: 0, scale: 1 } });
  await page.goto('/workbench');

  const graphNode = page.locator('.canvas-node').filter({ hasText: 'Stable graph frame' });
  await expect(graphNode).toHaveCount(1);
  await expect(graphNode.frameLocator('iframe').locator('.recharts-responsive-container')).toBeVisible();

  // Content-fit grows the height past the requested floor; width stays explicit.
  await expect.poll(fetchSize).toMatchObject({ width: 480 });
  await expect.poll(async () => (await fetchSize()).height).toBeGreaterThan(380);
  const fit = await fetchSize();
  const before = await graphNode.boundingBox();
  expect(before?.width).toBeCloseTo(480, 0);
  expect(before?.height).toBeCloseTo(fit.height, 0);

  await graphNode.getByTitle('Expand (focus mode)').click();
  await expect(page.locator('.expanded-overlay-panel')).toBeVisible();
  await page.getByTitle('Close (Esc)').click();
  await expect(page.locator('.expanded-overlay-panel')).toHaveCount(0);

  // Returns to the same content-fit size — stable, no drift on re-fit (grow-only +
  // a stable intrinsic chart height converge to the same value).
  await expect.poll(async () => {
    const size = await fetchSize();
    return `${size.width}x${size.height}`;
  }).toBe(`480x${fit.height}`);
  await expect.poll(async () => {
    const box = await graphNode.boundingBox();
    return box ? `${Math.round(box.width)}x${Math.round(box.height)}` : '';
  }).toBe(`480x${Math.round(fit.height)}`);
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

test('#65: standalone graph surfaces fill and resize with the browser viewport', async ({ page, request }) => {
  const createResponse = await request.post('/api/canvas/graph', {
    data: {
      title: 'Standalone graph fill guard',
      graphType: 'bar',
      data: [
        { label: 'Small', value: 24 },
        { label: 'Large', value: 91 },
      ],
      xKey: 'label',
      yKey: 'value',
      width: 480,
      nodeHeight: 380,
      height: 240,
    },
  });
  const created = await createResponse.json() as { id: string };

  await page.setViewportSize({ width: 1100, height: 780 });
  await page.goto(`/api/canvas/surface/${created.id}`);
  const chart = page.locator('.recharts-surface');
  await expect(chart).toBeVisible();

  const readMetrics = () => chart.evaluate((surface) => {
    const rect = surface.getBoundingClientRect();
    return {
      surfaceHeight: rect.height,
      viewportHeight: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });

  await expect.poll(async () => (await readMetrics()).surfaceHeight).toBeGreaterThan(520);
  const large = await readMetrics();
  expect(large.surfaceHeight).toBeGreaterThan(large.viewportHeight * 0.7);
  expect(large.scrollHeight).toBeLessThanOrEqual(large.viewportHeight + 1);

  await page.setViewportSize({ width: 900, height: 600 });
  await expect.poll(async () => (await readMetrics()).surfaceHeight).toBeLessThan(large.surfaceHeight - 100);
  const small = await readMetrics();
  expect(small.surfaceHeight).toBeGreaterThan(small.viewportHeight * 0.7);
  expect(small.scrollHeight).toBeLessThanOrEqual(small.viewportHeight + 1);
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
  // The arrange-lock item was renamed off the word "Pin" (report #63) to disambiguate
  // it from context pinning; it still toggles node.pinned (now also persisted).
  await page.locator('.context-menu-item').filter({ hasText: 'Lock position' }).click();

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
  // Switch to light theme through the real toolbar control so the choice is
  // persisted server-side. A raw setAttribute('data-theme','light') is not
  // persisted, so a later SSE round-trip (e.g. the pin below now also flips
  // the node's effective pinned flag) would re-apply the server's stored
  // theme and clobber it — flaking this assertion.
  await page.getByLabel('Switch to light theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

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

test('theme selection persists for fresh browser sessions', async ({ page, request, context }) => {
  await page.goto('/workbench');
  await page.getByLabel('Switch to light theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await expect.poll(async () => {
    const response = await request.get('/api/canvas/theme');
    const body = await response.json() as { theme?: string };
    return body.theme;
  }).toBe('light');

  const secondPage = await context.newPage();
  await secondPage.goto('/workbench');
  await expect(secondPage.locator('html')).toHaveAttribute('data-theme', 'light');
  await secondPage.close();

  await page.getByLabel('Switch to dark theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await expect.poll(async () => {
    const response = await request.get('/api/canvas/theme');
    const body = await response.json() as { theme?: string };
    return body.theme;
  }).toBe('dark');

  const thirdPage = await context.newPage();
  await thirdPage.goto('/workbench');
  await expect(thirdPage.locator('html')).toHaveAttribute('data-theme', 'dark');
  await thirdPage.close();
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

test('ghost intents are interactive, reconnect-safe, vetoable, and settle into linked mutations', async ({ page, request }) => {
  await page.goto('/workbench');

  await request.post('/api/canvas/ax/intent', {
    data: {
      id: 'e2e-veto-intent',
      kind: 'create',
      position: { x: 160, y: 140 },
      nodeType: 'markdown',
      label: 'Blocked note',
      reason: 'prove veto enforcement',
      ttlMs: 60_000,
    },
  });

  const vetoGhost = page.locator('[data-intent-id="e2e-veto-intent"]');
  const vetoButton = vetoGhost.getByRole('button', { name: 'Veto this move' });
  await expect(vetoButton).toBeVisible();
  expect(await vetoButton.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit === button || button.contains(hit);
  })).toBe(true);

  await vetoButton.click();
  await expect(vetoGhost).toHaveCount(0);
  await expect.poll(async () => {
    const response = await request.get('/api/canvas/ax/timeline?limit=20');
    const timeline = await response.json() as {
      summary?: { pendingSteering?: Array<{ message?: string }> };
    };
    return timeline.summary?.pendingSteering?.some((item) => item.message?.includes('Blocked note')) ?? false;
  }).toBe(true);

  const blockedMutation = await request.post('/api/canvas/node', {
    data: {
      intentId: 'e2e-veto-intent',
      type: 'markdown',
      title: 'Must not exist',
    },
  });
  expect(blockedMutation.status()).toBe(409);
  expect(await blockedMutation.json()).toMatchObject({
    ok: false,
    error: 'Intent "e2e-veto-intent" was vetoed.',
  });

  await request.post('/api/canvas/ax/intent', {
    data: {
      id: 'e2e-settle-intent',
      kind: 'create',
      position: { x: 100, y: 100 },
      nodeType: 'markdown',
      label: 'Reconnect and settle',
      ttlMs: 60_000,
    },
  });
  const settleGhost = page.locator('[data-intent-id="e2e-settle-intent"]');
  await expect(settleGhost).toBeVisible();

  await page.reload();
  await expect(settleGhost).toBeVisible();

  const settleObservation = page.evaluate(() => new Promise<{
    positionDelta: number;
    sizeDelta: number;
  }>((resolve) => {
    let bestPositionDelta = Number.POSITIVE_INFINITY;
    let bestSizeDelta = Number.POSITIVE_INFINITY;
    const startedAt = Date.now();
    const sample = () => {
      const ghost = document.querySelector('[data-intent-id="e2e-settle-intent"].is-settling');
      const node = Array.from(document.querySelectorAll('.canvas-node')).find(
        (candidate) => candidate.querySelector('.node-title')?.textContent === 'Settled through intent',
      );
      if (ghost && node) {
        const ghostRect = ghost.getBoundingClientRect();
        const nodeRect = node.getBoundingClientRect();
        bestPositionDelta = Math.min(
          bestPositionDelta,
          Math.abs(ghostRect.x - nodeRect.x) + Math.abs(ghostRect.y - nodeRect.y),
        );
        bestSizeDelta = Math.min(
          bestSizeDelta,
          Math.abs(ghostRect.width - nodeRect.width) + Math.abs(ghostRect.height - nodeRect.height),
        );
      }
      if ((!ghost && Number.isFinite(bestPositionDelta)) || Date.now() - startedAt > 1000) {
        resolve({ positionDelta: bestPositionDelta, sizeDelta: bestSizeDelta });
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));

  const committed = await request.post('/api/canvas/node', {
    data: {
      intentId: 'e2e-settle-intent',
      type: 'markdown',
      title: 'Settled through intent',
      content: 'The ghost should morph here.',
      x: 640,
      y: 380,
      width: 420,
      height: 260,
    },
  });
  expect(committed.ok()).toBe(true);

  const observed = await settleObservation;
  expect(observed.positionDelta).toBeLessThan(16);
  expect(observed.sizeDelta).toBeLessThan(24);
  await expect(settleGhost).toHaveCount(0);
});
