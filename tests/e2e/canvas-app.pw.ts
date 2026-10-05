import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let client: Client;
let transport: StdioClientTransport;
let hostJs: string;
let appHtml: string;
const temp = mkdtempSync(join(tmpdir(), 'pmx-app-browser-'));
test.use({ deviceScaleFactor: 2 });
test.beforeAll(async ({ baseURL }) => {
  execFileSync('bun', ['build', 'tests/fixtures/canvas-app-host.ts', '--target=browser', `--outfile=${temp}/host.js`]);
  hostJs = readFileSync(`${temp}/host.js`, 'utf8');
  transport = new StdioClientTransport({
    command: 'bun',
    args: ['run', process.env.PMX_APP_TEST_CLI ?? resolve('src/cli/index.ts'), '--mcp-app'],
    env: { ...process.env, PMX_CANVAS_URL: baseURL!, PMX_CANVAS_DISABLE_BROWSER_OPEN: '1' },
    stderr: 'pipe',
  });
  client = new Client({ name: 'app-browser-test', version: '1' });
  await client.connect(transport);
  const resource = (await client.readResource({ uri: 'ui://pmx/canvas' })).contents[0]!;
  if (!('text' in resource)) throw new Error('Missing app HTML');
  appHtml = resource.text;
});
test.afterAll(async () => {
  await client?.close();
  await transport?.close();
  rmSync(temp, { recursive: true, force: true });
});

async function mount(page: Page, query = '') {
  await page.route('**/app-host**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body><script type="module" src="/test-host.js"></script></body></html>',
    }),
  );
  await page.route('**/test-host.js', (route) => route.fulfill({ contentType: 'text/javascript', body: hostJs }));
  await page.route('**/test-resource', (route) => route.fulfill({ contentType: 'text/html', body: appHtml }));
  await page.route('**/test-tool', async (route) => {
    const input = route.request().postDataJSON() as { name: string; arguments?: Record<string, unknown> };
    await route.fulfill({ json: await client.callTool(input) });
  });
  await page.goto(`/app-host${query}`);
  return page.frameLocator('iframe');
}
async function board(request: APIRequestContext, name: string) {
  const { board } = await (await request.post('/api/canvas/boards', { data: { name } })).json();
  expect((await request.post('/api/canvas/boards/open', { data: { id: board.id } })).ok()).toBe(true);
  return board.id as string;
}
async function note(request: APIRequestContext, title: string, x = 80) {
  return (
    await (
      await request.post('/api/canvas/node', {
        data: {
          type: 'markdown',
          title,
          content: `# ${title}\n\nFull PMX workbench, shared with ChatGPT.`,
          x,
          y: 90,
          width: 360,
          height: 260,
        },
      })
    ).json()
  ).id as string;
}
async function capture(page: Page, name: string) {
  if (!process.env.PMX_APP_SCREENSHOTS) return;
  mkdirSync(process.env.PMX_APP_SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: join(process.env.PMX_APP_SCREENSHOTS, name) });
}

test('hosted Markdown cannot execute in the document that owns the MCP bridge', async ({ page, request }) => {
  await board(request, 'Markdown boundary');
  const { id } = await (
    await request.post('/api/canvas/node', {
      data: {
        type: 'markdown',
        title: 'Safe Markdown',
        x: 80,
        y: 90,
        width: 500,
        height: 520,
        content: [
          '<img src="data:image/png;base64,bm90YW5pbWFnZQ==" onerror="document.body.dataset.markdownXss=\'executed\'">',
          '<svg onload="document.body.dataset.markdownXss=\'executed\'"></svg>',
          '<a href="javascript:document.body.dataset.markdownXss=\'executed\'">Unsafe link</a>',
          '',
          '## Preserved heading',
          '',
          '| Column |',
          '| --- |',
          '| Preserved cell |',
          '',
          '[Safe link](https://example.com/docs)',
          '',
          '- [x] Preserved task',
        ].join('\n'),
      },
    })
  ).json();
  const app = await mount(page);
  const card = app.locator(`.canvas-node[data-node-id="${id}"]`);
  await expect(card.getByRole('heading', { name: 'Preserved heading' })).toBeVisible();
  await expect(card.locator('table')).toContainText('Preserved cell');
  await expect(card.locator('input[type="checkbox"]')).toBeChecked();
  await expect(card.locator('a[href="https://example.com/docs"]')).toBeVisible();
  await expect(
    card.locator('.md-card-content').locator('svg, [onerror], [onload], a[href^="javascript:"]'),
  ).toHaveCount(0);
  await expect(app.locator('body')).not.toHaveAttribute('data-markdown-xss', 'executed');
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = app.locator('.md-reader-editable');
  await expect(editor.getByRole('heading', { name: 'Preserved heading' })).toBeVisible();
  await expect(editor.locator('svg, [onerror], [onload], a[href^="javascript:"]')).toHaveCount(0);
  await expect(app.locator('body')).not.toHaveAttribute('data-markdown-xss', 'executed');
});

test('real workbench creates boards, edits notes, drags and pins without a duplicate composer', async ({
  page,
  request,
}) => {
  // A long end-to-end flow: 18-23 s alone, 22-52 s inside a loaded parallel
  // run, so the default 30 s budget timed it out while every step still passed.
  test.setTimeout(60_000);
  await request.post('/api/canvas/boards/open', { data: { id: null } });
  const app = await mount(page);
  await expect(app.getByTestId('home-view')).toBeVisible();
  await app.getByRole('button', { name: 'New board', exact: true }).click();
  await app.getByRole('textbox', { name: 'Board name' }).fill('ChatGPT workbench');
  await app.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(app.getByRole('button', { name: /^Board: ChatGPT workbench/ })).toBeVisible();
  const id = await note(request, 'Launch checklist');
  const card = app.locator(`.canvas-node[data-node-id="${id}"]`);
  await expect(card).toBeVisible();
  await expect(app.getByRole('toolbar', { name: 'Canvas tools', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  const documentEditor = app.locator('.md-reader-editable');
  await expect(documentEditor).toHaveJSProperty('isContentEditable', true);
  await documentEditor.locator('p').fill('Rich-text editing uses the real PMX editor.');
  await documentEditor.press('Tab');
  await expect
    .poll(async () => (await (await request.get(`/api/canvas/node/${id}`)).json()).data.content)
    .toBe('# Launch checklist\n\nRich-text editing uses the real PMX editor.');
  await app.getByRole('button', { name: '</> Source', exact: true }).click();
  const editor = app.locator('.md-editor-expanded textarea');
  await editor.fill('# Launch checklist\n\nVerify real UI edits and selected context.');
  await app.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () => (await (await request.get(`/api/canvas/node/${id}`)).json()).data.content)
    .toContain('Verify real UI edits');
  await editor.fill('# Launch checklist\n\nSecond save keeps the revision current.');
  await app.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () => (await (await request.get(`/api/canvas/node/${id}`)).json()).data.content)
    .toContain('Second save');
  await app.getByTestId('expanded-node').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(app.getByTestId('expanded-node')).toHaveCount(0);
  const before = (await (await request.get(`/api/canvas/node/${id}`)).json()).position;
  const title = await card.locator('.node-title').boundingBox();
  await page.mouse.move(title!.x + 30, title!.y + 8);
  await page.mouse.down();
  await page.mouse.move(title!.x + 157, title!.y + 61, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await (await request.get(`/api/canvas/node/${id}`)).json()).position.x)
    .toBeGreaterThan(before.x + 80);
  await card.locator('.ctx-pin-btn').click();
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.pmxTestHost.contexts.at(-1)))).toContain(id);
  expect(await page.evaluate(() => window.pmxTestHost.messages.length)).toBe(0);
  await expect(app.locator('.pmx-host-bar')).toHaveCount(0);
  await expect(app.getByRole('button', { name: 'Ask ChatGPT', exact: true })).toHaveCount(0);
  await expect(app.getByRole('button', { name: /Start agent session/ })).toHaveCount(0);
  // An independently attached PMX session must not resurrect its local composer.
  await request.post('/api/canvas/ax/presence', { data: { source: 'composer-test', attached: true } });
  await expect(app.locator('.app-shell')).toHaveAttribute('data-session-active', 'true');
  await expect(app.locator('.command-bar')).toHaveCount(0);
  await request.post('/api/canvas/ax/presence', { data: { source: 'composer-test', attached: false } });
  await expect(app.locator('.app-shell')).toHaveAttribute('data-session-active', 'false');
  expect(await page.evaluate(() => window.pmxTestHost.messages.length)).toBe(0);
  await expect(app.locator('.intent-ghost')).toHaveCount(0, { timeout: 15_000 });
  await expect(app.locator('.attention-toast.attention-tone-remove')).toHaveCount(0);
  await capture(page, 'workbench-app-native.png');
  await page.reload();
  await expect(card).toBeVisible();
  await expect(card).toContainText('Second save');
  await app.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  await expect(app.getByTestId('home-view')).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.pmxTestHost.contexts.at(-1)))).not.toContain(id);
});

test('real source editor keeps a refused draft when another writer changes the note', async ({ page, request }) => {
  await board(request, 'Concurrent editing');
  const id = await note(request, 'Shared note');
  const app = await mount(page);
  await app.locator(`.canvas-node[data-node-id="${id}"]`).getByRole('button', { name: 'Edit', exact: true }).click();
  await app.getByRole('button', { name: '</> Source', exact: true }).click();
  const editor = app.locator('.md-editor-expanded textarea');
  await editor.fill('Keep my unsaved draft');
  await request.patch(`/api/canvas/node/${id}`, { data: { content: 'Another writer won' } });
  await app.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(app.locator('.attention-toast')).toContainText('This node changed');
  await expect(editor).toHaveValue('Keep my unsaved draft');
  expect((await (await request.get(`/api/canvas/node/${id}`)).json()).data.content).toBe('Another writer won');
  await capture(page, 'workbench-app-conflict.png');
});

test('background context retries without a footer and late launcher data cannot roll back the workbench', async ({
  page,
  request,
}) => {
  await board(request, 'Old launcher');
  const app = await mount(page, '?holdInitial');
  await expect.poll(() => page.evaluate(() => window.pmxTestHost.initialReady)).toBe(true);
  const newer = await board(request, 'Live board');
  const id = await note(request, 'Keep selected');
  await expect(app.getByRole('button', { name: /^Board: Live board/ })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(window.pmxTestHost.acknowledgedContexts.at(-1))))
    .toContain(newer);
  await expect(app.locator('.pmx-host-bar')).toHaveCount(0);
  await page.evaluate(() => {
    window.pmxTestHost.rejectContext = true;
  });
  const card = app.locator(`.canvas-node[data-node-id="${id}"]`);
  await card.locator('.md-card-content').click({ modifiers: ['Shift'] });
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.pmxTestHost.contexts.at(-1)))).toContain(id);
  const attempts = await page.evaluate(() => window.pmxTestHost.contexts.length);
  await expect.poll(() => page.evaluate(() => window.pmxTestHost.contexts.length)).toBeGreaterThan(attempts);
  expect(await page.evaluate(() => JSON.stringify(window.pmxTestHost.acknowledgedContexts.at(-1)))).not.toContain(id);
  const rejectedAttempts = await page.evaluate(() => window.pmxTestHost.contexts.length);
  await page.evaluate(() => {
    window.pmxTestHost.rejectContext = false;
    window.pmxTestHost.holdContext = true;
  });
  await expect.poll(() => page.evaluate(() => window.pmxTestHost.contexts.length)).toBeGreaterThan(rejectedAttempts);
  expect(await page.evaluate(() => JSON.stringify(window.pmxTestHost.acknowledgedContexts.at(-1)))).not.toContain(id);
  await page.evaluate(() => {
    window.pmxTestHost.holdContext = false;
    window.pmxTestHost.releaseContext();
  });
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(window.pmxTestHost.acknowledgedContexts.at(-1))))
    .toContain(id);
  await page.evaluate(async () => {
    window.pmxTestHost.failReads = true;
    await window.pmxTestHost.deliverInitial();
  });
  await expect(app.getByRole('button', { name: /^Board: Live board/ })).toBeVisible();
  await expect(card).toHaveClass(/selected/);
  expect(await page.evaluate(() => JSON.stringify(window.pmxTestHost.contexts.at(-1)))).toContain(newer);
  expect(await page.evaluate(() => window.pmxTestHost.messages.length)).toBe(0);
});

test('real HTML and Mermaid renderers work when the host permits local frames', async ({ page, request }) => {
  await board(request, 'PMX rich canvas');
  const id = await note(request, 'Real PMX canvas', 40);
  const html = await (
    await request.post('/api/canvas/node', {
      data: {
        type: 'html',
        title: 'Embedded HTML',
        content: '<h1 style="color:#4BBCFF">Live HTML renderer</h1><p>Existing PMX surface, delivered through MCP.</p>',
        x: 480,
        y: 90,
        width: 380,
        height: 260,
      },
    })
  ).json();
  const diagram = await (
    await request.post('/api/canvas/node', {
      data: {
        type: 'mermaid',
        title: 'Workflow',
        content: 'graph LR; A[PMX] --> B[MCP]; B --> C[ChatGPT];',
        x: 40,
        y: 430,
        width: 650,
        height: 300,
      },
    })
  ).json();
  const app = await mount(page, '?localFrames');
  await expect(app.locator(`.canvas-node[data-node-id="${id}"]`)).toBeVisible();
  await expect(
    app
      .locator(`[data-node-id="${html.id}"] iframe`)
      .contentFrame()
      .getByRole('heading', { name: 'Live HTML renderer' }),
  ).toBeVisible();
  await expect(app.locator(`[data-node-id="${diagram.id}"] iframe`).contentFrame().locator('svg')).toBeVisible({
    timeout: 20_000,
  });
  await app.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  await expect
    .poll(async () =>
      app.locator('.canvas-node').evaluateAll((cards) =>
        cards.every((card) => {
          const rect = card.getBoundingClientRect();
          return rect.top >= 40 && rect.left >= 48 && rect.bottom < innerHeight - 50 && rect.right <= innerWidth;
        }),
      ),
    )
    .toBe(true);
  await expect(app.locator('.attention-toast.attention-tone-remove')).toHaveCount(0);
  await capture(page, 'workbench-app-rich.png');
});

test('the real workbench fits a narrow host without optional context', async ({ page, request }) => {
  await board(request, 'Narrow workbench');
  const id = await note(request, 'Native PMX note', 30);
  await page.setViewportSize({ width: 600, height: 820 });
  const app = await mount(page, '?toolsOnly');
  await expect(app.locator(`.canvas-node[data-node-id="${id}"]`)).toBeVisible();
  await expect(app.getByRole('button', { name: 'Ask ChatGPT' })).toHaveCount(0);
  await expect(app.locator('.pmx-host-bar')).toHaveCount(0);
  await expect(app.getByText('Automatic context unavailable')).toHaveCount(0);
  expect(
    await app
      .locator('.app-shell')
      .evaluate((element) => Math.abs(element.getBoundingClientRect().bottom - innerHeight) < 1),
  ).toBe(true);
  expect(await page.evaluate(() => window.pmxTestHost.contexts.length)).toBe(0);
  await expect(app.locator('.intent-ghost')).toHaveCount(0, { timeout: 15_000 });
  await expect(app.locator('.attention-toast.attention-tone-remove')).toHaveCount(0);
  await capture(page, 'workbench-app-narrow.png');
});

test('curated structured notes and AX focus reach the host context', async ({ page, request }) => {
  await board(request, 'Structured host context');
  const status = await (
    await request.post('/api/canvas/node', {
      data: {
        type: 'status',
        title: 'Release status',
        x: 30,
        y: 90,
        width: 360,
        height: 260,
        data: { phase: 'testing', message: 'Status sentinel cobalt' },
      },
    })
  ).json();
  const focused = await (
    await request.post('/api/canvas/node', {
      data: {
        type: 'context',
        title: 'Focus source',
        data: { cards: [{ title: 'Focus sentinel', summary: 'Investigate amber' }] },
        x: 450,
        y: 90,
        width: 360,
        height: 260,
      },
    })
  ).json();
  const unrelated = await note(request, 'Uncurated secret', 950);
  const app = await mount(page);
  await app.locator(`[data-node-id="${status.id}"] .ctx-pin-btn`).click();
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(window.pmxTestHost.acknowledgedContexts.at(-1))))
    .toContain('Status sentinel cobalt');
  const pinBar = app.locator('.context-pin-bar');
  await expect(pinBar).toBeInViewport();
  expect(
    await pinBar.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.bottom <= innerHeight && rect.bottom >= innerHeight - 32 && rect.left >= 0 && rect.left < innerWidth / 3
      );
    }),
  ).toBe(true);
  await pinBar.getByRole('button', { name: 'Clear all context pins' }).click();
  await expect(pinBar).toHaveCount(0);
  await app.locator(`[data-node-id="${status.id}"] .ctx-pin-btn`).click();
  await app.locator(`[data-node-id="${focused.id}"]`).getByRole('button', { name: 'Set focus', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(window.pmxTestHost.acknowledgedContexts.at(-1))))
    .toContain('Investigate amber');
  const context = await page.evaluate(() => window.pmxTestHost.acknowledgedContexts.at(-1));
  expect(context).toMatchObject({ structuredContent: { focusedNodeIds: [focused.id], pinnedNodeIds: [status.id] } });
  expect(JSON.stringify(context)).not.toContain(unrelated);
});

test('snapshot restore refreshes context pins and AX focus in the hosted workbench', async ({ page, request }) => {
  await board(request, 'Restore curated context');
  const id = await note(request, 'Restored pin sentinel');
  const app = await mount(page);
  const pin = app.locator(`[data-node-id="${id}"] .ctx-pin-btn`);
  await pin.click();
  await request.post('/api/canvas/ax/focus', { data: { nodeIds: [id], primaryNodeId: id } });
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(window.pmxTestHost.acknowledgedContexts.at(-1))))
    .toContain(id);
  const snapshot = await (await request.post('/api/canvas/snapshots', { data: { name: 'Curated baseline' } })).json();
  await pin.click();
  await request.post('/api/canvas/ax/focus', { data: { nodeIds: [] } });
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(window.pmxTestHost.acknowledgedContexts.at(-1))))
    .not.toContain(id);
  await client.callTool({
    name: 'pmx_workbench_request',
    arguments: {
      path: `/api/canvas/snapshots/${snapshot.id}`,
      method: 'POST',
      expectedBoardId: (await client.callTool({ name: 'pmx_read_canvas', arguments: {} })).structuredContent!.boardId,
    },
  });
  await expect(pin).toHaveClass(/ctx-pin-active/);
  await expect
    .poll(() => page.evaluate(() => window.pmxTestHost.acknowledgedContexts.at(-1)))
    .toMatchObject({ structuredContent: { pinnedNodeIds: [id], focusedNodeIds: [id] } });
});

test('hosted Attach files opens a chooser and imports a Markdown note', async ({ page, request }) => {
  await board(request, 'Hosted file attachment');
  const app = await mount(page);
  const chooser = page.waitForEvent('filechooser');
  await app.getByRole('button', { name: 'Attach files', exact: true }).click();
  await (await chooser).setFiles({
    name: 'attached-sentinel.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Attachment sentinel cobalt'),
  });
  await expect(app.locator('.canvas-node').filter({ hasText: 'attached-sentinel.md' })).toContainText(
    'Attachment sentinel cobalt',
  );
});

test('hosted export delivers HTML through the host download capability', async ({ page, request }) => {
  await board(request, 'Hosted download');
  await note(request, 'Export sentinel cobalt');
  const app = await mount(page);
  await app.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = app.getByRole('dialog', { name: 'Export board' });
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(dialog.getByTestId('export-result')).toBeVisible();
  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.pmxTestHost.downloads)).toHaveLength(1);
  const download = await page.evaluate(() => window.pmxTestHost.downloads[0]);
  expect(download).toMatchObject({ contents: [{ type: 'resource', resource: { mimeType: 'text/html' } }] });
  expect(JSON.stringify(download)).toContain('Export sentinel cobalt');
});
