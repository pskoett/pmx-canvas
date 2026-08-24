import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const playwrightPort = Number(process.env.PMX_PLAYWRIGHT_PORT ?? '4517');

function toolbarTooltip(button: Locator): Locator {
  return button.locator('xpath=following-sibling::*[contains(@class,"toolbar-tooltip")]');
}

async function tooltipOpacity(button: Locator): Promise<number> {
  const tooltip = toolbarTooltip(button);
  return await tooltip.evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity));
}

async function clearSnapshots(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/canvas/snapshots?all=true');
  const snapshots = (await response.json()) as Array<{ id: string }>;
  for (const snapshot of snapshots) {
    await request.delete(`/api/canvas/snapshots/${snapshot.id}`);
  }
}

/** Pick a theme through the real toolbar control (the 0.4.x theme picker menu). */
async function selectTheme(page: Page, themeLabel: string): Promise<void> {
  await page.getByRole('button', { name: 'Choose theme' }).click();
  await page.locator('.toolbar-menu').getByRole('menuitemradio', { name: themeLabel }).click();
}

/** Pick an annotation tool through the rail's Annotate popover. */
async function pickAnnotateTool(page: Page, itemLabel: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Annotate (A)' }).click();
  await page.locator('.toolbar-menu').getByRole('button', { name: itemLabel }).click();
}

async function clearCanvas(request: APIRequestContext): Promise<void> {
  // Reset as the workbench: a scope fence left by a prior test refuses agent
  // board-wide writes, and an attached session left behind (presence is
  // in-memory, TTL-swept) would make the next test's board not quiet.
  const presence = (await (await request.get('/api/canvas/ax/presence')).json()) as {
    presences: Array<{ source: string; agentId: string | null; attached: boolean }>;
  };
  for (const entry of presence.presences.filter((p) => p.attached)) {
    await request.post('/api/canvas/ax/presence', {
      data: { source: entry.source, agentId: entry.agentId, attached: false },
      headers: { 'x-pmx-workbench': '1' },
    });
  }
  await request.post('/api/canvas/ax/policy', { data: { scope: null }, headers: { 'x-pmx-workbench': '1' } });
  await request.post('/api/canvas/clear', { headers: { 'x-pmx-workbench': '1' } });
  await request.post('/api/canvas/context-pins', { data: { nodeIds: [] }, headers: { 'x-pmx-workbench': '1' } });
  await request.post('/api/canvas/theme', { data: { theme: 'dark' }, headers: { 'x-pmx-workbench': '1' } });
}

async function currentCanvasState(request: APIRequestContext): Promise<{
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
  return (await response.json()) as {
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
  const mcpFrame = (await mcpFrameResponse.json()) as { url: string };

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
  const webpageFrame = (await webpageFrameResponse.json()) as { url: string };
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

  await expect
    .poll(async () => {
      const state = await currentCanvasState(request);
      return state.nodes.map((node) => node.type).sort();
    })
    .toEqual([
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
  // Docking is explicit (0.4.6 orb feedback #1): a created context node renders
  // ON THE CANVAS, not as an invisible HUD pill. This is the regression guard —
  // the old auto-dock made agent-created context nodes exist in the API, pass
  // validation, and never appear, with edges to them trailing into empty space.
  await expect(node('All Types Context')).toBeVisible();
  await expect(node('All Types Context')).toContainText('Context renderer card');
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
  await expect(node('All Types Group')).toContainText('Drop nodes here');

  await expect(
    node('All Types HTML').frameLocator('iframe').getByRole('heading', { name: 'HTML Renderer' }),
  ).toBeVisible();
  await expect(
    node('All Types MCP App').frameLocator('iframe').getByRole('heading', { name: 'MCP App Renderer' }),
  ).toBeVisible();
  await expect(
    node('All Types JSON Render').frameLocator('iframe').getByText('JSON Renderer Card', { exact: true }),
  ).toBeVisible();
  await expect(node('All Types Graph').frameLocator('iframe').locator('.recharts-responsive-container')).toBeVisible();
});

test('creates a markdown note from the canvas background', async ({ page, request }) => {
  await page.goto('/workbench');

  await expect(page.locator('.empty-state')).toBeVisible();

  await page.mouse.dblclick(1180, 360);

  const note = page.locator('.canvas-node').filter({ hasText: 'New note' });
  await expect(note).toHaveCount(1);
  await expect(page.locator('.empty-state')).toBeHidden();

  await expect
    .poll(async () => {
      const state = await currentCanvasState(request);
      return state.nodes.filter((node) => node.type === 'markdown' && node.data.title === 'New note').length;
    })
    .toBe(1);
});

test('rail and keyboard creates land in the current viewport, not at the board origin', async ({ page, request }) => {
  // A busy board whose free space is far from where the human is looking: the
  // server's auto-placement would put the new node off-screen.
  for (let i = 0; i < 6; i++) {
    await request.post('/api/canvas/node', {
      data: {
        type: 'markdown',
        title: `Filler ${i}`,
        content: 'f',
        x: (i % 3) * 420,
        y: Math.floor(i / 3) * 300,
        width: 380,
        height: 260,
      },
    });
  }
  // Pan the human far away from the filler.
  await request.post('/api/canvas/viewport', { data: { x: -4000, y: -3000, scale: 0.8 } });
  await page.goto('/workbench');
  await expect(page.locator('.canvas-node')).toHaveCount(6);

  const inRegion = async (title: string) => {
    const card = page.locator('.canvas-node').filter({ hasText: title }).first();
    await expect(card).toHaveCount(1);
    const box = (await card.boundingBox())!;
    const region = (await page.locator('.canvas-region').boundingBox())!;
    return (
      box.x >= region.x &&
      box.y >= region.y &&
      box.x + box.width <= region.x + region.width &&
      box.y + box.height <= region.y + region.height
    );
  };

  await page.getByRole('button', { name: 'Group (G)' }).click();
  expect(await inRegion('Group')).toBe(true);
  await page.keyboard.press('m');
  expect(await inRegion('New note')).toBe(true);
});

test('Shift+F / W / I open the in-canvas prompt (window.prompt is a no-op in embedded panes) and create the node', async ({
  page,
  request,
}) => {
  await page.goto('/workbench');
  await page.locator('[data-testid="empty-state"]').waitFor();
  // Shift+F → file node by workspace path.
  await page.keyboard.press('Shift+F');
  const prompt = page.locator('[data-testid="text-prompt"]');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Workspace file path');
  // Drive the input directly — autofocus is for humans, not a test dependency.
  await prompt.locator('input').fill('src/shared/themes.ts');
  await prompt.locator('input').press('Enter');
  await expect(prompt).toBeHidden();
  await expect(page.locator('.canvas-node[data-node-type="file"]')).toHaveCount(1);
  await expect
    .poll(async () => {
      const state = (await (await request.get('/api/canvas/state')).json()) as {
        nodes: Array<{ type: string; data: Record<string, unknown> }>;
      };
      return (
        state.nodes.find((node) => node.type === 'file')?.data.path ??
        state.nodes.find((node) => node.type === 'file')?.data.content
      );
    })
    .toContain('src/shared/themes.ts');

  // W opens it too; Esc cancels without creating.
  await page.keyboard.press('w');
  await expect(prompt).toContainText('Page URL');
  await page.keyboard.press('Escape');
  await expect(prompt).toBeHidden();
  // I opens the image prompt; backdrop click cancels.
  await page.keyboard.press('i');
  await expect(prompt).toContainText('Image URL');
  await page.locator('.text-prompt-backdrop').click({ position: { x: 10, y: 10 } });
  await expect(prompt).toBeHidden();
});

test('right-click Delete: a node deletes; a frame deletes with its children staying', async ({ page, request }) => {
  const a = (await (
    await request.post('/api/canvas/node', {
      data: { type: 'markdown', title: 'Doomed', content: 'x', x: 200, y: 160, width: 260, height: 140 },
    })
  ).json()) as { id: string };
  const b = (await (
    await request.post('/api/canvas/node', {
      data: { type: 'markdown', title: 'Member', content: 'y', x: 640, y: 160, width: 260, height: 140 },
    })
  ).json()) as { id: string };
  const frame = (await (
    await request.post('/api/canvas/group', { data: { title: 'Doomed frame', childIds: [b.id] } })
  ).json()) as { id: string };
  await page.goto('/workbench');
  await page.keyboard.press('f');

  const node = page.locator('.canvas-node').filter({ hasText: 'Doomed' }).filter({ hasNotText: 'frame' }).first();
  await node.click({ button: 'right', position: { x: 80, y: 60 } });
  const menu = page.locator('.context-menu');
  await expect(menu.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  await menu.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.canvas-node').filter({ hasText: 'Doomed' }).filter({ hasNotText: 'frame' })).toHaveCount(
    0,
  );

  // A member leaves its frame from the context menu (the drag-out gesture's discoverable twin).
  const member = page.locator('.canvas-node').filter({ hasText: 'Member' }).first();
  await member.click({ button: 'right', position: { x: 80, y: 60 } });
  await menu.getByRole('button', { name: 'Remove from “Doomed frame”' }).click();
  await expect
    .poll(async () => {
      const state = (await (await request.get(`/api/canvas/node/${b.id}`)).json()) as { data: Record<string, unknown> };
      return state.data.parentGroup ?? null;
    })
    .toBeNull();
  await expect(page.locator('.canvas-node').filter({ hasText: 'Member' })).toHaveCount(1);

  // The group frame: right-click its edge row → an honest "Delete frame (children stay)".
  await page
    .locator('.canvas-node.group-node')
    .filter({ hasText: 'Doomed frame' })
    .locator('.group-edge-row')
    .click({ button: 'right', position: { x: 200, y: 6 } });
  await menu.getByRole('button', { name: 'Delete frame (children stay)' }).click();
  await expect(page.locator('.canvas-node.group-node')).toHaveCount(0);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Member' })).toHaveCount(1);
  expect(
    ((await (await request.get(`/api/canvas/node/${b.id}`)).json()) as { data: Record<string, unknown> }).data
      .parentGroup,
  ).toBeUndefined();
});

test('#J: the empty state yields to a live ghost intent so the cursor is visible on an empty board', async ({
  page,
  request,
}) => {
  await page.goto('/workbench');
  // Empty board → the empty state is shown.
  await expect(page.locator('.empty-state')).toBeVisible();

  // A ghost intent on the empty board must be visible, not occluded by the card
  // (Finding J): the card is suppressed while a ghost is animating.
  await request.post('/api/canvas/ax/intent', {
    data: {
      id: 'e2e-j-ghost',
      kind: 'create',
      position: { x: 400, y: 300 },
      label: 'Add status dashboard',
      reason: 'about to scaffold',
      confidence: 0.8,
      ttlMs: 60000,
    },
  });
  await expect(page.locator('[data-intent-id="e2e-j-ghost"]')).toBeVisible();
  await expect(page.locator('.empty-state')).toBeHidden();

  // Clearing the intent on a still-empty board restores the empty state.
  await request.delete('/api/canvas/ax/intent/e2e-j-ghost', { data: {} });
  await expect(page.locator('[data-intent-id="e2e-j-ghost"]')).toHaveCount(0);
  await expect(page.locator('.empty-state')).toBeVisible();
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

  await expect
    .poll(async () => {
      const state = await currentCanvasState(request);
      return state.nodes.filter((node) => node.type === 'markdown' && node.data.title === 'New note').length;
    })
    .toBe(1);
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
  const created = (await createResponse.json()) as { id: string };

  await page.goto('/workbench');

  const seededNode = page.locator('.canvas-node').filter({ hasText: 'Seeded note' });
  await expect(seededNode).toHaveCount(1);
  await seededNode.locator('.ctx-pin-btn').click();

  await expect(page.locator('.context-pin-bar')).toContainText('1 node in context');
  await expect
    .poll(async () => {
      const response = await request.get('/api/canvas/pinned-context');
      const pinned = (await response.json()) as { count: number; nodeIds: string[] };
      return `${pinned.count}:${pinned.nodeIds.join(',')}`;
    })
    .toBe(`1:${created.id}`);
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
  const child = (await childResponse.json()) as { id: string };

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
  const group = (await groupResponse.json()) as { id: string };

  await page.goto('/workbench');

  const groupNode = page.locator('.canvas-node.group-node').filter({ hasText: 'Snap Group' });
  const childNode = page.locator('.canvas-node:not(.group-node)').filter({ hasText: 'Snap child' });

  await dragNodeTitlebar(page, groupNode, 36, 0);

  await expect
    .poll(async () => {
      const state = await currentCanvasState(request);
      const nextGroup = state.nodes.find((node) => node.id === group.id);
      const nextChild = state.nodes.find((node) => node.id === child.id);
      return JSON.stringify({
        groupX: nextGroup?.position.x,
        childX: nextChild?.position.x,
      });
    })
    .toBe(
      JSON.stringify({
        groupX: 316,
        childX: 356,
      }),
    );
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
  const child = (await childResponse.json()) as { id: string };

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

  await expect
    .poll(async () => {
      const state = await currentCanvasState(request);
      const nextChild = state.nodes.find((node) => node.id === child.id);
      return nextChild?.position.x;
    })
    .toBe(284);
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
  await expect
    .poll(async () => page.locator('html').evaluate((html) => html.classList.contains('is-node-dragging')))
    .toBe(true);
  await expect(page.locator('[data-test-attention-field="true"]')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('html')).toHaveCSS('user-select', 'none');
  await expect.poll(async () => page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');

  await page.mouse.move(startX + 80, startY + 50, { steps: 6 });
  await expect.poll(async () => page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  await page.mouse.up();
  await expect
    .poll(async () => page.locator('html').evaluate((html) => html.classList.contains('is-node-dragging')))
    .toBe(false);
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
  const created = (await createResponse.json()) as { id: string };

  await page.goto('/workbench');

  const seededNode = page.locator('.canvas-node').filter({ hasText: 'Roundtrip seed' });
  await expect(seededNode).toHaveCount(1);

  await seededNode.locator('.ctx-pin-btn').click();
  await expect(page.locator('.context-pin-bar')).toContainText('1 node in context');

  await expect
    .poll(async () => {
      const response = await request.get('/api/canvas/pinned-context');
      const pinned = (await response.json()) as { count: number; nodeIds: string[] };
      return `${pinned.count}:${pinned.nodeIds.join(',')}`;
    })
    .toBe(`1:${created.id}`);

  const agentCreateResponse = await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Agent reply node',
      content: `Derived from ${created.id}`,
      x: 980,
      y: 260,
    },
  });
  const agentCreated = (await agentCreateResponse.json()) as { id: string };

  const agentNode = page.locator('.canvas-node').filter({ hasText: 'Agent reply node' });
  await expect(agentNode).toHaveCount(1);

  await expect
    .poll(async () => {
      const state = await currentCanvasState(request);
      return state.nodes.some((node) => node.id === agentCreated.id && node.data.title === 'Agent reply node');
    })
    .toBe(true);

  await expect
    .poll(async () => {
      const response = await request.get('/api/canvas/pinned-context');
      const pinned = (await response.json()) as { count: number; nodeIds: string[] };
      return `${pinned.count}:${pinned.nodeIds.join(',')}`;
    })
    .toBe(`1:${created.id}`);
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
  const batch = (await batchResponse.json()) as {
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
  const searchBody = (await search.json()) as { results: Array<{ id: string; title?: string }> };
  expect(searchBody.results.map((result) => result.id)).toContain(batch.refs.alpha.id);

  const pinned = await request.get('/api/canvas/pinned-context');
  const pinnedBody = (await pinned.json()) as { count: number; nodeIds: string[] };
  expect(pinnedBody.count).toBe(1);
  expect(pinnedBody.nodeIds).toEqual([batch.refs.alpha.id]);

  const spatial = await request.get('/api/canvas/spatial-context');
  const spatialBody = (await spatial.json()) as {
    pinnedNeighborhoods?: Array<{ pinnedNodeId: string; nearbyNodes?: Array<{ id: string }> }>;
  };
  expect(spatialBody.pinnedNeighborhoods?.some((entry) => entry.pinnedNodeId === batch.refs.alpha.id)).toBe(true);

  const axFocus = await request.post('/api/canvas/ax/focus', {
    data: { nodeIds: [batch.refs.beta.id], source: 'codex' },
  });
  expect(axFocus.ok()).toBe(true);
  await expect
    .poll(async () => {
      const ax = await request.get('/api/canvas/ax');
      const body = (await ax.json()) as { state?: { focus?: { nodeIds?: string[]; source?: string } } };
      return {
        nodeIds: body.state?.focus?.nodeIds,
        source: body.state?.focus?.source,
      };
    })
    .toEqual({ nodeIds: [batch.refs.beta.id], source: 'codex' });

  await request.post('/api/canvas/focus', {
    data: { id: batch.refs.beta.id },
  });
  await expect(betaNode).toHaveClass(/active/);

  const beforeArrange = await currentCanvasState(request);
  const beforeAlpha = beforeArrange.nodes.find((node) => node.id === batch.refs.alpha.id)?.position;
  await request.post('/api/canvas/arrange', { data: { layout: 'column' } });
  await expect
    .poll(async () => {
      const state = await currentCanvasState(request);
      const alpha = state.nodes.find((node) => node.id === batch.refs.alpha.id);
      return alpha?.position;
    })
    .not.toEqual(beforeAlpha);

  const fitResponse = await request.post('/api/canvas/fit', {
    data: { nodeIds: [batch.refs.alpha.id, batch.refs.beta.id], width: 1440, height: 900, padding: 80 },
  });
  expect(fitResponse.ok()).toBe(true);
  await expect
    .poll(async () => {
      const state = await currentCanvasState(request);
      return state.nodes.length;
    })
    .toBe(2);

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
  const gamma = (await gammaResponse.json()) as { id: string };
  await expect(page.locator('.canvas-node').filter({ hasText: 'Workflow Gamma' })).toHaveCount(1);

  const diffResponse = await request.get(`/api/canvas/snapshots/${batch.refs.baseline.snapshot.id}/diff`);
  const diff = (await diffResponse.json()) as { text: string };
  expect(diff.text).toContain('Workflow Gamma');

  const undoResponse = await request.post('/api/canvas/undo');
  expect(undoResponse.ok()).toBe(true);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Workflow Gamma' })).toHaveCount(0);
  await expect
    .poll(async () => {
      const state = await currentCanvasState(request);
      return state.nodes.some((node) => node.id === gamma.id);
    })
    .toBe(false);

  const redoResponse = await request.post('/api/canvas/redo');
  expect(redoResponse.ok()).toBe(true);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Workflow Gamma' })).toHaveCount(1);

  const historyResponse = await request.get('/api/canvas/history');
  const history = (await historyResponse.json()) as { canUndo: boolean; entries: unknown[]; text: string };
  expect(history.canUndo).toBe(true);
  expect(history.entries.length).toBeGreaterThan(0);
  expect(history.text).toContain('Added markdown node');

  const validateResponse = await request.get('/api/canvas/validate');
  const validation = (await validateResponse.json()) as { ok: boolean };
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
  const authNode = (await authResponse.json()) as { id: string };

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
  await expect(htmlNode).toHaveAttribute('data-node-type', 'html');
  await expect(htmlNode.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(htmlNode.locator('iframe')).not.toHaveAttribute('sandbox', /allow-same-origin/);
  await expect(htmlNode.frameLocator('iframe').getByText('HTML render sentinel')).toBeVisible();

  await htmlNode.getByTitle('Expand (focus mode)').click();
  const overlay = page.locator('.expanded-overlay-panel');
  await expect(overlay).toBeVisible();
  await expect(overlay.getByRole('button', { name: 'Present' })).toHaveCount(0);
  await expect(overlay.getByRole('button', { name: 'Open in tab ↗' })).toHaveCount(1);
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

  // Contract (0.4.2 semantics): "Open as site" FIRST asks the server to open
  // the user's system browser via /api/canvas/open-external. This suite runs
  // with PMX_CANVAS_DISABLE_BROWSER_OPEN=1, so the server reports opened:false
  // and the documented window.open fallback produces the popup we assert on.
  // (In a normal run the system browser opens and no Playwright page appears.)
  const openExternalRequest = page.waitForResponse('**/api/canvas/open-external');
  const popupPromise = context.waitForEvent('page');
  await openButton.click();
  const openExternal = await openExternalRequest;
  const openExternalBody = (await openExternal.json()) as { opened?: boolean };
  expect(openExternalBody.opened).toBe(false);
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
      html: "<main><h1>Bridge</h1><button onclick=\"window.PMX_AX.emit('ax.work.create', { title: 'from-html-bridge' })\">emit</button></main>",
      data: { axCapabilities: { enabled: true, allowed: ['ax.work.create'] } },
      x: 640,
      y: 260,
      width: 520,
      height: 360,
    },
  });
  await page.goto('/workbench');
  const node = page.locator('.canvas-node').filter({ hasText: 'AX bridge html' });
  await expect(node).toHaveCount(1);
  await node.frameLocator('iframe').getByRole('button', { name: 'emit' }).click();

  await expect
    .poll(async () => {
      const ax = await request.get('/api/canvas/ax');
      const body = (await ax.json()) as { state?: { workItems?: Array<{ title: string }> } };
      return (body.state?.workItems ?? []).some((w) => w.title === 'from-html-bridge');
    })
    .toBe(true);
});

test('html bridge: window.PMX_AX.emit resolves with the result so the surface can self-confirm (#55)', async ({
  page,
  request,
}) => {
  // The surface awaits emit() and flips a status label on the ack — the built-in
  // confirmation that fixes "clicks look like nothing happened".
  const html =
    '<main><button onclick="go()">emit</button><span id="st">idle</span>' +
    '<script>async function go(){var r=await window.PMX_AX.emit("ax.work.create",{title:"ack-confirmed"});' +
    'document.getElementById("st").textContent=r&&r.ok?"queued OK":"failed";}</script></main>';
  await request.post('/api/canvas/node', {
    data: {
      type: 'html',
      title: 'AX ack html',
      html,
      data: { axCapabilities: { enabled: true, allowed: ['ax.work.create'] } },
      x: 640,
      y: 260,
      width: 520,
      height: 360,
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

test('ext-app bridge: window.PMX_AX.emit resolves with the result so the app can self-confirm (#55)', async ({
  page,
  request,
}) => {
  const html =
    '<main><button onclick="go()">emit</button><span id="st">idle</span>' +
    '<script>async function go(){var r=await window.PMX_AX.emit("ax.work.create",{title:"ack-confirmed-ext-app"});' +
    'document.getElementById("st").textContent=r&&r.ok?"queued OK":"failed";}</script></main>';
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
      x: 640,
      y: 260,
      width: 520,
      height: 360,
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
      x: 360,
      y: 200,
      width: 480,
      height: 320,
    },
  });
  const id = ((await created.json()) as { id: string }).id;
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

test('#63: node context menu pins to the human-curated context set (primary "Pin as context")', async ({
  page,
  request,
}) => {
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
    data: {
      type: 'status',
      title: 'Removable status',
      data: { title: 'Removable status', status: 'success', message: 'done' },
      x: 360,
      y: 220,
    },
  });
  await page.goto('/workbench');
  const node = page.locator('.canvas-node').filter({ hasText: 'Removable status' });
  await expect(node).toHaveCount(1);

  const closeBtn = node.locator('.node-titlebar').getByTitle('Close');
  await expect(closeBtn).toBeVisible();
  await closeBtn.click();
  await expect(node).toHaveCount(0);
});

test('json-render bridge: a spec action named ax.* emits an AX interaction via the viewer', async ({
  page,
  request,
}) => {
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
      x: 640,
      y: 260,
      width: 480,
      height: 320,
    },
  });
  await page.goto('/workbench');
  const node = page.locator('.canvas-node').filter({ hasText: 'AX bridge json-render' });
  await expect(node).toHaveCount(1);
  await node.frameLocator('iframe').getByRole('button', { name: 'emit' }).click();

  await expect
    .poll(async () => {
      const ax = await request.get('/api/canvas/ax');
      const body = (await ax.json()) as { state?: { workItems?: Array<{ title: string }> } };
      return (body.state?.workItems ?? []).some((w) => w.title === 'from-jsonrender-bridge');
    })
    .toBe(true);
});

test('AX read path: an AX-enabled html board reflects live AX state (window.PMX_AX.state + pmx-ax-update)', async ({
  page,
  request,
}) => {
  // A board that renders the live work-item count from the read-side bridge.
  const html =
    '<div id="c">init</div><script>' +
    'function r(s){document.getElementById("c").textContent="work:"+((s&&s.workItems)?s.workItems.length:0);}' +
    'r(window.PMX_AX&&window.PMX_AX.state);' +
    'window.addEventListener("pmx-ax-update",function(e){r(e.detail);});' +
    '</script>';
  const created = await request.post('/api/canvas/node', {
    data: {
      type: 'html',
      title: 'AX read board',
      html,
      data: { axCapabilities: { enabled: true, allowed: ['ax.work.create'] } },
      x: 640,
      y: 260,
      width: 480,
      height: 320,
    },
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

test('ax-board primitive: clicking Add task creates real AX work and the board reflects it', async ({
  page,
  request,
}) => {
  // No axCapabilities in the payload: the ax-board DESCRIPTOR declares them, so the
  // created node is AX-enabled by construction (an html primitive is otherwise inert).
  const created = await request.post('/api/canvas/node', {
    data: {
      type: 'html-primitive',
      kind: 'ax-board',
      title: 'AX board e2e',
      strictSize: true,
      x: 120,
      y: 120,
      width: 900,
      height: 640,
    },
  });
  const nodeId = ((await created.json()) as { id: string }).id;
  const boardNode = (await currentCanvasState(request)).nodes.find((node) => node.id === nodeId);
  expect((boardNode?.data.axCapabilities as { enabled?: boolean } | undefined)?.enabled).toBe(true);

  await page.goto('/workbench');
  const node = page.locator('.canvas-node').filter({ hasText: 'AX board e2e' });
  await expect(node).toHaveCount(1);
  const frame = node.frameLocator('iframe');
  await expect(frame.locator('#ax-work-list')).toContainText('No work items yet');

  // Drive the REAL controls — type into the real input, click the real button.
  await frame.locator('#ax-task-title').fill('e2e board task');
  await frame.getByRole('button', { name: 'Add task' }).click();

  // The click produced real AX state on the server (documented read route).
  await expect
    .poll(async () => {
      const work = await request.get('/api/canvas/ax/work');
      const body = (await work.json()) as { workItems?: Array<{ title: string; status: string }> };
      return (body.workItems ?? []).find((item) => item.title === 'e2e board task')?.status;
    })
    .toBe('todo');

  // ...and the panel renders it from the live AX push, not from local optimism.
  const row = frame.locator('.ax-work-row').filter({ hasText: 'e2e board task' });
  await expect(row).toHaveCount(1);
  await expect(row.locator('.badge')).toHaveText('todo');
  await expect(frame.locator('#ax-work-list')).not.toContainText('No work items yet');

  // Per-row status control advances the same work item through ax.work.update.
  await row.locator('select').selectOption('in-progress');
  await expect
    .poll(async () => {
      const work = await request.get('/api/canvas/ax/work');
      const body = (await work.json()) as { workItems?: Array<{ title: string; status: string }> };
      return (body.workItems ?? []).find((item) => item.title === 'e2e board task')?.status;
    })
    .toBe('in-progress');
  await expect(row.locator('.badge')).toHaveText('in-progress');

  await request.delete(`/api/canvas/node/${nodeId}`);
  await expect(node).toHaveCount(0);
});

test('ax-board primitive: a bounded loop advances on done, stops on Stop, and never double-advances', async ({
  page,
  request,
}) => {
  const created = await request.post('/api/canvas/node', {
    data: {
      type: 'html-primitive',
      kind: 'ax-board',
      title: 'AX loop e2e',
      strictSize: true,
      x: 120,
      y: 120,
      width: 900,
      height: 640,
    },
  });
  const nodeId = ((await created.json()) as { id: string }).id;

  const workItems = async (): Promise<Array<{ id: string; title: string }>> => {
    const response = await request.get('/api/canvas/ax/work');
    return ((await response.json()) as { workItems?: Array<{ id: string; title: string }> }).workItems ?? [];
  };
  const runsNamed = async (fragment: string): Promise<number> =>
    (await workItems()).filter((item) => item.title.includes(fragment)).length;
  const markDone = async (fragment: string): Promise<void> => {
    const item = (await workItems()).find((entry) => entry.title.includes(fragment));
    await request.patch(`/api/canvas/ax/work/${item?.id}`, { data: { status: 'done' } });
  };

  await page.goto('/workbench');
  const node = page.locator('.canvas-node').filter({ hasText: 'AX loop e2e' });
  await expect(node).toHaveCount(1);
  const frame = node.frameLocator('iframe');
  // A loop NEVER auto-starts: the panel is hidden until the human starts one.
  await expect(frame.locator('#ax-loop-panel')).toBeHidden();

  await frame.locator('#ax-task-title').fill('loop task');
  await frame.locator('#ax-loop-runs').fill('2');
  await frame.getByRole('button', { name: 'Start loop' }).click();
  await expect(frame.locator('#ax-loop-run')).toHaveText('run 1 of 2');
  await expect.poll(async () => await runsNamed('loop task — run 1/2')).toBe(1);

  // The agent finishing run 1 (observed from live AX state) opens run 2 — exactly once.
  await markDone('loop task — run 1/2');
  await expect(frame.locator('#ax-loop-run')).toHaveText('run 2 of 2');
  await expect.poll(async () => await runsNamed('loop task — run 2/2')).toBe(1);
  await page.waitForTimeout(500);
  expect(await runsNamed('loop task — run 2/2')).toBe(1);

  // Stop wins over the cap: finishing run 2 afterwards must not open a run 3.
  await frame.getByRole('button', { name: 'Stop loop' }).click();
  await expect(frame.locator('#ax-loop-panel')).toBeHidden();
  await markDone('loop task — run 2/2');
  await page.waitForTimeout(600);
  expect(await runsNamed('loop task — run 3/2')).toBe(0);

  await request.delete(`/api/canvas/node/${nodeId}`);
});

test('ax-flow primitive: clicking Materialize lays the flow out as real nodes and edges', async ({ page, request }) => {
  // No axCapabilities in the payload: the ax-flow DESCRIPTOR declares them (including
  // ax.flow.materialize), so the created node can emit by construction.
  const created = await request.post('/api/canvas/node', {
    data: {
      type: 'html-primitive',
      kind: 'ax-flow',
      title: 'AX flow e2e',
      strictSize: true,
      data: {
        steps: [{ title: 'Reproduce' }, { title: 'Fix' }, { title: 'Verify' }],
        loop: { enabled: true, maxRuns: 2 },
      },
      x: 120,
      y: 120,
      width: 900,
      height: 700,
    },
  });
  const nodeId = ((await created.json()) as { id: string }).id;

  await page.goto('/workbench');
  const node = page.locator('.canvas-node').filter({ hasText: 'AX flow e2e' });
  await expect(node).toHaveCount(1);
  const frame = node.frameLocator('iframe');
  // The diagram draws every step, with the loop-back rail visible.
  await expect(frame.locator('.ax-flow-step')).toHaveCount(3);
  await expect(frame.locator('.ax-flow-step').first()).toContainText('not queued');
  await expect(frame.locator('#ax-flow-wrap')).toHaveClass(/looping/);

  // Drive the REAL control.
  await frame.getByRole('button', { name: 'Materialize to board' }).click();
  await expect(frame.locator('#ax-flow-materialize-status')).toContainText('3 step nodes on the board');

  // The click produced real canvas state on the server.
  const flowId = `axflow-${nodeId}`;
  await expect
    .poll(async () => (await currentCanvasState(request)).nodes.filter((n) => n.data.axFlowId === flowId).length)
    .toBe(3);
  const state = await currentCanvasState(request);
  const stepNodes = state.nodes
    .filter((n) => n.data.axFlowId === flowId)
    .sort((a, b) => Number(a.data.axFlowStep) - Number(b.data.axFlowStep));
  expect(stepNodes.map((n) => n.type)).toEqual(['markdown', 'markdown', 'markdown']);
  expect(stepNodes.map((n) => n.data.title)).toEqual(['1. Reproduce', '2. Fix', '3. Verify']);
  // Each step node carries its work-item status chip (the existing mirror).
  expect(stepNodes.map((n) => n.data.axWorkStatus)).toEqual(['todo', 'todo', 'todo']);

  const stepIds = stepNodes.map((n) => n.id);
  const flowEdges = state.edges.filter((edge) => edge.type === 'flow');
  expect(flowEdges.map((edge) => [edge.from, edge.to])).toEqual([
    [stepIds[0], stepIds[1]],
    [stepIds[1], stepIds[2]],
  ]);
  const loopEdge = state.edges.find((edge) => edge.type === 'references');
  expect([loopEdge?.from, loopEdge?.to]).toEqual([stepIds[2], stepIds[0]]);

  // The step nodes are on the board, and the panel now shows live status per step.
  await expect(page.locator('.canvas-node').filter({ hasText: '1. Reproduce' })).toHaveCount(1);
  await expect(frame.locator('.ax-flow-step').first()).toContainText('todo');

  // Re-materializing REPLACES rather than duplicating.
  await frame.getByRole('button', { name: 'Materialize to board' }).click();
  await expect(frame.locator('#ax-flow-materialize-status')).toContainText('replaced 3');
  await expect
    .poll(async () => (await currentCanvasState(request)).nodes.filter((n) => n.data.axFlowId === flowId).length)
    .toBe(3);

  for (const id of [nodeId, ...stepIds]) await request.delete(`/api/canvas/node/${id}`);
  await expect(node).toHaveCount(0);
});

test('native step controls on a materialized flow node drive the work item and the loop', async ({ page, request }) => {
  // Materialize a looping flow (the panel's own Materialize button is covered by
  // the ax-flow primitive test above — this one is about the NODES it produces).
  const created = await request.post('/api/canvas/node', {
    data: { type: 'html-primitive', kind: 'ax-flow', title: 'AX native flow e2e', x: 120, y: 120 },
  });
  const panelId = ((await created.json()) as { id: string }).id;
  const materialized = await request.post('/api/canvas/ax/interaction', {
    data: {
      type: 'ax.flow.materialize',
      sourceNodeId: panelId,
      sourceSurface: 'html-node',
      payload: {
        title: 'Native flow',
        steps: [{ title: 'Reproduce' }, { title: 'Fix' }, { title: 'Verify' }],
        loop: { enabled: true, maxRuns: 2 },
      },
    },
  });
  const flow = (await materialized.json()) as {
    primitive: { steps: Array<{ nodeId: string; workItemId: string }> };
  };
  const stepIds = flow.primitive.steps.map((step) => step.nodeId);
  const workIds = flow.primitive.steps.map((step) => step.workItemId);

  const workStatus = async (id: string): Promise<string | undefined> => {
    const response = await request.get('/api/canvas/ax/work');
    const body = (await response.json()) as { workItems?: Array<{ id: string; status: string }> };
    return (body.workItems ?? []).find((item) => item.id === id)?.status;
  };
  const loopRunning = async (): Promise<unknown> => {
    const state = await currentCanvasState(request);
    const anchor = state.nodes.find((n) => n.id === stepIds[0]);
    return (anchor?.data.axFlow as { loop?: { running?: boolean } } | undefined)?.loop?.running;
  };

  await page.goto('/workbench');
  const stepNode = (title: string) => page.locator('.canvas-node').filter({ hasText: title });
  const step1 = stepNode('1. Reproduce');
  await expect(step1).toHaveCount(1);
  await expect(step1.locator('.ax-step-controls')).toHaveCount(1);
  await expect(step1).toContainText('Step 1/3');

  // Drive the REAL native control on the step NODE (not in the panel).
  await step1.getByRole('button', { name: 'Start' }).click();
  await expect.poll(async () => workStatus(workIds[0])).toBe('in-progress');
  // ...and the node's own status chip followed the work item.
  await expect(step1.locator('.node-ax-status')).toHaveText('in-progress');

  await step1.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => workStatus(workIds[0])).toBe('done');
  await expect(step1.locator('.node-ax-status')).toHaveText('done');
  // The loop is idle, so nothing opened step 2 on its own.
  expect(await workStatus(workIds[1])).toBe('todo');

  // Run the loop from the anchor node: it persists on the node and opens the
  // next unfinished step.
  await step1.getByRole('button', { name: 'Run loop' }).click();
  await expect.poll(loopRunning).toBe(true);
  await expect.poll(async () => workStatus(workIds[1])).toBe('in-progress');

  // Completing a step now advances the flow server-side, no panel involved.
  await stepNode('2. Fix').getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => workStatus(workIds[2])).toBe('in-progress');

  // Completing the LAST step closes run 1 and reopens the flow at step 1.
  await stepNode('3. Verify').getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => workStatus(workIds[0])).toBe('in-progress');
  expect(await workStatus(workIds[2])).toBe('todo');

  // Stop is immediate and durable, and the loop no longer advances.
  await step1.getByRole('button', { name: 'Stop' }).click();
  await expect.poll(loopRunning).toBe(false);
  await step1.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => workStatus(workIds[0])).toBe('done');
  expect(await workStatus(workIds[1])).toBe('todo');

  for (const id of [panelId, ...stepIds]) await request.delete(`/api/canvas/node/${id}`);
});

test('file node evidence control records AX evidence', async ({ page, request }) => {
  await request.post('/api/canvas/node', {
    data: { type: 'file', content: 'console.log(1)', data: { path: '/tmp/evidence-file.ts' }, x: 640, y: 260 },
  });
  await page.goto('/workbench');
  const node = page.locator('.canvas-node').filter({ hasText: 'evidence-file.ts' });
  await expect(node).toHaveCount(1);
  await node.getByTitle('Mark this file as AX evidence').click();

  await expect
    .poll(async () => {
      const tl = await request.get('/api/canvas/ax/timeline');
      return JSON.stringify(await tl.json()).includes('evidence-file.ts');
    })
    .toBe(true);
});

test('ledger nodes render content as split log lines without a label or literal newlines', async ({
  page,
  request,
}) => {
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
  await selectTheme(page, 'Light');

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

  await expect
    .poll(async () => {
      const state = await currentCanvasState(request);
      return state.nodes.some((node) => node.type === 'webpage' && node.data.url === 'https://example.com/pasted-url');
    })
    .toBe(true);
});

test('dropping a URL onto the canvas creates a webpage node', async ({ page, request }) => {
  await page.goto('/workbench');

  await page.evaluate(() => {
    const viewport = document.querySelector('.canvas-viewport');
    if (!(viewport instanceof HTMLElement)) throw new Error('Canvas viewport not found');
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', 'https://example.com/dropped-url');
    const rect = viewport.getBoundingClientRect();
    viewport.dispatchEvent(
      new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        dataTransfer,
      }),
    );
    viewport.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        dataTransfer,
      }),
    );
  });

  await expect
    .poll(async () => {
      const state = await currentCanvasState(request);
      return state.nodes.some((node) => node.type === 'webpage' && node.data.url === 'https://example.com/dropped-url');
    })
    .toBe(true);
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
  await expect
    .poll(async () => frame.locator('body').evaluate((body) => body.scrollHeight - body.clientHeight))
    .toBe(0);

  // The widget's auto-resize notifications can make the iframe's reported
  // bounds waver by a pixel across measurements while it settles, which the
  // default click-stability check reads as motion. The button's *logical*
  // position is fine; `force: true` bypasses the stability wait without
  // changing click semantics.
  await frame.getByRole('button', { name: 'Increment' }).click({ force: true });
  await expect(frame.locator('#count')).toHaveText('3');

  await expect
    .poll(
      async () => {
        const state = await currentCanvasState(request);
        const hosted = state.nodes.find((node) => node.type === 'mcp-app' && node.data.title === 'Counter App');
        const appModelContext = hosted?.data.appModelContext as { structuredContent?: { count?: number } } | undefined;
        return appModelContext?.structuredContent?.count ?? null;
      },
      {
        timeout: 15000,
      },
    )
    .toBe(3);

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
  // The minimap floats at the region's bottom-right, where the app-open fit
  // can land this node's corner — hide it so elementFromPoint probes the
  // node's own stacking (what this test is about), not an unrelated overlay.
  await page.getByRole('button', { name: 'Hide minimap' }).click();
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
      previewCatcherLeavesResizeCorner: previewRect
        ? previewRect.right <= nodeRect.right - 48 && previewRect.bottom <= nodeRect.bottom - 48
        : null,
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
  const initialNode = initialState.nodes.find(
    (node) => node.type === 'mcp-app' && node.data.title === 'Resize Handle App',
  );
  if (!initialNode) throw new Error('Resize Handle App node missing from canvas state.');

  // The app-open flow pans/fits the viewport; under full-suite load that
  // animation can still be in flight here, leaving these coordinates stale by
  // mouse-down time (the pointer then misses the resize handle entirely).
  // Interact only once the node's box has held still across two reads.
  let settledBox = await appNode.boundingBox();
  await expect
    .poll(async () => {
      const next = await appNode.boundingBox();
      const stable =
        !!settledBox &&
        !!next &&
        Math.abs(next.x - settledBox.x) < 0.5 &&
        Math.abs(next.y - settledBox.y) < 0.5 &&
        Math.abs(next.width - settledBox.width) < 0.5 &&
        Math.abs(next.height - settledBox.height) < 0.5;
      settledBox = next;
      return stable;
    })
    .toBe(true);
  const box = settledBox;
  if (!box) throw new Error('Resize Handle App node is not visible.');
  await page.mouse.move(box.x + box.width - 8, box.y + box.height - 8);
  await page.mouse.down();
  await expect
    .poll(async () => page.locator('html').evaluate((html) => html.classList.contains('is-node-resizing')))
    .toBe(true);
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
  await expect
    .poll(async () => page.locator('html').evaluate((html) => html.classList.contains('is-node-resizing')))
    .toBe(false);

  await expect
    .poll(async () => {
      const state = await currentCanvasState(request);
      const resized = state.nodes.find((node) => node.type === 'mcp-app' && node.data.title === 'Resize Handle App');
      if (!resized) return false;
      return resized.size.width > initialNode.size.width && resized.size.height > initialNode.size.height;
    })
    .toBe(true);
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
        await panel
          .getByTitle('Close (Esc)')
          .click({ timeout: 2_000 })
          .catch(() => {});
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
  await expect
    .poll(async () => {
      const iframeBox = await panel.locator('iframe').boundingBox();
      const reported = await frame.locator('#host-dimensions').evaluate((element) => ({
        width: Number(element.getAttribute('data-width')),
        height: Number(element.getAttribute('data-height')),
      }));
      if (!iframeBox) return Number.POSITIVE_INFINITY;
      return Math.max(Math.abs(reported.width - iframeBox.width), Math.abs(reported.height - iframeBox.height));
    })
    .toBeLessThan(4);
  const reportedFullscreenHeight = Number(await frame.locator('#host-dimensions').getAttribute('data-height'));
  expect(reportedFullscreenHeight).toBeGreaterThan(600);
  await frame.getByRole('button', { name: 'Add Manual Edit' }).click();
  await expect(frame.getByText('Saved manual edit')).toBeVisible();

  await expect
    .poll(
      async () => {
        const state = await currentCanvasState(request);
        const hosted = state.nodes.find(
          (node) => node.type === 'mcp-app' && node.data.title === 'Persistent Editor App',
        );
        const appModelContext = hosted?.data.appModelContext as { content?: Array<{ text?: string }> } | undefined;
        return appModelContext?.content?.[0]?.text ?? null;
      },
      {
        timeout: 15000,
      },
    )
    .toBe('Saved manual edit');

  await panel.getByTitle('Close (Esc)').click();
  // The same handshake race can hit the reopened iframe, so use the retry
  // helper here too.
  await openFullscreenEditor();
  const reopenedFrame = panel.frameLocator('iframe');
  await expect(reopenedFrame.getByText('Saved manual edit')).toBeVisible();
});

test('task checkboxes tick on the CARD and persist to the node content', async ({ page, request }) => {
  const note = (await (
    await request.post('/api/canvas/node', {
      data: {
        type: 'markdown',
        title: 'Checklist',
        content:
          '- [ ] hover tooltips on a deliberately long task line that wraps within this card\n- [x] ungroup parity\n- [ ] steer loop',
        x: 400,
        y: 200,
        width: 360,
        height: 240,
      },
    })
  ).json()) as { id: string };
  await page.goto('/workbench');
  const card = page.locator('.canvas-node').filter({ hasText: 'Checklist' });
  const boxes = card.locator('input[type="checkbox"]');
  await expect(boxes).toHaveCount(3);
  await expect(boxes.nth(0)).toBeEnabled();

  await boxes.nth(0).click();
  await expect
    .poll(async () => {
      const state = (await (await request.get(`/api/canvas/node/${note.id}`)).json()) as { content?: string };
      return state.content;
    })
    .toBe(
      '- [x] hover tooltips on a deliberately long task line that wraps within this card\n- [x] ungroup parity\n- [ ] steer loop',
    );
  // The re-render keeps it ticked; unticking the second one works too.
  await expect(boxes.nth(0)).toBeChecked();
  // The whole gutter is a target — a click on the row LEFT of the text (not on
  // the 15px input itself) toggles too, for imprecise surfaces.
  const row3 = card.locator('.node-body li').nth(2);
  const rowBox = (await row3.boundingBox())!;
  await page.mouse.click(rowBox.x + 2, rowBox.y + 10);
  await expect
    .poll(async () => {
      const state = (await (await request.get(`/api/canvas/node/${note.id}`)).json()) as { content?: string };
      return state.content?.split('\n')[2];
    })
    .toBe('- [x] steer loop');
  await boxes.nth(1).click();
  await expect
    .poll(async () => {
      const state = (await (await request.get(`/api/canvas/node/${note.id}`)).json()) as { content?: string };
      return state.content;
    })
    .toBe(
      '- [x] hover tooltips on a deliberately long task line that wraps within this card\n- [ ] ungroup parity\n- [x] steer loop',
    );

  // A HUMAN-speed press: pointer down, ~120ms hold, up. The press itself
  // re-renders the node (bring-to-front) — if a re-render rebuilds the
  // markdown DOM, the pressed box is swapped mid-press and no click fires
  // (fast synthetic clicks win that race, which is how it shipped broken).
  const slowTarget = boxes.nth(1);
  const slowBox = (await slowTarget.boundingBox())!;
  await page.mouse.move(slowBox.x + slowBox.width / 2, slowBox.y + slowBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();
  await expect
    .poll(async () => {
      const state = (await (await request.get(`/api/canvas/node/${note.id}`)).json()) as { content?: string };
      return state.content?.split('\n')[1];
    })
    .toBe('- [x] ungroup parity');

  // EXPANDED view: ticking works there too (the property must reach the
  // serialized attribute), and Esc-closing the focused editor must NOT wipe
  // the document via a detached-blur save.
  await card.getByTitle('Expand (focus mode)').click();
  const overlay = page.locator('.expanded-overlay-panel');
  await expect(overlay).toBeVisible();
  const expandedBox = overlay.locator('.md-reader-content input[type="checkbox"]').nth(1);
  await expect(expandedBox).toBeEnabled();
  await expandedBox.click();
  await page.waitForTimeout(1000); // debounced editor save
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  await page.waitForTimeout(600); // any (wrong) unmount save would land here
  const finalContent = ((await (await request.get(`/api/canvas/node/${note.id}`)).json()) as { content?: string })
    .content;
  expect(finalContent).toContain('[ ]  ungroup parity');
  expect(finalContent?.length ?? 0).toBeGreaterThan(60);
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
  const created = (await createResponse.json()) as { id: string };

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

  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/canvas/node/${created.id}`);
        const node = (await response.json()) as { data: Record<string, unknown> };
        return node.data.content;
      },
      {
        timeout: 15000,
      },
    )
    .toBe('Updated paragraph');
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
  await expect
    .poll(async () => {
      const response = await request.get('/api/canvas/snapshots');
      const snapshots = (await response.json()) as Array<{ name: string }>;
      return snapshots.map((snapshot) => snapshot.name).join(',');
    })
    .toContain('Toolbar snapshot');
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
  const created = (await createResponse.json()) as { id: string };

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
  const preConfirmNode = (await preConfirm.json()) as { data: Record<string, unknown> };
  expect(preConfirmNode.data.title).toBe('Mutated title');

  await snapshotItem.getByRole('button', { name: 'Confirm' }).click();

  await expect
    .poll(async () => {
      const response = await request.get(`/api/canvas/node/${created.id}`);
      const node = (await response.json()) as { data: Record<string, unknown> };
      return node.data.title;
    })
    .toBe('Restore target');
});

test('toolbar tooltips dismiss after pointer-triggered actions', async ({ page }) => {
  await page.goto('/workbench');

  const buttons = [page.getByRole('button', { name: 'Zoom in' }), page.getByRole('button', { name: 'Fit canvas' })];

  for (const button of buttons) {
    await button.hover();
    await expect.poll(async () => tooltipOpacity(button)).toBeGreaterThan(0.9);
    // Opacity is an intermediate — assert the tooltip actually SHOWS.
    // toBeInViewport is IntersectionObserver-backed, which accounts for
    // ancestor clipping: the bar's overflow:hidden shipped fully-clipped
    // tooltips while the opacity assertion stayed green.
    await expect(
      button.locator('xpath=ancestor::*[contains(@class,"toolbar-tooltip-anchor")]').locator('.toolbar-tooltip'),
    ).toBeInViewport({
      ratio: 0.9,
    });

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
  const created = (await createResponse.json()) as { url: string };

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
  expect(warnings.filter((warning) => warning.includes('allow-scripts and allow-same-origin'))).toEqual([]);
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
  const created = (await createResponse.json()) as { id: string };
  const fetchSize = async () => {
    const response = await request.get(`/api/canvas/node/${created.id}`);
    return ((await response.json()) as { size: { width: number; height: number } }).size;
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
  await expect
    .poll(async () => {
      const size = await fetchSize();
      return `${size.width}x${size.height}`;
    })
    .toBe(`480x${fit.height}`);
  await expect
    .poll(async () => {
      const box = await graphNode.boundingBox();
      return box ? `${Math.round(box.width)}x${Math.round(box.height)}` : '';
    })
    .toBe(`480x${Math.round(fit.height)}`);
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

  // The overlay insets 36/48px inside the canvas region (rail-chrome-v2 item
  // 16), so at the 900px test viewport the frame is ~680px tall; the point is
  // that the chart fills it, not the absolute size.
  expect(metrics.iframeWidth).toBeGreaterThan(900);
  expect(metrics.iframeHeight).toBeGreaterThan(600);
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
  const created = (await createResponse.json()) as { id: string };

  await page.setViewportSize({ width: 1100, height: 780 });
  await page.goto(`/api/canvas/surface/${created.id}`);
  const chart = page.locator('.recharts-surface');
  await expect(chart).toBeVisible();

  const readMetrics = () =>
    chart.evaluate((surface) => {
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

test('#67: standalone graph surface reflows chart width on live resize without reload', async ({ page, request }) => {
  const createResponse = await request.post('/api/canvas/graph', {
    data: {
      title: 'Standalone graph resize guard',
      graphType: 'bar',
      data: [
        { label: 'Alpha', value: 24 },
        { label: 'Beta', value: 91 },
        { label: 'Gamma', value: 57 },
      ],
      xKey: 'label',
      yKey: 'value',
      width: 480,
      nodeHeight: 380,
      height: 240,
    },
  });
  const created = (await createResponse.json()) as { id: string };

  // Surface route redirects a graph node to the standalone display=site viewer.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/api/canvas/surface/${created.id}`);
  const chart = page.locator('.recharts-surface');
  await expect(chart).toBeVisible();

  const readMetrics = () =>
    chart.evaluate((surface) => {
      const rect = surface.getBoundingClientRect();
      return {
        svgWidth: rect.width,
        viewportWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });

  // Initial 1280-wide load: chart fills the viewport, no horizontal overflow.
  await expect.poll(async () => (await readMetrics()).svgWidth).toBeGreaterThan(900);
  const wide = await readMetrics();
  expect(wide.scrollWidth).toBeLessThanOrEqual(wide.viewportWidth + 1);

  // Shrink the LIVE tab (no reload): the chart must recompute narrower, and the
  // document must not gain horizontal overflow from a stale wide SVG (#67).
  await page.setViewportSize({ width: 900, height: 600 });
  await expect.poll(async () => (await readMetrics()).svgWidth, { timeout: 5000 }).toBeLessThan(wide.svgWidth - 100);
  const narrow = await readMetrics();
  expect(narrow.svgWidth).toBeLessThanOrEqual(narrow.viewportWidth);
  expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.viewportWidth + 1);

  // Grow the LIVE tab back: the chart must recompute wider again (the failure
  // reproduced in both directions, so guard both).
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect
    .poll(async () => (await readMetrics()).svgWidth, { timeout: 5000 })
    .toBeGreaterThan(narrow.svgWidth + 100);
  const regrown = await readMetrics();
  expect(regrown.scrollWidth).toBeLessThanOrEqual(regrown.viewportWidth + 1);
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
  const created = (await createResponse.json()) as { id: string };

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
      return [
        {
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
        },
      ];
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
  const node = (await response.json()) as {
    data: { spec?: { elements?: Record<string, { props?: Record<string, unknown> }> } };
  };
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
  const created = (await createResponse.json()) as { id: string };

  await page.goto('/workbench');

  const note = page.locator('.canvas-node').filter({ hasText: 'Pin me' });
  await expect(note).toHaveCount(1);

  await note.click({ button: 'right' });
  // The arrange-lock item was renamed off the word "Pin" (report #63) to disambiguate
  // it from context pinning; it still toggles node.pinned (now also persisted).
  await page.locator('.context-menu-item').filter({ hasText: 'Lock position' }).click();

  await expect(note).toHaveClass(/pinned/);
  await expect
    .poll(async () => {
      const response = await request.get(`/api/canvas/node/${created.id}`);
      const node = (await response.json()) as { pinned: boolean };
      return node.pinned;
    })
    .toBe(true);
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
  const created = (await createResponse.json()) as { id: string };

  await page.goto('/workbench');

  const group = page.locator('.canvas-node.group-node').filter({ hasText: 'Color group' });
  await expect(group).toHaveCount(1);

  await group.click({ button: 'right' });
  await page.getByRole('button', { name: 'Set group color to Green' }).click();

  await expect
    .poll(async () => {
      const response = await request.get(`/api/canvas/node/${created.id}`);
      const node = (await response.json()) as { data: Record<string, unknown> };
      return node.data.color;
    })
    .toBe('#22c55e');

  // Groups v2 tints the frame from --group-color (a color-mix), so assert the
  // accent reached the border rather than a solid channel value.
  await expect(group).toHaveCSS('border-top-color', /34, 197, 94|0\.13333\d* 0\.77254\d* 0\.36862\d*/);
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
  const first = (await firstResponse.json()) as { id: string };

  const secondResponse = await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title: 'Grouped second',
      content: 'Second child',
      x: 940,
      y: 240,
    },
  });
  const second = (await secondResponse.json()) as { id: string };

  const groupResponse = await request.post('/api/canvas/group', {
    data: {
      title: 'Restore drag group',
      childIds: [first.id, second.id],
    },
  });
  const group = (await groupResponse.json()) as { id: string };

  const saveResponse = await request.post('/api/canvas/snapshots', {
    data: { name: 'Grouped drag restore snapshot' },
  });
  const saved = (await saveResponse.json()) as { snapshot: { id: string } };

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
  const beforeGroup = (await beforeGroupResponse.json()) as { position: { x: number; y: number } };
  const beforeChild = (await beforeChildResponse.json()) as { position: { x: number; y: number } };

  await dragNodeTitlebar(page, groupedGroup, 180, 120);

  await expect
    .poll(async () => {
      const groupResponseAfter = await request.get(`/api/canvas/node/${group.id}`);
      const childResponseAfter = await request.get(`/api/canvas/node/${first.id}`);
      const groupNode = (await groupResponseAfter.json()) as { position: { x: number; y: number } };
      const childNode = (await childResponseAfter.json()) as { position: { x: number; y: number } };
      const groupDeltaX = groupNode.position.x - beforeGroup.position.x;
      const groupDeltaY = groupNode.position.y - beforeGroup.position.y;
      const childDeltaX = childNode.position.x - beforeChild.position.x;
      const childDeltaY = childNode.position.y - beforeChild.position.y;
      return (
        (Math.abs(groupDeltaX) > 10 || Math.abs(groupDeltaY) > 10) &&
        Math.abs(groupDeltaX - childDeltaX) <= 1 &&
        Math.abs(groupDeltaY - childDeltaY) <= 1
      );
    })
    .toBe(true);
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
  const created = (await createResponse.json()) as { id: string };

  await page.goto('/workbench');
  // Switch to light theme through the real toolbar control so the choice is
  // persisted server-side. A raw setAttribute('data-theme','light') is not
  // persisted, so a later SSE round-trip (e.g. the pin below now also flips
  // the node's effective pinned flag) would re-apply the server's stored
  // theme and clobber it — flaking this assertion.
  await selectTheme(page, 'Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  const note = page.locator('.canvas-node').filter({ hasText: 'Light theme pin' });
  await expect(note).toHaveCount(1);

  await note.locator('.ctx-pin-btn').click();

  await expect
    .poll(async () => {
      const response = await request.get('/api/canvas/pinned-context');
      const pinned = (await response.json()) as { nodeIds: string[] };
      return pinned.nodeIds;
    })
    .toContain(created.id);

  await expect(note).toHaveCSS('border-top-color', 'rgb(75, 188, 255)');
  await expect
    .poll(async () => {
      return await note.evaluate((element) => getComputedStyle(element).boxShadow);
    })
    .toContain('75, 188, 255');
});

test('annotations use theme contrast colors and can be erased', async ({ page, request }) => {
  await request.post('/api/canvas/annotation', {
    data: {
      points: [
        { x: 100, y: 120 },
        { x: 220, y: 120 },
      ],
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

  await pickAnnotateTool(page, 'Eraser');
  // World (160,120) renders at region origin (rail 52px, bar 44px) + world.
  await page.mouse.click(212, 164);

  await expect(annotation).toHaveCount(0);
  await expect
    .poll(async () => {
      const response = await request.get('/api/canvas/state');
      const state = (await response.json()) as { annotations?: unknown[] };
      return state.annotations?.length ?? 0;
    })
    .toBe(0);
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

  await pickAnnotateTool(page, 'Draw (A)');
  await page.mouse.move(220, 190);
  await page.mouse.down();
  await page.mouse.move(300, 230, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.annotation-layer path')).toHaveCount(1);

  await pickAnnotateTool(page, 'Text note');
  await page.mouse.click(240, 260);
  await page.locator('.annotation-text-input').fill('Intent note');
  await page.keyboard.press('Enter');
  await expect(page.locator('.annotation-layer text')).toContainText('Intent note');
  await expect(page.locator('.annotation-layer text')).toHaveCSS('fill', 'rgb(244, 239, 230)');

  await expect
    .poll(async () => {
      const response = await request.get('/api/canvas/state');
      const state = (await response.json()) as { annotations?: Array<{ type?: string; text?: string }> };
      return state.annotations?.map((annotation) => `${annotation.type}:${annotation.text ?? ''}`).sort() ?? [];
    })
    .toEqual(['freehand:', 'text:Intent note']);
});

test('annotation toolbar actions preserve the current light theme', async ({ page }) => {
  await page.goto('/workbench');
  await selectTheme(page, 'Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await pickAnnotateTool(page, 'Draw (A)');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await pickAnnotateTool(page, 'Stop annotating');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await pickAnnotateTool(page, 'Eraser');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('theme selection persists for fresh browser sessions', async ({ page, request, context }) => {
  await page.goto('/workbench');
  await selectTheme(page, 'Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await expect
    .poll(async () => {
      const response = await request.get('/api/canvas/theme');
      const body = (await response.json()) as { theme?: string };
      return body.theme;
    })
    .toBe('light');

  const secondPage = await context.newPage();
  await secondPage.goto('/workbench');
  await expect(secondPage.locator('html')).toHaveAttribute('data-theme', 'light');
  await secondPage.close();

  await selectTheme(page, 'Dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await expect
    .poll(async () => {
      const response = await request.get('/api/canvas/theme');
      const body = (await response.json()) as { theme?: string };
      return body.theme;
    })
    .toBe('dark');

  const thirdPage = await context.newPage();
  await thirdPage.goto('/workbench');
  await expect(thirdPage.locator('html')).toHaveAttribute('data-theme', 'dark');
  await thirdPage.close();

  // A NEW named theme must survive the same round-trip: the client whitelist
  // once hardcoded the original three, silently resetting new themes to dark
  // on reload while the server kept reporting the saved name.
  await selectTheme(page, 'Ember');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ember');
  const fourthPage = await context.newPage();
  await fourthPage.goto('/workbench');
  await expect(fourthPage.locator('html')).toHaveAttribute('data-theme', 'ember');
  await fourthPage.close();
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
  const created = (await createResponse.json()) as { id: string };

  await page.goto('/workbench');
  await expect(page.locator('.canvas-node').filter({ hasText: 'Focus me' })).toHaveCount(1);

  await request.post('/api/canvas/focus', {
    data: { id: created.id },
  });

  // Finding Z, asserted the way it actually matters: the focused node must end
  // up ON SCREEN at the margin. The previous expectation (836, 604) matched the
  // server's numbers while putting the node at screen (1736, 1304) — outside a
  // 1280x720 viewport. screen = world * scale + translate.
  await expect
    .poll(async () => {
      return await page.evaluate(() => {
        const node = document.querySelector('.canvas-node') as HTMLElement | null;
        const region = document.querySelector('.canvas-region');
        if (!node || !region) return null;
        const box = node.getBoundingClientRect();
        const area = region.getBoundingClientRect();
        return { x: Math.round(box.left - area.left), y: Math.round(box.top - area.top) };
      });
    })
    .toEqual({ x: 64, y: 96 });
});

test('authoritative viewport updates from the server override browser startup state', async ({ page, request }) => {
  await request.post('/api/canvas/viewport', {
    data: { x: 120, y: -80, scale: 1.5 },
  });

  await page.goto('/workbench');

  await expect
    .poll(async () => {
      return await page.evaluate(() => {
        const viewport = document.querySelector(
          '.canvas-viewport > div[style*="position: absolute"]',
        ) as HTMLElement | null;
        return viewport?.style.transform ?? null;
      });
    })
    .toContain('matrix(1.5, 0, 0, 1.5, 120, -80)');
});

test('ghost intents are interactive, reconnect-safe, vetoable, and settle into linked mutations', async ({
  page,
  request,
}) => {
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
  expect(
    await vetoButton.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return hit === button || button.contains(hit);
    }),
  ).toBe(true);

  await vetoButton.click();
  await expect(vetoGhost).toHaveCount(0);
  await expect
    .poll(async () => {
      const response = await request.get('/api/canvas/ax/timeline?limit=20');
      const timeline = (await response.json()) as {
        summary?: { pendingSteering?: Array<{ message?: string }> };
      };
      return timeline.summary?.pendingSteering?.some((item) => item.message?.includes('Blocked note')) ?? false;
    })
    .toBe(true);

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

  const settleObservation = page.evaluate(
    () =>
      new Promise<{
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
          // Deadline covers the minimum-dwell floor (~650ms) + the settle morph.
          if ((!ghost && Number.isFinite(bestPositionDelta)) || Date.now() - startedAt > 2500) {
            resolve({ positionDelta: bestPositionDelta, sizeDelta: bestSizeDelta });
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );

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

test('an unsignalled agent mutation shows an auto-ghost for at least the minimum dwell', async ({ page, request }) => {
  // Finding W regression: the server signals and settles an auto-ghost within
  // milliseconds; the CLIENT must hold it visible for MIN_FORMING_MS (650ms).
  // Consumes the real SSE sequence (ax-intent auto:true → canvas-layout-update
  // → ax-intent-clear settled) and samples the DOM through the whole window.
  await page.goto('/workbench');
  await expect(page.locator('.canvas-viewport')).toBeVisible();

  // In-page sampler: records every observation of an auto-ghost with a timestamp.
  await page.evaluate(() => {
    const samples: Array<{ t: number; auto: boolean }> = [];
    (window as Window & { __ghostSamples?: typeof samples }).__ghostSamples = samples;
    const started = Date.now();
    const timer = setInterval(() => {
      samples.push({ t: Date.now() - started, auto: document.querySelectorAll('.intent-ghost.is-auto').length > 0 });
      if (Date.now() - started > 4000) clearInterval(timer);
    }, 40);
  });

  // Unsignalled mutation: no canvas_intent, no X-PMX-Workbench header.
  const created = await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'Auto-ghost dwell probe', content: 'unsignalled', x: 420, y: 620 },
  });
  expect(created.ok()).toBe(true);

  await page.waitForTimeout(2500);
  const samples = await page.evaluate(
    () => (window as Window & { __ghostSamples?: Array<{ t: number; auto: boolean }> }).__ghostSamples ?? [],
  );
  const seen = samples.filter((sample) => sample.auto);
  expect(seen.length).toBeGreaterThan(0);
  // >= 600ms observed window (650ms floor minus sampling slop under load).
  expect(seen[seen.length - 1].t - seen[0].t).toBeGreaterThanOrEqual(600);
});

test('polling transport boots the board and receives live updates (proxy-safe fallback)', async ({ page, request }) => {
  // Buffering proxies (e.g. the Amp orb portal) never flush the SSE stream, so
  // the client falls back to GET /api/workbench/poll. ?transport=poll forces
  // that path deterministically: the board must bootstrap from the poll
  // snapshot and reflect a server-side mutation within a couple of poll cycles
  // — with the SSE stream never involved.
  await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'Poll Boot Node', content: 'via snapshot', x: 80, y: 80 },
  });

  await page.goto('/workbench?transport=poll');

  // Bootstrap: the snapshot's canvas-layout-update renders the existing node.
  await expect(page.locator('.canvas-node').filter({ hasText: 'Poll Boot Node' })).toBeVisible();

  // Live path: a node added AFTER boot arrives through incremental polls.
  await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'Poll Live Node', content: 'via incremental poll', x: 80, y: 320 },
  });
  // Generous ceiling: the poll cycle is 2s, but under full-suite CPU load the
  // rounds stretch — the contract is "arrives via incremental polls", not
  // "arrives in N seconds". A genuinely broken transport still fails here.
  await expect(page.locator('.canvas-node').filter({ hasText: 'Poll Live Node' })).toBeVisible({ timeout: 25000 });
});

test('srcdoc iframe mode renders same-origin surfaces inline (nested-embed fallback)', async ({ page, request }) => {
  // Nested-iframe hosts (the Amp orb portal embeds the canvas page inside an
  // ampcode.com iframe) block child iframes from loading ANY src URL — even
  // same-origin ones — so iframe-backed nodes show a gray placeholder there.
  // ?iframe-mode=srcdoc forces the fallback the boot probe selects in that
  // context: surfaces are fetch()ed and rendered inline via srcdoc. This test
  // proves the whole inline transport — html surface AND the json-render
  // viewer bundle — renders real content without any src attribute.
  await request.post('/api/canvas/node', {
    data: {
      type: 'html',
      title: 'Srcdoc HTML target',
      html: '<main><h1>Srcdoc surface sentinel</h1></main>',
      x: 80,
      y: 80,
      width: 520,
      height: 360,
    },
  });
  await request.post('/api/canvas/json-render', {
    data: {
      title: 'Srcdoc JSON target',
      spec: {
        root: 'card',
        elements: {
          card: {
            type: 'Card',
            props: { title: 'Srcdoc card', description: 'inline transport' },
            children: [],
          },
        },
      },
      x: 700,
      y: 80,
      width: 420,
      height: 300,
    },
  });

  await page.goto('/workbench?iframe-mode=srcdoc');

  const htmlNode = page.locator('.canvas-node').filter({ hasText: 'Srcdoc HTML target' });
  await expect(htmlNode.locator('iframe')).toHaveAttribute('srcdoc', /Srcdoc surface sentinel/);
  await expect(htmlNode.locator('iframe')).not.toHaveAttribute('src', /.+/);
  await expect(htmlNode.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(htmlNode.frameLocator('iframe').getByText('Srcdoc surface sentinel')).toBeVisible();

  const jsonNode = page.locator('.canvas-node').filter({ hasText: 'Srcdoc JSON target' });
  await expect(jsonNode.locator('iframe')).toHaveAttribute('srcdoc', /./);
  await expect(jsonNode.frameLocator('iframe').getByText('Srcdoc card')).toBeVisible();
});

test('rail tooltips: hover shows the label and shortcut beside the rail, hidden while the button’s menu is open', async ({
  page,
}) => {
  await page.goto('/workbench');
  const tip = page.locator('[data-testid="rail-tooltip"]');
  await expect(tip).toHaveCount(0);

  const file = page.getByRole('button', { name: 'File (Shift+F)' });
  await file.hover();
  await expect(tip).toBeVisible();
  await expect(tip.locator('.toolbar-tooltip-label')).toHaveText('File');
  await expect(tip.locator('kbd')).toHaveText('Shift+F');
  // Beside the rail, not clipped by it: the tooltip's box starts right of the button
  // (measured after its 140 ms slide-in settles).
  await page.waitForTimeout(250);
  const [tipBox, btnBox, rail] = await Promise.all([
    tip.boundingBox(),
    file.boundingBox(),
    page.locator('.tool-rail').boundingBox(),
  ]);
  if (!tipBox || !btnBox || !rail) throw new Error('missing boxes');
  expect(tipBox.x).toBeGreaterThan(rail.x + rail.width);
  expect(Math.abs(tipBox.y + tipBox.height / 2 - (btnBox.y + btnBox.height / 2))).toBeLessThan(4);

  await page.mouse.move(700, 500);
  await expect(tip).toHaveCount(0);

  // The theme button's tooltip yields to its own menu.
  const theme = page.getByRole('button', { name: 'Choose theme' });
  await theme.hover();
  await expect(tip.locator('.toolbar-tooltip-label')).toHaveText('Theme');
  await theme.click();
  await expect(page.getByRole('menu', { name: 'Theme' })).toBeVisible();
  await expect(tip).toHaveCount(0);
});

test('narrow screens keep the rail chrome fully usable with meta collapsed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/workbench');

  // The rail keeps every control reachable; the top bar sheds only meta text.
  await expect(page.locator('.tool-rail')).toBeVisible();
  await expect(page.locator('.top-bar')).toBeVisible();
  await expect(page.locator('.top-bar .hud-collapsible-text').first()).toBeHidden();
  await expect(page.getByRole('button', { name: 'Select (V)' })).toBeVisible();

  // The top bar never wraps: its content stays within the 44px row.
  const bar = await page.locator('.top-bar').boundingBox();
  if (!bar) throw new Error('missing top bar box');
  expect(bar.height).toBeLessThanOrEqual(44);

  // The theme picker applies a named theme directly from the rail.
  await page.getByRole('button', { name: 'Choose theme' }).click();
  await page.locator('.toolbar-menu').getByRole('menuitemradio', { name: 'Ember' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ember');
  await expect(page.locator('.toolbar-menu')).toHaveCount(0);
});

test('desktop theme picker lists every registered theme and applies one', async ({ page }) => {
  await page.goto('/workbench');
  await page.getByRole('button', { name: 'Choose theme' }).click();
  const menu = page.locator('.toolbar-menu');
  await expect(menu.getByRole('menuitemradio')).toHaveCount(9);
  await menu.getByRole('menuitemradio', { name: 'Midnight' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');
});

test('?theme= session override themes one panel without touching the server-global theme', async ({
  page,
  request,
}) => {
  await page.goto('/workbench?theme=light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // The server-global theme is untouched — every other client still gets dark.
  const shared = (await request.get('/api/canvas/theme').then((r) => r.json())) as { theme?: string };
  expect(shared.theme).toBe('dark');

  // An explicit pick from the picker ends the override and saves globally.
  await selectTheme(page, 'Ember');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ember');
  await expect
    .poll(async () => ((await request.get('/api/canvas/theme').then((r) => r.json())) as { theme?: string }).theme)
    .toBe('ember');
});

test('?theme=auto follows the host color scheme live', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/workbench?theme=auto');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('theme menu opens anchored to the theme button, not the toolbar edge (Finding T)', async ({ page }) => {
  await page.goto('/workbench');
  const button = page.getByRole('button', { name: 'Choose theme' });
  await button.click();
  const menu = page.locator('.toolbar-menu');
  await expect(menu).toBeVisible();
  const buttonBox = await button.boundingBox();
  const menuBox = await menu.boundingBox();
  if (!buttonBox || !menuBox) throw new Error('missing bounding boxes');
  // The 0.4.2 regression anchored the menu to a distant ancestor edge instead
  // of its trigger. In the rail chrome the menu opens immediately to the RIGHT
  // of the trigger, bottom-aligned with it (bottom utility cluster).
  expect(Math.abs(menuBox.x - (buttonBox.x + buttonBox.width + 8))).toBeLessThan(24);
  expect(Math.abs(menuBox.y + menuBox.height - (buttonBox.y + buttonBox.height))).toBeLessThan(24);
});

test('select tool lassos on background drag; pan tool and Space pan instead', async ({ page, request }) => {
  await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'Lasso A', content: 'a', x: 120, y: 80, width: 200, height: 120 },
  });
  await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'Lasso B', content: 'b', x: 380, y: 160, width: 200, height: 120 },
  });

  await page.goto('/workbench');
  await expect(page.locator('.canvas-node')).toHaveCount(2);

  // Select tool (default): plain background drag draws a lasso and selects.
  // Region origin is (52,44); start above-left of both nodes, sweep past them.
  await page.mouse.move(60, 52);
  await page.mouse.down();
  await page.mouse.move(700, 460, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.selection-bar')).toBeVisible();
  const zoomBefore = await page.locator('.top-bar-zoom-label').textContent();

  await page.keyboard.press('Escape');
  await expect(page.locator('.selection-bar')).toHaveCount(0);

  // Held Space: the same drag pans the viewport instead of selecting.
  const worldBefore = await page.evaluate(
    () => (document.querySelector('.canvas-world') as HTMLElement).style.transform,
  );
  await page.keyboard.down(' ');
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(560, 380, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up(' ');
  const worldAfterSpace = await page.evaluate(
    () => (document.querySelector('.canvas-world') as HTMLElement).style.transform,
  );
  expect(worldAfterSpace).not.toBe(worldBefore);
  await expect(page.locator('.selection-bar')).toHaveCount(0);
  // Panning must not zoom.
  await expect(page.locator('.top-bar-zoom-label')).toHaveText(zoomBefore ?? '100%');

  // Pan tool: dragging ANYWHERE pans — including starting on a node, which
  // must neither drag the node nor select it.
  const nodeState = await request.get('/api/canvas/state');
  const before = (await nodeState.json()) as { nodes: Array<{ id: string; position: { x: number; y: number } }> };
  await page.getByRole('button', { name: 'Pan (Space)' }).click();
  const nodeBox = await page.locator('.canvas-node').first().boundingBox();
  if (!nodeBox) throw new Error('missing node box');
  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(nodeBox.x + 120, nodeBox.y + 90, { steps: 5 });
  await page.mouse.up();
  const worldAfterPanTool = await page.evaluate(
    () => (document.querySelector('.canvas-world') as HTMLElement).style.transform,
  );
  expect(worldAfterPanTool).not.toBe(worldAfterSpace);
  const after = (await (await request.get('/api/canvas/state')).json()) as {
    nodes: Array<{ id: string; position: { x: number; y: number } }>;
  };
  for (const node of after.nodes) {
    const prev = before.nodes.find((entry) => entry.id === node.id);
    expect(node.position).toEqual(prev?.position);
  }

  // Back to select for later tests.
  await page.getByRole('button', { name: 'Select (V)' }).click();
});

test('agent presence reaches the browser: sessionActive flips on attach and back on detach', async ({
  page,
  request,
}) => {
  await page.goto('/workbench');
  const shell = page.locator('.app-shell');
  await expect(shell).toHaveAttribute('data-session-active', 'false');

  // An external writer (agent mutation, no session) must NOT activate a session.
  await request.post('/api/canvas/node', { data: { type: 'markdown', title: 'External write' } });
  await expect(page.locator('.canvas-node').filter({ hasText: 'External write' })).toHaveCount(1);
  await expect(shell).toHaveAttribute('data-session-active', 'false');

  // session-start on the activity feed attaches → the single gate flips.
  const start = await request.post('/api/canvas/ax/activity', {
    data: { kind: 'session-start', title: 'Copilot session', source: 'copilot' },
  });
  expect(start.ok()).toBe(true);
  await expect(shell).toHaveAttribute('data-session-active', 'true');

  // session-end detaches → back to the quiet board.
  const end = await request.post('/api/canvas/ax/activity', {
    data: { kind: 'session-end', title: 'done', source: 'copilot' },
  });
  expect(end.ok()).toBe(true);
  await expect(shell).toHaveAttribute('data-session-active', 'false');
});

test('agent presence surfaces: cursor + chip on attach, shimmer on mutation, byte-clean on detach', async ({
  page,
  request,
}) => {
  const created = await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'Presence target', content: 'watch me', x: 200, y: 160, width: 360, height: 200 },
  });
  const node = (await created.json()) as { id: string };

  await page.goto('/workbench');
  const target = page.locator('.canvas-node').filter({ hasText: 'Presence target' });
  await expect(target).toHaveCount(1);

  // Quiet board: no agent chrome at all, even though an external writer
  // (the create above) is live.
  await expect(page.locator('.agent-chip')).toHaveCount(0);
  await expect(page.locator('.agent-cursor')).toHaveCount(0);

  // Attach a thinking session focused on the node.
  const attach = await request.post('/api/canvas/ax/presence', {
    data: { source: 'copilot', label: 'Claude · sonnet', attached: true, phase: 'thinking', focusNodeId: node.id },
  });
  expect(attach.ok()).toBe(true);
  await expect(page.locator('.agent-chip .agent-chip-label')).toHaveText('Thinking');
  await expect(page.locator('.agent-chip')).toHaveClass(/phase-thinking/);

  // The cursor is ON the focused node (user-visible placement, not a tuple).
  const cursor = page.locator('.agent-cursor');
  await expect(cursor).toHaveCount(1);
  const [cursorBox, nodeBox] = await Promise.all([cursor.boundingBox(), target.boundingBox()]);
  if (!cursorBox || !nodeBox) throw new Error('missing boxes');
  expect(cursorBox.x).toBeGreaterThanOrEqual(nodeBox.x);
  expect(cursorBox.x).toBeLessThanOrEqual(nodeBox.x + nodeBox.width);
  expect(cursorBox.y).toBeGreaterThanOrEqual(nodeBox.y);
  expect(cursorBox.y).toBeLessThanOrEqual(nodeBox.y + nodeBox.height);

  // An agent mutation through a plain transport (no session label) is
  // ATTRIBUTED to the attached session: the node shimmers for at least the
  // ghost's minimum dwell and the session's chip follows the tooling phase.
  const patch = await request.patch(`/api/canvas/node/${node.id}`, { data: { title: 'Presence target (edited)' } });
  expect(patch.ok()).toBe(true);
  await expect(target).toHaveClass(/agent-mutating/);
  await expect(page.locator('.agent-chip .agent-chip-label')).toHaveText(/Running node\.update/);
  await expect(target).not.toHaveClass(/agent-mutating/, { timeout: 5000 });
  // Still exactly one cursor — the transport write did not spawn a second writer.
  await expect(cursor).toHaveCount(1);

  // The cursor FOLLOWS the session's work: a new node written over the same
  // transport pulls the cursor onto it.
  const second = await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'Second target', content: 'next', x: 700, y: 420, width: 300, height: 160 },
  });
  expect(second.ok()).toBe(true);
  const secondNode = page.locator('.canvas-node').filter({ hasText: 'Second target' });
  await expect(secondNode).toHaveCount(1);
  await expect
    .poll(async () => {
      const [c, n] = await Promise.all([cursor.boundingBox(), secondNode.boundingBox()]);
      if (!c || !n) return false;
      return c.x >= n.x && c.x <= n.x + n.width && c.y >= n.y && c.y <= n.y + n.height;
    })
    .toBe(true);

  // Detach → the board is byte-clean of agent chrome again.
  const detach = await request.post('/api/canvas/ax/presence', { data: { source: 'copilot', attached: false } });
  expect(detach.ok()).toBe(true);
  await expect(page.locator('.agent-chip')).toHaveCount(0);
  await expect(page.locator('.agent-cursor')).toHaveCount(0);
  await expect(page.locator('.agent-mutating')).toHaveCount(0);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-session-active', 'false');
});

test('session panel: work items, gate approval from the panel, drawer below 1180px, gone on detach', async ({
  page,
  request,
}) => {
  const created = await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'Gate target', content: 'ship it', x: 160, y: 140, width: 360, height: 200 },
  });
  const node = (await created.json()) as { id: string };
  await request.post('/api/canvas/ax/activity', {
    data: { kind: 'session-start', title: 'Claude · sonnet', source: 'copilot' },
  });
  await request.post('/api/canvas/ax/work', {
    data: { title: 'Summarize telemetry', status: 'done', nodeIds: [node.id], source: 'copilot' },
  });
  await request.post('/api/canvas/ax/work', {
    data: {
      title: 'Update widgets',
      status: 'in-progress',
      detail: 'rewriting the tile',
      nodeIds: [node.id],
      source: 'copilot',
    },
  });
  const gateResponse = await request.post('/api/canvas/ax/approval', {
    data: { title: 'Ship REL-421', detail: 'tags the build', nodeIds: [node.id], source: 'copilot' },
  });
  const gate = (await gateResponse.json()) as { approvalGate: { id: string } };

  await page.goto('/workbench');
  const panel = page.locator('.session-panel');
  await expect(panel).toBeVisible();

  // Persisted state shows on a FRESH load (the snapshot is read on connect).
  await expect(panel.locator('.session-item').filter({ hasText: 'Summarize telemetry' })).toHaveClass(/status-done/);
  await expect(panel.locator('.session-item').filter({ hasText: 'Update widgets' })).toHaveClass(/status-running/);
  await expect(panel.locator('.session-gate').filter({ hasText: 'Ship REL-421' })).toHaveCount(1);
  await expect(page.locator('.gate-badge')).toHaveText(/^1 gate · \d+:\d\d$/);
  await expect(page.locator('.agent-chip .agent-chip-label')).toHaveText('Waiting on you');

  // The panel took 320px from the canvas region (poll: the 180ms mount slide
  // means a single sample can land mid-animation).
  await expect
    .poll(async () => {
      const region = await page.locator('.canvas-region').boundingBox();
      const panelBox = await panel.boundingBox();
      if (!region || !panelBox) return null;
      return {
        edge: Math.round(region.x + region.width) === Math.round(panelBox.x),
        width: Math.round(panelBox.width),
      };
    })
    .toEqual({ edge: true, width: 320 });

  // Approve from the panel: resolves the same AX gate the agent awaits.
  await panel.locator('.session-gate').getByRole('button', { name: 'Approve' }).click();
  await expect
    .poll(async () => {
      const response = await request.get(`/api/canvas/ax/approval/${gate.approvalGate.id}`);
      const body = (await response.json()) as { approvalGate?: { status: string } };
      return body.approvalGate?.status;
    })
    .toBe('approved');
  await expect(panel.locator('.session-gate')).toHaveCount(0);
  await expect(page.locator('.gate-badge')).toHaveCount(0);
  // …and the derived phase leaves waiting-approval.
  await expect(page.locator('.agent-chip .agent-chip-label')).not.toHaveText('Waiting on you');

  // A rejection posts steering feedback to the agent.
  const second = await request.post('/api/canvas/ax/approval', {
    data: { title: 'Delete the prod DB', nodeIds: [node.id], source: 'copilot' },
  });
  expect(second.ok()).toBe(true);
  await panel.locator('.session-gate').getByRole('button', { name: 'Reject' }).click();
  await expect
    .poll(async () => {
      const response = await request.get('/api/canvas/ax/timeline?limit=20');
      const body = (await response.json()) as { steering: Array<{ message: string }> };
      return body.steering.some((steer) => steer.message.includes('Rejected gate "Delete the prod DB"'));
    })
    .toBe(true);

  // Below 1180px the panel becomes a fixed drawer and the canvas reclaims its width.
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect.poll(async () => panel.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
  const wideRegion = await page.locator('.canvas-region').boundingBox();
  if (!wideRegion) throw new Error('missing region');
  expect(Math.round(wideRegion.x + wideRegion.width)).toBe(1000);

  // Detach → the panel unmounts and the board is quiet again.
  await request.post('/api/canvas/ax/activity', { data: { kind: 'session-end', title: 'done', source: 'copilot' } });
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-session-active', 'false');
});

test('unattended approval: countdown, auto-hold with a policy entry, reopen from the panel', async ({
  page,
  request,
}) => {
  const created = await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'TTL target', content: 'x', x: 160, y: 140, width: 320, height: 180 },
  });
  const node = (await created.json()) as { id: string };
  await request.post('/api/canvas/ax/activity', { data: { kind: 'session-start', title: 'Codex', source: 'codex' } });
  const gateResponse = await request.post('/api/canvas/ax/approval', {
    data: { title: 'Delete old branches', nodeIds: [node.id], ttlMs: 3000, source: 'codex' },
  });
  const gate = (await gateResponse.json()) as { approvalGate: { id: string; expiresAt: string | null } };
  expect(gate.approvalGate.expiresAt).toBeTruthy();

  await page.goto('/workbench');
  const panel = page.locator('.session-panel');
  // The gate card counts down and the top-bar badge carries the same clock.
  await expect(panel.locator('[data-testid="gate-countdown"]')).toHaveText(/auto-holds in 0:0[0-3] if unanswered/);
  await expect(page.locator('.gate-badge')).toHaveText(/1 gate · 0:0[0-3]/);

  // Nobody answers → the policy holds it: the card flips to held, the badge
  // and waiting-approval phase clear, and a Policy entry lands in the timeline.
  await expect(panel.locator('.session-gate-held').filter({ hasText: 'Delete old branches' })).toHaveCount(1, {
    timeout: 8000,
  });
  await expect(panel.locator('.session-gate')).toHaveCount(0);
  await expect(page.locator('.gate-badge')).toHaveCount(0);
  await expect(panel.locator('.session-timeline-label').filter({ hasText: 'Policy' }).first()).toBeVisible();
  const heldState = await (await request.get(`/api/canvas/ax/approval/${gate.approvalGate.id}`)).json();
  expect((heldState as { approvalGate: { status: string } }).approvalGate.status).toBe('held');

  // Reopen from the panel → pending again with a fresh clock.
  await panel.locator('.session-gate-held').getByRole('button', { name: 'Reopen' }).click();
  await expect(panel.locator('.session-gate').filter({ hasText: 'Delete old branches' })).toHaveCount(1);
  await expect(panel.locator('[data-testid="gate-countdown"]')).toHaveText(/auto-holds in 4:5[0-9]|auto-holds in 5:00/);
  await expect(page.locator('.gate-badge')).toHaveText(/1 gate/);
});

test('scope fence: granted from the selection, drawn around the fenced nodes, enforced on agent writes', async ({
  page,
  request,
}) => {
  const a = (await (
    await request.post('/api/canvas/node', {
      data: { type: 'markdown', title: 'Fence A', content: 'a', x: 120, y: 120, width: 260, height: 140 },
    })
  ).json()) as { id: string };
  const b = (await (
    await request.post('/api/canvas/node', {
      data: { type: 'markdown', title: 'Fence B', content: 'b', x: 480, y: 160, width: 260, height: 140 },
    })
  ).json()) as { id: string };
  const far = (await (
    await request.post('/api/canvas/node', {
      data: { type: 'markdown', title: 'Far away', content: 'c', x: 1400, y: 900, width: 200, height: 120 },
    })
  ).json()) as { id: string };
  await request.post('/api/canvas/ax/activity', { data: { kind: 'session-start', title: 'Codex', source: 'codex' } });

  await page.goto('/workbench');
  const panel = page.locator('.session-panel');
  await expect(panel.locator('[data-testid="session-scope"]')).toContainText('Unscoped');
  await expect(page.locator('.scope-fence')).toHaveCount(0);

  // Select A and B (shift+click toggles a node into the selection) and fence the agent to them.
  await page
    .locator('.canvas-node')
    .filter({ hasText: 'Fence A' })
    .locator('.node-body')
    .click({ modifiers: ['Shift'] });
  await page
    .locator('.canvas-node')
    .filter({ hasText: 'Fence B' })
    .locator('.node-body')
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('.selection-bar')).toBeVisible();
  await panel.getByRole('button', { name: /Fence to selection \(2\)/ }).click();
  await expect(panel.locator('[data-testid="session-scope"]')).toContainText('Scoped to 2 nodes');

  // The fence is drawn around exactly those nodes.
  const fence = page.locator('.scope-fence');
  await expect(fence).toHaveAttribute('data-fenced-count', '2');
  const [fenceBox, aBox, bBox, farBox] = await Promise.all([
    fence.boundingBox(),
    page.locator('.canvas-node').filter({ hasText: 'Fence A' }).boundingBox(),
    page.locator('.canvas-node').filter({ hasText: 'Fence B' }).boundingBox(),
    page.locator('.canvas-node').filter({ hasText: 'Far away' }).boundingBox(),
  ]);
  if (!fenceBox || !aBox || !bBox || !farBox) throw new Error('missing boxes');
  const encloses = (box: { x: number; y: number; width: number; height: number }) =>
    box.x >= fenceBox.x &&
    box.y >= fenceBox.y &&
    box.x + box.width <= fenceBox.x + fenceBox.width &&
    box.y + box.height <= fenceBox.y + fenceBox.height;
  expect(encloses(aBox)).toBe(true);
  expect(encloses(bBox)).toBe(true);
  expect(encloses(farBox)).toBe(false);
  await expect(fence.locator('.scope-fence-pill-top')).toHaveText('Agent scope · 2 nodes');

  // The agent is held to it: an outside write is refused, an inside one lands.
  const blocked = await request.patch(`/api/canvas/node/${far.id}`, { data: { title: 'Agent touched far' } });
  expect(blocked.status()).toBe(403);
  const allowed = await request.patch(`/api/canvas/node/${a.id}`, { data: { title: 'Fence A (agent)' } });
  expect(allowed.ok()).toBe(true);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Fence A (agent)' })).toHaveCount(1);
  expect(b.id).toBeTruthy();

  // Clear it from the panel.
  await panel.getByRole('button', { name: 'Clear' }).click();
  await expect(panel.locator('[data-testid="session-scope"]')).toContainText('Unscoped');
  await expect(page.locator('.scope-fence')).toHaveCount(0);
  const freed = await request.patch(`/api/canvas/node/${far.id}`, { data: { title: 'Agent touched far' } });
  expect(freed.ok()).toBe(true);

  // Fencing a group FRAME grants its members: select the frame alone, fence, and
  // the agent may edit the members (and dissolve the frame) but not the node outside.
  const group = (await (
    await request.post('/api/canvas/group', { data: { title: 'Fence frame', childIds: [a.id, b.id] } })
  ).json()) as { id: string };
  await page.keyboard.press('Escape');
  await page
    .locator('.canvas-node.group-node')
    .filter({ hasText: 'Fence frame' })
    .locator('.group-edge-row')
    .click({ position: { x: 240, y: 6 }, modifiers: ['Shift'] });
  await panel.getByRole('button', { name: /Fence to selection \(1\)/ }).click();
  await expect(panel.locator('[data-testid="session-scope"]')).toContainText('Scoped to 3 nodes');
  await expect(page.locator('.scope-fence')).toHaveAttribute('data-fenced-count', '3');
  expect((await request.patch(`/api/canvas/node/${b.id}`, { data: { title: 'Fence B (agent)' } })).ok()).toBe(true);
  expect((await request.patch(`/api/canvas/node/${far.id}`, { data: { title: 'nope' } })).status()).toBe(403);
  expect((await request.post('/api/canvas/group/ungroup', { data: { groupId: group.id } })).ok()).toBe(true);
  await expect(page.locator('.canvas-node.group-node')).toHaveCount(0);
});

test('addressed steering: the composer lists connected agents, the picked one alone claims the message', async ({
  page,
  request,
}) => {
  // Three connected agents: two sessions and one live writer.
  for (const [label, attached] of [
    ['claude-code', true],
    ['copilot', true],
  ] as const) {
    await request.post('/api/canvas/ax/presence', {
      data: { source: label, attached, phase: 'idle' },
      headers: { 'x-pmx-source': label },
    });
  }
  await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'By codex', content: 'notes', x: 200, y: 200, width: 240, height: 120 },
    headers: { 'x-pmx-source': 'codex' },
  });

  await page.goto('/workbench');
  const picker = page.getByLabel('Steer which agent');
  await expect(picker).toBeVisible();
  // Writers from earlier tests may still be live (in-memory, 90 s TTL) — assert
  // OUR agents and the ordering rule (sessions before writers), not exact totals.
  await expect
    .poll(async () => {
      const options = await picker.locator('option').allInnerTexts();
      const wanted = ['All agents', 'claude-code', 'copilot', 'codex · writer'];
      return (
        wanted.every((entry) => options.includes(entry)) &&
        options.indexOf('claude-code') < options.indexOf('codex · writer') &&
        options.indexOf('copilot') < options.indexOf('codex · writer')
      );
    })
    .toBe(true);

  await picker.selectOption('copilot');
  const input = page.getByLabel('Steer the agent');
  await expect(input).toHaveAttribute('placeholder', /Steer copilot/);
  await input.fill('own the CI flake, ignore the rest');
  await page.keyboard.press('Enter');

  // Only the addressed consumer can claim it; the panel row names the address.
  const claim = async (consumer: string) =>
    (
      (await (await request.get(`/api/canvas/ax/delivery/pending?consumer=${consumer}&limit=50`)).json()) as {
        pending: Array<{ message: string }>;
      }
    ).pending.some((entry) => entry.message === 'own the CI flake, ignore the rest');
  await expect.poll(() => claim('copilot')).toBe(true);
  expect(await claim('codex')).toBe(false);
  expect(await claim('claude-code')).toBe(false);
  await expect(page.locator('.session-timeline')).toContainText('→ copilot · own the CI flake, ignore the rest');

  // The meter tooltip opens on CLICK too (surfaces without hover forwarding).
  await page.locator('.context-budget').click();
  await expect(page.locator('.toolbar-tooltip', { hasText: 'Pins — pinned-context size' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Work items: collapsed by default with a live summary; a pending gate forces it open.
  const workToggle = page.locator('[data-testid="work-items-toggle"]');
  await expect(workToggle).toContainText('none yet');
  await expect(page.getByRole('list', { name: 'Work items and gates' })).toBeHidden();
  await request.post('/api/canvas/ax/work', {
    data: { title: 'Own the CI flake', status: 'in-progress' },
    headers: { 'x-pmx-source': 'copilot' },
  });
  await expect(workToggle).toContainText('1 running');
  await expect(workToggle.locator('.session-work-dot')).toBeVisible();
  const workList = page.getByRole('list', { name: 'Work items and gates' });
  await expect(workList).toBeHidden();
  await workToggle.click();
  await expect(workList).toBeVisible();
  await expect(workList).toContainText('Own the CI flake');
  await workToggle.click();
  await expect(workList).toBeHidden();
  const gateResponse = (await (
    await request.post('/api/canvas/ax/approval', {
      data: { title: 'Force-open check', ttlMs: 120000 },
      headers: { 'x-pmx-source': 'copilot' },
    })
  ).json()) as { approvalGate: { id: string } };
  await expect(page.locator('.session-gate').filter({ hasText: 'Force-open check' })).toBeVisible();
  await page.locator('.session-gate').getByRole('button', { name: 'Approve' }).click();
  await expect(page.locator('.session-gate')).toHaveCount(0);
  expect(gateResponse.approvalGate.id).toBeTruthy();

  // The fixed undo row: an agent edit on top of the stack surfaces "↩ Undo" in a
  // constant position (the timeline chip alone proved unfindable in live use) —
  // clicking it reverts the edit and the row disappears.
  const undoTarget = (await (
    await request.post('/api/canvas/node', {
      data: { type: 'markdown', title: 'Undo row target', content: 'u', x: 900, y: 640, width: 240, height: 120 },
      headers: { 'x-pmx-source': 'copilot' },
    })
  ).json()) as { id: string };
  const undoRow = page.locator('[data-testid="session-undo-row"]');
  await expect(undoRow).toBeVisible();
  await expect(undoRow).toContainText('Created markdown “Undo row target”');
  await undoRow.getByRole('button', { name: '↩ Undo' }).click();
  await expect.poll(async () => (await request.get(`/api/canvas/node/${undoTarget.id}`)).status()).toBe(404);
  await expect(undoRow).toBeHidden();

  // Timeline kind filters: "Steer" keeps steering-shaped rows only; "All" restores the mix.
  const filters = page.locator('.session-timeline-filters');
  // All six chips sit on ONE row (they wrapped to two when Assistant landed)
  // and FIT — the row's overflow escape hatch must not be hiding the last one.
  const rowTops = await filters
    .locator('.activity-filter')
    .evaluateAll((chips) => chips.map((chip) => (chip as HTMLElement).offsetTop));
  expect(new Set(rowTops).size).toBe(1);
  const fit = await filters.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
  await filters.getByRole('button', { name: 'Steer' }).click();
  await expect(page.locator('.session-timeline .session-timeline-label').first()).toHaveText('Steer');
  await expect(page.locator('.session-timeline')).not.toContainText('Update');
  await filters.getByRole('button', { name: 'Updates' }).click();
  await expect(page.locator('.session-timeline .session-timeline-label').first()).toHaveText('Update');
  await filters.getByRole('button', { name: 'All' }).click();

  // The picked agent disconnecting falls back to broadcast.
  await request.post('/api/canvas/ax/presence', {
    data: { source: 'copilot', attached: false },
    headers: { 'x-pmx-source': 'copilot' },
  });
  await expect(input).toHaveAttribute('placeholder', /Steer the agent/);
  await expect(picker).toHaveValue('');
});

test('human-started session: start from the quiet board, steer from the command bar, end to a receipt', async ({
  page,
  request,
}) => {
  // rail-chrome-v2 phase 5: the whole loop without an adapter — the human
  // attaches a session, the board flips to a Focus Session, agent writes are
  // attributed to it, steering goes out from the command bar, and ending it
  // leaves a receipt whose View diff is the session's own changes.
  const spec = (await (
    await request.post('/api/canvas/node', {
      data: { type: 'markdown', title: 'Spec', content: 'the plan', x: 120, y: 120, width: 300, height: 160 },
    })
  ).json()) as { id: string };
  await request.post('/api/canvas/context-pins', { data: { nodeIds: [spec.id] } });

  await page.goto('/workbench');
  const shell = page.locator('.app-shell');
  await expect(shell).toHaveAttribute('data-session-active', 'false');
  await expect(page.locator('.context-pin-bar')).toBeVisible();
  await expect(page.locator('.command-bar')).toHaveCount(0);
  const start = page.getByRole('button', { name: 'Start agent session' });
  await expect(start).toBeVisible();

  await start.click();
  await expect(shell).toHaveAttribute('data-session-active', 'true');
  await expect(start).toHaveCount(0);
  await expect(page.locator('.session-panel')).toBeVisible();
  await expect(page.locator('.agent-chip .agent-chip-who')).toHaveText('Agent session');
  // The pin bar hands over to the command bar, pins as chips.
  await expect(page.locator('.context-pin-bar')).toHaveCount(0);
  const bar = page.locator('.command-bar');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.command-bar-chip-label')).toHaveText(['Spec']);

  // Attaching over a non-empty board took the pre-session snapshot.
  const snapshots = (await (await request.get('/api/canvas/snapshots?all=true')).json()) as Array<{ name: string }>;
  expect(snapshots.some((entry) => entry.name.startsWith('Before session · Agent session · '))).toBe(true);

  // A transport write is the session's own work now: its cursor parks on the new node.
  const added = (await (
    await request.post('/api/canvas/node', {
      data: { type: 'markdown', title: 'Agent note', content: 'draft', x: 520, y: 120, width: 260, height: 140 },
    })
  ).json()) as { id: string };
  await expect(page.locator('.canvas-node').filter({ hasText: 'Agent note' })).toHaveCount(1);
  await expect(page.locator('.agent-cursor')).toHaveCount(1);
  await expect
    .poll(async () => {
      const body = (await (await request.get('/api/canvas/ax/presence')).json()) as {
        presences: Array<{ attached: boolean; focusNodeId: string | null; opCount: number }>;
      };
      return body.presences.find((entry) => entry.attached)?.focusNodeId;
    })
    .toBe(added.id);

  // Steer from the command bar.
  const steer = bar.getByLabel('Steer the agent');
  await steer.fill('Keep the spec node as the source of truth');
  await steer.press('Enter');
  await expect(steer).toHaveValue('');
  await expect
    .poll(async () => {
      const body = (await (await request.get('/api/canvas/ax/timeline?limit=20')).json()) as {
        steering: Array<{ message: string }>;
      };
      return body.steering.some((entry) => entry.message === 'Keep the spec node as the source of truth');
    })
    .toBe(true);
  await expect(
    page.locator('.session-panel .session-timeline-row').filter({ hasText: 'Keep the spec node' }),
  ).toHaveCount(1);

  // End it from the panel → quiet board + receipt.
  await page.locator('.session-panel').getByRole('button', { name: 'End' }).click();
  await expect(shell).toHaveAttribute('data-session-active', 'false');
  await expect(page.locator('.session-panel')).toHaveCount(0);
  await expect(page.locator('.command-bar')).toHaveCount(0);
  await expect(page.locator('.context-pin-bar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start agent session' })).toBeVisible();
  const receipt = page.locator('[data-testid="session-receipt"]');
  await expect(receipt).toBeVisible();
  await expect(receipt.locator('.session-receipt-tile-value')).toHaveText(['0', '0', '0']);

  // View diff = what the session did: one node added, nothing removed.
  await receipt.getByRole('button', { name: 'View diff' }).click();
  await expect(receipt.locator('[data-testid="session-receipt-diff"]')).toHaveText(
    'This session: 1 added · 0 removed · 0 modified',
  );

  // History opens the History drawer (item 8): the session is an entry with
  // the same diff and a pre-state restore.
  await receipt.getByRole('button', { name: 'History' }).click();
  const drawer = page.locator('[data-testid="history-drawer"]');
  await expect(drawer).toBeVisible();
  const entry = drawer.locator('[data-testid="history-session"]').first();
  await expect(entry.locator('.snapshot-item-name')).toHaveText('Agent session — Agent session');
  await entry.getByRole('button', { name: 'View diff' }).click();
  await expect(entry.locator('.snapshot-item-diff')).toContainText('1 added · 0 removed · 0 modified');
  await entry.getByRole('button', { name: 'Restore pre-state' }).click();
  await entry.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('.canvas-node').filter({ hasText: 'Agent note' })).toHaveCount(0);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Spec' })).toHaveCount(1);
  await expect(drawer).toHaveCount(0);

  await receipt.getByRole('button', { name: 'Dismiss receipt' }).click();
  await expect(receipt).toHaveCount(0);
});

test('shared undo: the panel undoes the agent’s latest edit and tells it; Ctrl+Z works the same stack', async ({
  page,
  request,
}) => {
  // rail-chrome-v2 phase 7, item 10.
  await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'Human note', content: 'mine', x: 120, y: 120, width: 300, height: 160 },
    headers: { 'x-pmx-workbench': '1' },
  });
  await request.post('/api/canvas/ax/activity', {
    data: { kind: 'session-start', title: 'Claude', source: 'copilot' },
  });
  await page.goto('/workbench');
  await expect(page.locator('.session-panel')).toBeVisible();

  // The agent writes: the timeline shows it as an Update with the undo affordance.
  await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'Agent draft', content: 'draft', x: 520, y: 120, width: 300, height: 160 },
  });
  await expect(page.locator('.canvas-node').filter({ hasText: 'Agent draft' })).toHaveCount(1);
  const row = page.locator('.session-timeline-row').filter({ hasText: 'Created markdown “Agent draft”' });
  await expect(row).toHaveCount(1);
  await row.getByTestId('timeline-undo').click();
  await expect(page.locator('.canvas-node').filter({ hasText: 'Agent draft' })).toHaveCount(0);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Human note' })).toHaveCount(1);
  await expect(row.locator('.session-timeline-undone')).toHaveText('undone · steering sent');
  await expect
    .poll(async () => {
      const body = (await (await request.get('/api/canvas/ax/timeline?limit=20')).json()) as {
        steering: Array<{ message: string }>;
      };
      return body.steering.some((entry) => entry.message.startsWith('Undid your edit: Created markdown “Agent draft”'));
    })
    .toBe(true);

  // A human edit on top: no undo affordance on the agent row; Ctrl+Z undoes the human's.
  await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'Human second', content: 'x', x: 120, y: 420, width: 300, height: 160 },
    headers: { 'x-pmx-workbench': '1' },
  });
  await expect(page.locator('.canvas-node').filter({ hasText: 'Human second' })).toHaveCount(1);
  await expect(page.locator('[data-testid="timeline-undo"]')).toHaveCount(0);
  await page.locator('.canvas-viewport').click({ position: { x: 900, y: 700 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.canvas-node').filter({ hasText: 'Human second' })).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('.canvas-node').filter({ hasText: 'Human second' })).toHaveCount(1);

  await request.post('/api/canvas/ax/activity', { data: { kind: 'session-end', title: 'done', source: 'copilot' } });
});

test('keyboard: arrow keys traverse nodes spatially, Enter opens, overlays trap and restore focus', async ({
  page,
  request,
}) => {
  // rail-chrome-v2 item 18.
  await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'Key A', content: 'a', x: 100, y: 100, width: 240, height: 120 },
  });
  await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'Key B', content: 'b', x: 500, y: 110, width: 240, height: 120 },
  });
  await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'Key C', content: 'c', x: 120, y: 400, width: 240, height: 120 },
  });
  await request.post('/api/canvas/viewport', { data: { x: 0, y: 0, scale: 1 } });
  await page.goto('/workbench');

  const a = page.locator('.canvas-node').filter({ hasText: 'Key A' });
  await a.click({ position: { x: 120, y: 90 } });
  await a.focus();
  await expect(a).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.canvas-node').filter({ hasText: 'Key B' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(a).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const c = page.locator('.canvas-node').filter({ hasText: 'Key C' });
  await expect(c).toBeFocused();

  // Enter opens the focused node; the overlay traps focus and Esc restores it.
  await page.keyboard.press('Enter');
  const overlay = page.locator('.expanded-overlay-panel');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator(':focus')).toHaveCount(1);
  for (let i = 0; i < 12; i += 1) await page.keyboard.press('Tab');
  await expect(overlay.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await expect(c).toBeFocused();
});

test('human presence: two tabs see each other’s cursors, a grab locks the node for agents and yields an agent intent', async ({
  browser,
  request,
}) => {
  // rail-chrome-v2 phase 8, items 5 and 6.
  const node = (await (
    await request.post('/api/canvas/node', {
      data: { type: 'markdown', title: 'Shared note', content: 'x', x: 200, y: 160, width: 300, height: 160 },
    })
  ).json()) as { id: string };
  await request.post('/api/canvas/viewport', { data: { x: 0, y: 0, scale: 1 } });

  const mia = await browser.newContext();
  const sam = await browser.newContext();
  const miaPage = await mia.newPage();
  const samPage = await sam.newPage();
  await miaPage.goto('/workbench?name=mia');
  await samPage.goto('/workbench?name=sam');
  await expect(miaPage.locator('.canvas-node').filter({ hasText: 'Shared note' })).toHaveCount(1);
  await expect(samPage.locator('.canvas-node').filter({ hasText: 'Shared note' })).toHaveCount(1);

  // mia moves her pointer: sam sees a green cursor tagged "mia" (never his own).
  const region = await miaPage.locator('.canvas-region').boundingBox();
  await miaPage.mouse.move(region!.x + 600, region!.y + 500);
  await miaPage.mouse.move(region!.x + 620, region!.y + 520);
  const miaCursor = samPage.locator('.human-cursor').filter({ hasText: 'mia' });
  await expect(miaCursor).toHaveCount(1);
  await expect(samPage.locator('.human-cursor').filter({ hasText: 'sam' })).toHaveCount(0);
  await expect(miaPage.locator('.human-cursor').filter({ hasText: 'mia' })).toHaveCount(0);

  // An agent signals an edit on the note; mia grabs it mid-edit → the agent
  // yields (intent vetoed, Yield in the timeline) and the node wears the pill.
  await request.post('/api/canvas/ax/activity', {
    data: { kind: 'session-start', title: 'Claude', source: 'copilot' },
  });
  await request.post('/api/canvas/ax/intent', {
    data: { id: 'e2e-yield', kind: 'edit', nodeId: node.id, label: 'Rewrite the note', ttlMs: 30000 },
  });
  await expect(miaPage.locator('.intent-ghost, .ghost-intent, [data-intent-id="e2e-yield"]').first()).toBeVisible();
  const bar = await miaPage
    .locator('.canvas-node')
    .filter({ hasText: 'Shared note' })
    .locator('.node-titlebar')
    .boundingBox();
  await miaPage.mouse.move(bar!.x + bar!.width / 2, bar!.y + bar!.height / 2);
  await miaPage.mouse.down();
  await miaPage.mouse.move(bar!.x + bar!.width / 2 + 30, bar!.y + bar!.height / 2 + 10, { steps: 4 });
  await expect(miaPage.locator('[data-testid="yield-pill"]')).toHaveText('mia took over — agent yielded');

  // While she holds it, an agent write to that node is refused (409); others pass.
  const blocked = await request.patch(`/api/canvas/node/${node.id}`, { data: { title: 'Agent retitle' } });
  expect(blocked.status()).toBe(409);
  await miaPage.mouse.up();
  await expect
    .poll(async () =>
      (await request.patch(`/api/canvas/node/${node.id}`, { data: { title: 'Agent retitle' } })).status(),
    )
    .toBe(200);
  await expect
    .poll(async () => {
      const body = (await (await request.get('/api/canvas/ax/timeline?limit=20')).json()) as {
        events: Array<{ kind: string; summary: string }>;
        steering: Array<{ message: string }>;
      };
      return (
        body.events.some((event) => event.kind === 'yield' && event.summary.includes('mia grabbed')) &&
        body.steering.some((steer) => steer.message.includes('took over'))
      );
    })
    .toBe(true);
  // The vetoed intent is gone from every tab (the server cleared it).
  await expect(samPage.locator('[data-intent-id="e2e-yield"]')).toHaveCount(0);

  await request.post('/api/canvas/ax/activity', { data: { kind: 'session-end', title: 'done', source: 'copilot' } });
  await mia.close();
  await sam.close();
});

test('edge creation: Connect tool drags an edge from a node body, the target lights up, L labels it, Esc cancels', async ({
  page,
  request,
}) => {
  // rail-chrome-v2 item 15.
  await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'Edge A', content: 'a', x: 120, y: 120, width: 260, height: 140 },
  });
  await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'Edge B', content: 'b', x: 620, y: 140, width: 260, height: 140 },
  });
  await request.post('/api/canvas/viewport', { data: { x: 0, y: 0, scale: 1 } });
  await page.goto('/workbench');
  await page.getByRole('button', { name: 'Connect (C)' }).click();
  const a = page.locator('.canvas-node').filter({ hasText: 'Edge A' });
  const b = page.locator('.canvas-node').filter({ hasText: 'Edge B' });
  const aBox = await a.boundingBox();
  const bBox = await b.boundingBox();
  await page.mouse.move(aBox!.x + 120, aBox!.y + 90);
  await page.mouse.down();
  await page.mouse.move(aBox!.x + 300, aBox!.y + 100, { steps: 6 });
  await expect(page.locator('[data-testid="edge-hint"]')).toContainText('drag onto a node');
  await page.mouse.move(bBox!.x + 120, bBox!.y + 90, { steps: 6 });
  await expect(page.locator('[data-testid="edge-hint"]')).toContainText('release to connect');
  await expect(b).toHaveClass(/is-edge-target/);
  // Esc cancels — nothing is created.
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(((await (await request.get('/api/canvas/state')).json()) as { edges: unknown[] }).edges).toHaveLength(0);

  // Again, with L: the label prompt fills the edge label.
  page.once('dialog', (dialog) => void dialog.accept('depends'));
  await page.mouse.move(aBox!.x + 120, aBox!.y + 90);
  await page.mouse.down();
  await page.mouse.move(bBox!.x + 120, bBox!.y + 90, { steps: 6 });
  await page.keyboard.press('l');
  await expect(page.locator('[data-testid="edge-hint"]')).toContainText('label on');
  await page.mouse.up();
  await expect
    .poll(async () => {
      const state = (await (await request.get('/api/canvas/state')).json()) as { edges: Array<{ label?: string }> };
      return state.edges.map((edge) => edge.label ?? '').join(',');
    })
    .toBe('depends');
  await page.keyboard.press('v');
});

test('groups v2: membership only on release with the pill, esc keeps it out, collapse to a chip, header actions, G / Shift+G', async ({
  page,
  request,
}) => {
  // rail-chrome-v2 phase 7, item 20.
  const group = (await (
    await request.post('/api/canvas/group', {
      data: { title: 'State layer', x: 100, y: 100, width: 600, height: 360 },
    })
  ).json()) as { id: string };
  const loose = (await (
    await request.post('/api/canvas/node', {
      data: {
        type: 'markdown',
        title: 'Loose note',
        content: '- a deliberately long bullet line that wraps inside this narrow card\n- second',
        x: 900,
        y: 120,
        width: 240,
        height: 120,
      },
    })
  ).json()) as { id: string };
  await request.post('/api/canvas/viewport', { data: { x: 0, y: 0, scale: 1 } });
  await page.goto('/workbench');

  const frame = page.locator('.canvas-node.group-node').filter({ hasText: 'State layer' });
  await expect(frame.locator('.group-name')).toHaveText('State layer');
  await expect(frame.locator('.group-count')).toHaveText('0');
  const looseNode = page.locator('.canvas-node').filter({ hasText: 'Loose note' });

  // Drag the loose node over the frame and press Esc: the pill disappears and
  // membership is NOT changed on release.
  const grab = async () => {
    const bar = await looseNode.locator('.node-titlebar').boundingBox();
    await page.mouse.move(bar!.x + bar!.width / 2, bar!.y + bar!.height / 2);
    await page.mouse.down();
  };
  await grab();
  await page.mouse.move(400, 320, { steps: 10 });
  await expect(page.locator('[data-testid="drop-pill"]')).toHaveText(/release to add to State layer/);
  await expect(frame).toHaveClass(/is-drop-target/);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="drop-pill"]')).toHaveCount(0);
  await page.mouse.move(420, 330, { steps: 3 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        ((await (await request.get(`/api/canvas/node/${group.id}`)).json()) as { data: { children: string[] } }).data
          .children,
    )
    .toEqual([]);

  // Drag again without Esc: release while the pill shows → it joins.
  await grab();
  await page.mouse.move(380, 300, { steps: 10 });
  await expect(page.locator('[data-testid="drop-pill"]')).toBeVisible();
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        ((await (await request.get(`/api/canvas/node/${group.id}`)).json()) as { data: { children: string[] } }).data
          .children,
    )
    .toEqual([loose.id]);
  await expect(frame.locator('.group-count')).toHaveText('1');

  // Drag it fully out: the inverse pill, and it leaves on release.
  await grab();
  await page.mouse.move(1100, 700, { steps: 12 });
  await expect(page.locator('[data-testid="drop-pill"]')).toHaveText(/release to remove from State layer/);
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        ((await (await request.get(`/api/canvas/node/${group.id}`)).json()) as { data: { children: string[] } }).data
          .children,
    )
    .toEqual([]);

  // G groups a selection; the frame header collapses to a chip that hides the children.
  const second = (await (
    await request.post('/api/canvas/node', {
      data: { type: 'status', title: 'Second note', content: 's', x: 1300, y: 700, width: 260, height: 140 },
    })
  ).json()) as { id: string };
  await looseNode.click({ position: { x: 80, y: 80 }, modifiers: ['Shift'] });
  await page
    .locator('.canvas-node')
    .filter({ hasText: 'Second note' })
    .click({ position: { x: 80, y: 80 }, modifiers: ['Shift'] });
  await page.keyboard.press('g');
  const made = page.locator('.canvas-node.group-node').filter({ hasText: 'Group' }).first();
  await expect(made.locator('.group-count')).toHaveText('2');
  expect(second.id).toBeTruthy();

  await made.getByRole('button', { name: 'Collapse group' }).click();
  const chip = page.locator('[data-testid="group-chip"]');
  await expect(chip).toBeVisible();
  await expect(chip.locator('.group-chip-count')).toHaveText('2 nodes');
  await expect(page.locator('.canvas-node').filter({ hasText: 'Loose note' })).toHaveCount(0);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Second note' })).toHaveCount(0);
  await chip.getByRole('button', { name: /Expand group/ }).click();
  await expect(page.locator('.canvas-node').filter({ hasText: 'Loose note' })).toHaveCount(1);

  // The frame's ⋯ menu must paint ABOVE its member cards (the frame itself
  // stacks below them by design) — and node-body lists hang-indent their wraps.
  await made.getByRole('button', { name: 'Group menu' }).click();
  const onTop = await page.evaluate(() => {
    const menu = document.querySelector('.group-menu');
    if (!menu) return 'no menu';
    const rect = menu.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + 30, rect.top + rect.height / 2);
    return hit?.closest('.group-menu') ? 'menu' : (hit?.className ?? 'nothing');
  });
  expect(onTop).toBe('menu');
  await made.getByRole('button', { name: 'Group menu' }).click();
  expect(
    await page.evaluate(() => {
      const list = document.querySelector('.canvas-node .node-body ul');
      return list ? getComputedStyle(list).listStylePosition : 'no list';
    }),
  ).toBe('outside');

  // The ⋯ menu pins all children; Shift+G dissolves the selection's group —
  // the frame goes, the children stay, and one Ctrl+Z brings the frame back.
  await made.getByRole('button', { name: 'Group menu' }).click();
  await made.getByRole('menuitem', { name: 'Pin all to context' }).click();
  await expect(page.locator('.context-pin-bar')).toContainText('2 nodes in context');
  await page
    .locator('.canvas-node')
    .filter({ hasText: 'Loose note' })
    .click({ position: { x: 80, y: 80 }, modifiers: ['Shift'] });
  await page.keyboard.press('Shift+G');
  await expect(made).toHaveCount(0);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Loose note' })).toHaveCount(1);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Second note' })).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(made.locator('.group-count')).toHaveText('2');

  // Delete removes the selection from the keyboard; Backspace does the same for the focused node.
  await page
    .locator('.canvas-node')
    .filter({ hasText: 'Second note' })
    .click({ position: { x: 80, y: 80 }, modifiers: ['Shift'] });
  await page.keyboard.press('Delete');
  await expect(page.locator('.canvas-node').filter({ hasText: 'Second note' })).toHaveCount(0);
  await page
    .locator('.canvas-node')
    .filter({ hasText: 'Loose note' })
    .click({ position: { x: 80, y: 80 } });
  await page.keyboard.press('Backspace');
  await expect(page.locator('.canvas-node').filter({ hasText: 'Loose note' })).toHaveCount(0);
});

test('ungroup is the same action for the human and the agent: dissolve, children released, one undo step each', async ({
  page,
  request,
}) => {
  // Two identical collapsed groups; the human dissolves one from the ⋯ menu,
  // the agent dissolves the other over HTTP as claude-code.
  const build = async (tag: string, x: number) => {
    const note = async (title: string, nx: number, ny: number) =>
      (
        await (
          await request.post('/api/canvas/node', {
            data: { type: 'markdown', title, content: title, x: nx, y: ny, width: 240, height: 120 },
          })
        ).json()
      ).id as string;
    const a = await note(`${tag} A`, x, 100);
    const b = await note(`${tag} B`, x + 300, 100);
    const group = (
      await (await request.post('/api/canvas/group', { data: { title: `${tag} group`, childIds: [a, b] } })).json()
    ).id as string;
    await request.patch(`/api/canvas/node/${group}`, { data: { collapsed: true } });
    return { a, b, group };
  };
  const human = await build('H', 100);
  const agent = await build('G', 1000);
  await request.post('/api/canvas/viewport', { data: { x: 0, y: 0, scale: 0.8 } });
  await page.goto('/workbench');
  const chips = page.locator('[data-testid="group-chip"]');
  await expect(chips).toHaveCount(2);
  await expect(page.locator('.canvas-node').filter({ hasText: 'H A' })).toHaveCount(0);

  // Human: expand the chip, ⋯ → Ungroup.
  await chips
    .filter({ hasText: 'H group' })
    .getByRole('button', { name: /Expand group/ })
    .click();
  const frame = page.locator('.canvas-node.group-node').filter({ hasText: 'H group' });
  await frame.getByRole('button', { name: 'Group menu' }).click();
  await frame.getByRole('menuitem', { name: 'Ungroup' }).click();
  // Agent: the same op, no browser involved.
  const response = await request.post('/api/canvas/group/ungroup', {
    data: { groupId: agent.group },
    headers: { 'x-pmx-source': 'claude-code' },
  });
  expect((await response.json()).title).toBe('G group');

  // Both frames gone, all four children visible and free.
  await expect(page.locator('.canvas-node.group-node')).toHaveCount(0);
  await expect(chips).toHaveCount(0);
  for (const title of ['H A', 'H B', 'G A', 'G B']) {
    await expect(page.locator('.canvas-node').filter({ hasText: title })).toBeVisible();
  }
  const state = (await (await request.get('/api/canvas/state')).json()) as {
    nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>;
  };
  expect(state.nodes.filter((node) => node.type === 'group')).toHaveLength(0);
  expect(state.nodes.map((node) => node.data.parentGroup ?? null)).toEqual([null, null, null, null]);
  const history = (await (await request.get('/api/canvas/history')).json()) as {
    entries: Array<{ description: string; actor?: string }>;
  };
  // The history ring buffer outlives the board clear between tests — look at OUR two frames only.
  const dissolves = history.entries.filter((entry) => /^Dissolved group "[HG] group"/.test(entry.description));
  expect(dissolves.map((entry) => [entry.description, entry.actor]).sort()).toEqual([
    ['Dissolved group "G group" — 2 nodes released', 'agent'],
    ['Dissolved group "H group" — 2 nodes released', 'human'],
  ]);

  // One shared stack: undo the agent's dissolve, the human's dissolve, then the
  // human's chip expand. Both collapsed chips hide their children again — which
  // only happens if the undo re-parented the children to the restored frames.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(chips).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(
    page.locator('.canvas-node.group-node').filter({ hasText: 'H group' }).locator('.group-count'),
  ).toHaveText('2');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(chips).toHaveCount(2);
  await expect(page.locator('.canvas-node').filter({ hasText: 'G A' })).toHaveCount(0);
  await expect(page.locator('.canvas-node').filter({ hasText: 'H A' })).toHaveCount(0);
  const restored = (await (await request.get('/api/canvas/state')).json()) as {
    nodes: Array<{ id: string; data: Record<string, unknown> }>;
  };
  expect(restored.nodes.find((node) => node.id === human.a)?.data.parentGroup).toBe(human.group);
  expect(restored.nodes.find((node) => node.id === agent.b)?.data.parentGroup).toBe(agent.group);
});

test('minimap v2: true-scale rects from the store, selection mirrored, click jumps, hover magnifies', async ({
  page,
  request,
}) => {
  // rail-chrome-v2 phase 7, item 19.
  const a = (await (
    await request.post('/api/canvas/node', {
      data: { type: 'markdown', title: 'Map A', content: 'a', x: 100, y: 100, width: 300, height: 200 },
    })
  ).json()) as { id: string };
  await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'Map B', content: 'b', x: 2400, y: 1600, width: 300, height: 200 },
  });
  await request.post('/api/canvas/node', {
    data: { type: 'group', title: 'Map group', x: 900, y: 900, width: 600, height: 400, children: [] },
  });
  await request.post('/api/canvas/viewport', { data: { x: 0, y: 0, scale: 1 } });
  await page.goto('/workbench');

  const minimap = page.locator('[data-testid="minimap"]');
  await expect(minimap).toBeVisible();
  await expect(minimap.locator('.minimap-node')).toHaveCount(3);
  await expect(minimap.locator('.minimap-node.is-group')).toHaveCount(1);
  await expect(minimap.locator('.minimap-zoom')).toHaveText('100%');
  const rest = await minimap.boundingBox();
  expect(Math.round(rest!.width)).toBe(168);
  expect(Math.round(rest!.height)).toBe(112);

  // The map is true-scale: A (300×200 at 100,100) and B (same size) render the same size.
  const rects = await minimap
    .locator('.minimap-node:not(.is-group)')
    .evaluateAll((els) =>
      els.map((el) => ({ w: (el as HTMLElement).offsetWidth, h: (el as HTMLElement).offsetHeight })),
    );
  expect(Math.abs(rects[0]!.w - rects[1]!.w)).toBeLessThanOrEqual(1);
  expect(Math.abs(rects[0]!.h - rects[1]!.h)).toBeLessThanOrEqual(1);

  // Selection outlines mirror onto the map.
  await page
    .locator('.canvas-node')
    .filter({ hasText: 'Map A' })
    .click({ position: { x: 150, y: 120 }, modifiers: ['Shift'] });
  await expect(minimap.locator('.minimap-node.is-selected')).toHaveCount(1);
  expect(a.id).toBeTruthy();

  // Clicking the far corner jumps the viewport toward B.
  const before = await page.locator('.canvas-node').filter({ hasText: 'Map B' }).boundingBox();
  await minimap.hover();
  await expect.poll(async () => Math.round((await minimap.boundingBox())!.width)).toBeGreaterThan(260);
  const box = await minimap.boundingBox();
  await page.mouse.click(box!.x + box!.width - 8, box!.y + box!.height - 8);
  await expect
    .poll(async () => {
      const after = await page.locator('.canvas-node').filter({ hasText: 'Map B' }).boundingBox();
      return after && before ? after.x < before.x : false;
    })
    .toBe(true);
});

test('external steering: indicator + activity feed + writers sheet for session-less writers, gone once a session attaches', async ({
  page,
  request,
}) => {
  // rail-chrome-v2 phase 6. Two external writers (an identified MCP agent and
  // a plain HTTP caller) write with no session attached. Unattached writers
  // from earlier tests may still be live (in-memory, 90 s TTL), so the
  // assertions below are about OUR writers, not exact totals.
  await page.goto('/workbench');

  await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'sse-bridge', content: 'notes', x: 120, y: 120, width: 280, height: 140 },
    headers: { 'x-pmx-source': 'claude-code' },
  });
  await request.post('/api/canvas/node', {
    data: { type: 'status', title: 'Store health', content: 'ok', x: 480, y: 120, width: 260, height: 140 },
  });

  const indicator = page.locator('[data-testid="external-indicator"]');
  await expect(indicator).toBeVisible();
  await expect(indicator.locator('.external-indicator-label')).toHaveText(/^\d+ writers$/);
  await expect(indicator.locator('.external-indicator-ops')).toHaveText(/^\d+ ops$/);
  // Still the quiet board: no session chrome.
  await expect(page.locator('.app-shell')).toHaveAttribute('data-session-active', 'false');
  await expect(page.locator('.session-panel')).toHaveCount(0);

  await indicator.click();
  const feed = page.locator('[data-testid="activity-feed"]');
  await expect(feed).toBeVisible();
  await expect(feed.locator('.activity-feed-title')).toHaveText(/^External activity — \d+ writers$/);
  const rows = feed.locator('[data-testid="activity-row"] .activity-text');
  await expect(rows.nth(0)).toHaveText('Created status “Store health”');
  await expect(rows.nth(1)).toHaveText('Created markdown “sse-bridge”');
  await expect(feed.locator('[data-testid="activity-row"] .activity-writer').nth(0)).toHaveText('api');
  await expect(feed.locator('[data-testid="activity-row"] .activity-writer').nth(1)).toHaveText('claude-code');

  // Per-writer filter: only claude-code rows remain (earlier tests' claude-code
  // writes may still be in the feed), ours on top.
  await feed.locator('.activity-filter', { hasText: 'claude-code' }).click();
  await expect(rows.first()).toHaveText('Created markdown “sse-bridge”');
  await expect
    .poll(async () => new Set(await feed.locator('[data-testid="activity-row"] .activity-writer').allInnerTexts()))
    .toEqual(new Set(['claude-code']));

  // The feed is live: a new write lands at the top without a reload.
  await feed.locator('.activity-filter', { hasText: 'All' }).click();
  await request.patch(`/api/canvas/node/${(await (await request.get('/api/canvas/state')).json()).nodes[0].id}`, {
    data: { title: 'sse-bridge (v2)' },
    headers: { 'x-pmx-source': 'claude-code' },
  });
  await expect(rows.first()).toHaveText('Updated “sse-bridge (v2)”');

  // Writers sheet: visibility only.
  await feed.getByRole('button', { name: 'Writers' }).click();
  const sheet = page.locator('[data-testid="writers-sheet"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.writers-row', { hasText: 'claude-code' }).locator('.writers-meta')).toHaveText(
    /^wrote (now|\d+s) ago$/,
  );
  await expect(sheet.locator('.writers-row', { hasText: 'api' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(feed).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(feed).toHaveCount(0);

  // Upgrading to a session retires the indicator: the chip takes over.
  await indicator.click();
  await feed.getByRole('button', { name: 'Start session ↗' }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-session-active', 'true');
  await expect(page.locator('[data-testid="external-indicator"]')).toHaveCount(0);
  await expect(feed).toHaveCount(0);
  await expect(page.locator('.agent-chip')).toBeVisible();
});

test('rail popovers anchor beside their trigger on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/workbench');
  const button = page.getByRole('button', { name: 'Annotate (A)' });
  await button.click();
  const menu = page.locator('.toolbar-menu');
  await expect(menu).toBeVisible();
  const buttonBox = await button.boundingBox();
  const menuBox = await menu.boundingBox();
  if (!buttonBox || !menuBox) throw new Error('missing bounding boxes');
  expect(Math.abs(menuBox.x - (buttonBox.x + buttonBox.width + 8))).toBeLessThan(24);
});

test('an Amp orb page boots straight on the polling transport (no SSE attempt)', async ({ page }) => {
  // The server stamps window.__PMX_AMP_ORB into orb-served pages; simulate it
  // before any bundle code runs. The portal proxy buffers SSE, so orb pages
  // must never wait out the SSE watchdog before polling.
  await page.addInitScript(() => {
    (window as unknown as { __PMX_AMP_ORB?: boolean }).__PMX_AMP_ORB = true;
  });
  let sseRequested = false;
  page.on('request', (req) => {
    if (req.url().includes('/api/workbench/events')) sseRequested = true;
  });
  const firstPoll = page.waitForRequest('**/api/workbench/poll*');
  await page.goto('/workbench');
  await firstPoll;
  await expect(page.locator('#canvasBootstrap')).toHaveClass(/ready/);
  expect(sseRequested).toBe(false);
});

test('the size floor survives the browser: a clamped node is not shrunk by auto-fit', async ({ page, request }) => {
  // Finding AA (0.4.6 report): the server clamped a 200x100 markdown create up
  // to 360x180, then the connected workbench's DOM auto-fit persisted 360x132.
  //
  // Scope note: the discriminating guard for that defect is the unit test in
  // client-auto-fit.test.ts (it fails without the floor, reproducing 132
  // exactly). The shrink needs a first-paint race — `.node-body` normally
  // stretches to the node height, so `scrollHeight` cannot fall below it unless
  // the ResizeObserver fires before the height style lands — which does not
  // reproduce deterministically here. THIS test covers the end-to-end half the
  // report asked for: the size the server still holds after a real browser has
  // rendered the node and auto-fit has settled.
  await page.goto('/workbench');
  await expect(page.locator('.canvas-viewport')).toBeVisible();

  const created = await request.post('/api/canvas/node', {
    data: { type: 'markdown', title: 'Floor probe', content: 'tiny', x: 220, y: 2600, width: 200, height: 100 },
  });
  const { id } = (await created.json()) as { id: string };

  // The creation clamp itself.
  const afterCreate = (await (await request.get(`/api/canvas/node/${id}`)).json()) as {
    size: { width: number; height: number };
  };
  expect(afterCreate.size).toEqual({ width: 360, height: 180 });

  await expect(page.locator('.canvas-node').filter({ hasText: 'Floor probe' })).toBeVisible();

  // Auto-fit runs on a ResizeObserver and persists through a debounced write.
  // Deliberately WAIT for that to settle and then assert once: polling until
  // the height is >= 180 would pass on the first sample (the node starts at
  // 180) and never observe the shrink this test exists to catch.
  await page.waitForTimeout(2500);
  const settled = (await (await request.get(`/api/canvas/node/${id}`)).json()) as {
    size: { width: number; height: number };
  };
  expect(settled.size.height).toBeGreaterThanOrEqual(180);

  // And validate must not report it as undersized.
  const validation = (await (await request.get('/api/canvas/validate')).json()) as {
    sizeWarnings: Array<{ id: string }>;
  };
  expect(validation.sizeWarnings.some((w) => w.id === id)).toBe(false);

  await request.delete(`/api/canvas/node/${id}`);
});
