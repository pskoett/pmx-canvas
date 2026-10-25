import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { test, expect, setWorkspaceFeatures, type Page, type APIRequestContext } from './workspace-fixture.js';
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
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    await info.attach('hosted-workbench-failure', { body: await page.screenshot(), contentType: 'image/png' });
  }
  // Quiesce the host first: Playwright can unroute other active handlers when the first one finishes.
  await page.evaluate(() => {
    if (window.pmxTestHost) window.pmxTestHost.failReads = true;
  });
  await expect.poll(() => page.evaluate(() => window.pmxTestHost?.pendingTools ?? 0)).toBe(0);
  await page.unrouteAll({ behavior: 'wait' });
  await page.goto('about:blank');
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

test('hosted Present supersedes an exit still held before its RPC executes', async ({ page, request }) => {
  await board(request, 'Hosted tour ordering');
  const id = await note(request, 'Restarted tour');
  await request.post('/api/canvas/tour', {
    data: {
      tour: {
        stops: [
          { target: { nodeId: id }, duration: 0 },
          { target: { viewport: { x: 0, y: 0, scale: 1 } }, duration: 0 },
        ],
      },
    },
  });
  const app = await mount(page);
  await app.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(app.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let exitSeen = false;
  let retired: unknown;
  await page.route('**/test-tool', async (route) => {
    const input = route.request().postDataJSON() as { name: string; arguments?: Record<string, unknown> };
    if (input.arguments?.path !== '/api/canvas/tour/exit') return route.fallback();
    exitSeen = true;
    await held;
    const response = await client.callTool(input);
    retired = response._meta?.response;
    await route.fulfill({ json: response });
  });
  try {
    await app.getByRole('button', { name: 'Exit presentation', exact: true }).click();
    await expect.poll(() => exitSeen).toBe(true);
    await app.getByRole('button', { name: 'Present', exact: true }).click();
    await expect(app.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
    const card = app.locator(`[data-node-id="${id}"]`);
    await expect(card).toBeInViewport();
    release();
    await expect
      .poll(() => retired)
      .toMatchObject({ status: 200, body: JSON.stringify({ ok: true, superseded: true }) });
    await expect(app.getByRole('button', { name: 'Exit presentation', exact: true })).toBeVisible();
    await app.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(app.getByRole('button', { name: 'Back', exact: true })).toBeEnabled();
  } finally {
    release();
  }
});

test('hosted lifecycle, category and preset forms save without native form permission', async ({ page, request }) => {
  // This crosses four dialogs through the MCP host. Keep individual assertion
  // deadlines unchanged, but allow the complete sequence to finish at 2× DPR.
  test.setTimeout(60_000);
  await setWorkspaceFeatures(request, { knowledgeLifecycle: true });
  const boardId = await board(request, 'Sandboxed forms');
  const categoryName = `Hosted facts ${boardId}`;
  const presetName = `Hosted checks ${boardId}`;
  const copyName = `Hosted copy ${boardId}`;
  const id = await note(request, 'Checked capacity');
  const app = await mount(page);
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  const blocked: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Blocked form submission')) blocked.push(message.text());
  });
  const card = app.locator(`[data-node-id="${id}"]`);
  await card.hover();
  await card.getByRole('button', { name: 'More actions' }).click();
  await app.locator('.context-menu').getByRole('menuitem', { name: 'Review', exact: true }).click();
  const review = app.getByRole('dialog', { name: 'Review card', exact: true });
  await review.getByText('Settings and history', { exact: true }).click();
  await review.getByLabel('Set a card lifecycle override').check();
  await review.getByLabel('Cadence in days').fill('7');
  await review.getByLabel('How to check').fill('Compare the retained capacity source.');
  await review.getByRole('button', { name: 'Save lifecycle', exact: true }).click();
  await expect
    .poll(async () => (await (await request.get(`/api/canvas/node/${id}/lifecycle`)).json()).lifecycle?.cadenceDays)
    .toBe(7);
  // The save reloads review preconditions and clears the previous observation.
  // Server persistence alone does not mean the dialog can accept new evidence.
  await expect(review.getByRole('button', { name: 'Save lifecycle', exact: true })).toBeEnabled();
  await review.getByLabel('What did you check?').fill('Capacity matches the retained source: 149.');
  await review.getByRole('button', { name: 'Checked, still correct', exact: true }).click();
  await expect(review).toHaveCount(0);
  expect((await (await request.get(`/api/canvas/node/${id}/lifecycle`)).json()).lastValidation.evidence).toBe(
    'Capacity matches the retained source: 149.',
  );
  await app.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  await app.getByRole('button', { name: 'Categories', exact: true }).first().click();
  const categories = app.getByRole('dialog', { name: 'Categories', exact: true });
  await categories.getByRole('button', { name: 'Add category', exact: true }).click();
  await categories.getByLabel('Name', { exact: true }).fill(categoryName);
  await categories.getByRole('tab', { name: 'Review policy' }).click();
  await categories.getByLabel('How to check').fill('Compare source values.');
  await categories.getByRole('button', { name: 'Save category', exact: true }).click();
  await expect(categories.getByRole('status')).toContainText('Category saved');
  expect(
    (await (await request.get('/api/canvas/knowledge')).json()).categories.some(
      (entry: { name: string }) => entry.name === categoryName,
    ),
  ).toBe(true);
  await categories.getByRole('button', { name: 'Close settings' }).click();
  await app.getByRole('button', { name: 'Relation presets', exact: true }).click();
  const presets = app.getByRole('dialog', { name: 'Workspace relation presets' });
  await presets.getByRole('button', { name: 'Add preset', exact: true }).click();
  await presets.getByRole('button', { name: 'Add kind', exact: true }).click();
  await presets.getByLabel('Kind 1', { exact: true }).fill('checks');
  // Native required validation still applies; Enter in an input submits once valid.
  await presets.getByRole('button', { name: 'Save preset', exact: true }).click();
  await expect(presets.getByLabel('Name', { exact: true })).toBeFocused();
  await presets.getByLabel('Name', { exact: true }).fill(presetName);
  await presets.getByLabel('Name', { exact: true }).press('Enter');
  await expect(presets.getByRole('status')).toContainText('Preset saved for the workspace');
  expect(
    (await (await request.get('/api/canvas/knowledge')).json()).relationPresets.find(
      (entry: { name: string }) => entry.name === presetName,
    ).vocabulary,
  ).toEqual([{ kind: 'checks', ink: 'related', directed: true }]);
  await page.keyboard.press('Escape');
  await expect(presets).toHaveCount(0);
  const sourceRow = app.locator(`[data-testid="home-board"][data-board-id="${boardId}"]`);
  await sourceRow.getByRole('button', { name: 'Sandboxed forms', exact: true }).click();
  await app.getByRole('button', { name: /More: move, rename/ }).click();
  await app.getByRole('menuitem', { name: 'Create from…' }).click();
  const copy = app.getByRole('dialog', { name: 'Create from Sandboxed forms' });
  await copy.getByLabel('Board name').fill(copyName);
  await copy.getByRole('button', { name: 'Create board', exact: true }).click();
  await expect(copy).toHaveCount(0);
  await expect(app.getByTestId('home-board').filter({ hasText: copyName })).toBeVisible();
  expect(blocked).toEqual([]);
});

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
  await setWorkspaceFeatures(request, { agentSessions: true });
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

test('a hosted poll replays current layout without closing an open draft on superseded empty layouts', async ({
  page,
  request,
}) => {
  const { seq } = await (await request.get('/api/workbench/poll')).json();
  await board(request, 'Buffered layouts');
  const id = await note(request, 'Draft survives replay');
  const app = await mount(page);
  await app.locator(`.canvas-node[data-node-id="${id}"]`).getByRole('button', { name: 'Edit', exact: true }).click();
  await app.getByRole('button', { name: '</> Source', exact: true }).click();
  const editor = app.locator('.md-editor-expanded textarea');
  await editor.fill('Unsaved draft across buffered layouts');
  let captured = false;
  let replayed = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/test-tool', async (route) => {
    const input = route.request().postDataJSON() as { name: string; arguments?: Record<string, unknown> };
    const replay = !replayed && String(input.arguments?.path).startsWith('/api/workbench/poll?');
    const result = await client.callTool(
      replay ? { ...input, arguments: { ...input.arguments, path: `/api/workbench/poll?since=${seq}` } } : input,
    );
    if (replay) {
      const response = result._meta?.response as { body: string };
      const body = JSON.parse(response.body) as {
        snapshot: boolean;
        events: Array<{ event: string; payload: { layout?: { nodes: Array<{ id: string }> } } }>;
      };
      expect(body.snapshot).toBe(false);
      const layouts = body.events.filter((entry) => entry.event === 'canvas-layout-update');
      expect(layouts.some((entry) => entry.payload.layout?.nodes.length === 0)).toBe(true);
      expect(layouts.at(-1)?.payload.layout?.nodes.some((node) => node.id === id)).toBe(true);
      captured = true;
      await held;
    }
    await route.fulfill({ json: result });
    if (replay) replayed = true;
  });
  try {
    await expect.poll(() => captured).toBe(true);
    await app.getByRole('button', { name: 'Save', exact: true }).click();
    await expect
      .poll(async () => (await (await request.get(`/api/canvas/node/${id}`)).json()).data.content)
      .toBe('Unsaved draft across buffered layouts');
    await editor.fill('Second save after an older layout');
    release();
    await expect.poll(() => replayed).toBe(true);
    // Cross a subsequent request so assertions observe replay, not the pre-delivery DOM.
    await page.waitForRequest((request) => {
      if (!request.url().endsWith('/test-tool')) return false;
      return String(request.postDataJSON().arguments?.path).startsWith('/api/workbench/poll?');
    });
    await expect(editor).toHaveValue('Second save after an older layout');
    await app.getByRole('button', { name: 'Save', exact: true }).click();
    await expect
      .poll(async () => (await (await request.get(`/api/canvas/node/${id}`)).json()).data.content)
      .toBe('Second save after an older layout');
    // A final removal must still close the editor, rather than retaining a deleted card.
    expect((await request.delete(`/api/canvas/node/${id}`)).ok()).toBe(true);
    await expect(app.getByTestId('expanded-node')).toHaveCount(0);
  } finally {
    release();
  }
});

test('a hosted post-save render keeps a newer agent edit and a retryable human draft', async ({ page, request }) => {
  await board(request, 'Hosted save reconciliation');
  const id = await note(request, 'Checked decision');
  const app = await mount(page);
  await app.locator(`.canvas-node[data-node-id="${id}"]`).getByRole('button', { name: 'Edit', exact: true }).click();
  await app.getByRole('button', { name: '</> Source', exact: true }).click();
  const editor = app.locator('.md-editor-expanded textarea');
  const draft = 'Human decision awaiting its preview.';
  const newer = 'Newer agent decision after the acknowledged save.';
  await editor.fill(draft);
  await expect(app.locator('.md-preview')).toContainText(draft);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saved = false;
  let rendering = false;
  let deliveredNewer = false;
  await page.route('**/test-tool', async (route) => {
    const input = route.request().postDataJSON();
    const result = await client.callTool(input);
    if (input.arguments?.method === 'PATCH' && input.arguments.path === `/api/canvas/node/${id}`) saved = true;
    if (saved && input.arguments?.path === '/api/render' && JSON.parse(input.arguments.body).markdown === draft) {
      rendering = true;
      await gate;
    }
    if (
      input.arguments?.path.startsWith('/api/workbench/poll') &&
      JSON.stringify(result._meta?.response).includes(newer)
    )
      deliveredNewer = true;
    await route.fulfill({ json: result });
  });
  try {
    await app.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => rendering).toBe(true);
    const acknowledged = await (await request.get(`/api/canvas/node/${id}`)).json();
    expect(acknowledged.data.content).toBe(draft);
    expect((await request.patch(`/api/canvas/node/${id}`, { data: { content: newer } })).ok()).toBe(true);
    const updated = await (await request.get(`/api/canvas/node/${id}`)).json();
    expect(updated.contentRevision).toBeGreaterThan(acknowledged.contentRevision);
    await expect.poll(() => deliveredNewer).toBe(true);
    release();
    await page.waitForTimeout(250); // Observe the obsolete continuation after its held response is released.
    await expect(editor).toHaveValue(draft);
    await expect(app.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    await app.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(app.locator('.attention-toast')).toContainText('This node changed');
    await expect(editor).toHaveValue(draft);
    expect((await (await request.get(`/api/canvas/node/${id}`)).json()).data.content).toBe(newer);
  } finally {
    release();
  }
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
  await expect(app.locator(`[data-node-id="${diagram.id}"] .mermaid-diagram svg`)).toBeVisible({
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

test('pin reconciliation preserves retired membership without exposing it in the agent brief', async ({
  page,
  request,
}) => {
  await setWorkspaceFeatures(request, { knowledgeLifecycle: true });
  await board(request, 'Retired pin membership');
  const id = await note(request, 'Retired source');
  expect(
    (
      await request.post(`/api/canvas/node/${id}/review`, {
        data: { outcome: 'retire', evidence: 'Archived source', applied: true },
      })
    ).ok(),
  ).toBe(true);
  const app = await mount(page);
  const card = app.locator(`.canvas-node[data-node-id="${id}"]`);
  await expect(card).toHaveClass(/lifecycle-retired/);
  const pin = card.locator('.ctx-pin-btn');
  await pin.click();
  // The first optimistic paint alone would miss reconciliation dropping the pin.
  expect(
    await pin.evaluate(
      (element) =>
        new Promise<boolean>((resolve) => {
          const end = performance.now() + 1200;
          const sample = () => {
            if (!element.classList.contains('ctx-pin-active')) return resolve(false);
            if (performance.now() >= end) return resolve(true);
            requestAnimationFrame(sample);
          };
          sample();
        }),
    ),
  ).toBe(true);
  expect((await (await request.get('/api/canvas/pinned-context')).json()).nodeIds).toEqual([]);
  const pins = (await (await request.get('/api/workbench/poll')).json()).events.find(
    (entry: { event: string }) => entry.event === 'context-pins-changed',
  );
  expect(pins.payload.nodeIds).toEqual([id]);
  await pin.click();
  await expect
    .poll(async () => {
      const snapshot = await (await request.get('/api/workbench/poll')).json();
      return snapshot.events.find((entry: { event: string }) => entry.event === 'context-pins-changed').payload.nodeIds;
    })
    .toEqual([]);
  const activeId = await note(request, 'Active source');
  await request.post('/api/canvas/context-pins', { data: { nodeIds: [id, activeId] } });
  await setWorkspaceFeatures(request, { knowledgeLifecycle: false });
  await expect(app.getByTestId('context-chip')).toContainText('1 card');
  await expect(app.getByRole('region', { name: 'Pinned context', exact: true })).toContainText('1 node in context');
  expect((await (await request.get('/api/canvas/pinned-context')).json()).nodeIds).toEqual([activeId]);
  expect(
    (await request.post(`/api/canvas/node/${id}/lifecycle/restore`, { data: { evidence: 'Reactivated source' } })).ok(),
  ).toBe(true);
  await expect(app.getByTestId('context-chip')).toContainText('2 cards');
  await expect(app.getByRole('region', { name: 'Pinned context', exact: true })).toContainText('2 nodes in context');
});

for (const snapshot of [false, true]) {
  test(`Clear all survives an older hosted ${snapshot ? 'snapshot' : 'incremental poll'}`, async ({
    page,
    request,
  }) => {
    await board(request, 'Ordered hosted pins');
    const id = await note(request, 'Human pin');
    const peerId = await note(request, 'Agent pin', 500);
    const app = await mount(page);
    const pin = app.locator(`.canvas-node[data-node-id="${id}"] .ctx-pin-btn`);
    await expect(pin).toBeVisible();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let captured = false;
    await page.route('**/test-tool', async (route) => {
      const input = route.request().postDataJSON() as { name: string; arguments?: Record<string, unknown> };
      const isPoll = String(input.arguments?.path).startsWith('/api/workbench/poll?');
      const result = await client.callTool(
        snapshot && isPoll && !captured
          ? { ...input, arguments: { ...input.arguments, path: '/api/workbench/poll' } }
          : input,
      );
      const response = result._meta?.response as { body?: string } | undefined;
      const body = JSON.parse(response?.body ?? '{}') as {
        events?: Array<{ event: string; payload: { nodeIds?: string[] } }>;
      };
      if (
        isPoll &&
        !captured &&
        body.events?.some((entry) => entry.event === 'context-pins-changed' && entry.payload.nodeIds?.includes(id))
      ) {
        captured = true;
        await held;
      }
      await route.fulfill({ json: result });
    });
    try {
      await pin.click();
      await expect.poll(() => captured).toBe(true);
      const chip = app.getByTestId('context-chip');
      await chip.click();
      await app.getByRole('button', { name: 'Clear all', exact: true }).click();
      await expect
        .poll(async () => (await (await request.get('/api/canvas/pinned-context')).json()).nodeIds)
        .toEqual([]);
      // Observe the whole replay window, not an optimistic sample before the old reply lands.
      const staysClear = chip.evaluate(
        (element) =>
          new Promise<boolean>((resolve) => {
            const end = performance.now() + 700;
            const sample = () => {
              if (!element.textContent?.includes('Nothing in context')) return resolve(false);
              if (performance.now() >= end) return resolve(true);
              requestAnimationFrame(sample);
            };
            sample();
          }),
      );
      release();
      expect(await staysClear).toBe(true);
      await page.keyboard.press('Escape');
      await pin.click();
      await expect
        .poll(async () => (await (await request.get('/api/canvas/pinned-context')).json()).nodeIds)
        .toEqual([id]);
      await request.post('/api/canvas/context-pins', { data: { nodeIds: [peerId], mode: 'set' } });
      await expect(app.locator(`.canvas-node[data-node-id="${peerId}"] .ctx-pin-btn`)).toHaveClass(/ctx-pin-active/);
      await expect(pin).not.toHaveClass(/ctx-pin-active/);
    } finally {
      release();
    }
  });
}

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
  // The context chip sits in the top bar, clear of the host's chat composer.
  const chip = app.getByTestId('context-chip');
  await expect(chip).toBeInViewport();
  await expect(chip).toContainText('1 card');
  await chip.click();
  await app.getByRole('button', { name: 'Clear all', exact: true }).click();
  await expect(chip).toContainText('Nothing in context');
  await page.keyboard.press('Escape');
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
