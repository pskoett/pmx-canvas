/**
 * Reference cases: every node type must paint at every size the workbench
 * lives at — a 600 px agent-host pane or Claude desktop side browser, the
 * middle (1024 px, between the layout breakpoints) and a full 1920 px window.
 * This file runs in the `narrow-600`, `middle-1024` and `wide-1920` Playwright
 * projects (playwright.config.ts) and is part of the required e2e gate, so a
 * node type that paints blank at any of them blocks the release
 * (docs/product-vision-2026-09.md, moves 5 and 9).
 *
 * Each type gets its own test so a failure names the type. A test creates the
 * node at its default size, focuses it the way an agent would, and asserts what
 * the human sees: the node is in the pane and its content rendered — for
 * iframe-backed kinds, a sentinel inside the frame document is visible.
 */
import {
  expect,
  test,
  setWorkspaceFeatures,
  renderedCamera,
  type APIRequestContext,
  type Locator,
} from './workspace-fixture.js';

const playwrightPort = Number(process.env.PMX_PLAYWRIGHT_PORT ?? '4517');

/** Setup writes are the human's: they must not start agent presence or trip a scope fence. */
const WORKBENCH = { 'x-pmx-workbench': '1' };

/** Schema create routes that produce one of the stored types below rather than a type of their own. */
const CREATE_ONLY_ROUTES = ['html-primitive', 'external-app', 'web-artifact'];

async function resetBoard(request: APIRequestContext): Promise<void> {
  await request.post('/api/canvas/ax/policy', { data: { scope: null }, headers: WORKBENCH });
  await request.post('/api/canvas/clear', { headers: WORKBENCH });
  await request.post('/api/canvas/context-pins', { data: { nodeIds: [] }, headers: WORKBENCH });
}

async function postId(request: APIRequestContext, endpoint: string, data: Record<string, unknown>): Promise<string> {
  const response = await request.post(endpoint, { data, headers: WORKBENCH });
  const body = (await response.json()) as { id?: string; error?: string };
  if (!response.ok() || typeof body.id !== 'string') {
    throw new Error(`${endpoint} failed (${response.status()}): ${body.error ?? JSON.stringify(body)}`);
  }
  return body.id;
}

async function frameDocumentUrl(request: APIRequestContext, html: string): Promise<string> {
  const response = await request.post('/api/canvas/frame-documents', {
    data: { html, sandbox: 'allow-scripts' },
    headers: WORKBENCH,
  });
  return ((await response.json()) as { url: string }).url;
}

interface ReferenceCase {
  type: string;
  create: (request: APIRequestContext) => Promise<string>;
  painted: (node: Locator) => Promise<void>;
}

const addNode = (data: Record<string, unknown>) => (request: APIRequestContext) =>
  postId(request, '/api/canvas/node', data);

test('expanded Markdown keeps visible text clear of Source at every scroll position', async ({ page, request }) => {
  await resetBoard(request);
  const content = `${Array.from({ length: 45 }, (_, i) => `Paragraph ${i + 1}. The recorded capacity value is ${105 + i}.`).join('\n\n')}\n\nEND OF DOCUMENT`;
  const id = await postId(request, '/api/canvas/node', {
    type: 'markdown',
    title: 'Long document',
    content,
    x: 80,
    y: 80,
    width: 440,
    height: 320,
  });
  await page.goto('/workbench');
  const card = page.locator(`[data-node-id="${id}"]`);
  await card.getByRole('button', { name: 'Expand (focus mode)', exact: true }).click();
  const reader = page.locator('.md-reader');
  await expect(reader).toContainText('END OF DOCUMENT');
  const obscured = await reader.evaluate(async (element) => {
    const failures: string[] = [];
    for (let top = 0; ; top += element.clientHeight / 2) {
      element.scrollTop = top;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const viewport = element.getBoundingClientRect();
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        for (const word of text.textContent!.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(text, word.index!);
          range.setEnd(text, word.index! + word[0].length);
          const rect = range.getBoundingClientRect();
          if (rect.top < viewport.top || rect.bottom > viewport.bottom || !rect.width) continue;
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          if (!hit || !element.contains(hit)) failures.push(word[0]);
        }
      }
      if (element.scrollTop + element.clientHeight >= element.scrollHeight - 1) break;
    }
    return failures;
  });
  expect(obscured).toEqual([]);
  await expect(reader.getByText('END OF DOCUMENT', { exact: true })).toBeInViewport();
  await page.getByRole('button', { name: '</> Source', exact: true }).click();
  await expect(page.locator('.md-editor-expanded textarea')).toHaveValue(content);
});

/** Asserts a sentinel inside the node's iframe document, and that the iframe itself is in the pane. */
async function framePainted(node: Locator, sentinel: (frame: ReturnType<Locator['frameLocator']>) => Locator) {
  await expect(node.locator('iframe').first()).toBeInViewport();
  await expect(sentinel(node.frameLocator('iframe').first())).toBeVisible();
}

const CASES: ReferenceCase[] = [
  {
    type: 'markdown',
    create: addNode({ type: 'markdown', title: 'Ref Markdown', content: 'Markdown pane sentinel' }),
    painted: (node) => expect(node.getByText('Markdown pane sentinel')).toBeInViewport(),
  },
  {
    type: 'board',
    create: addNode({ type: 'board', title: 'Ref Board', data: { boardId: 'missing-reference-board' } }),
    painted: (node) => expect(node.getByText('Board not found')).toBeInViewport(),
  },
  {
    type: 'status',
    create: addNode({
      type: 'status',
      title: 'Ref Status',
      data: { phase: 'testing', message: 'Status pane sentinel' },
    }),
    painted: (node) => expect(node.getByText('Status pane sentinel')).toBeInViewport(),
  },
  {
    type: 'context',
    create: addNode({
      type: 'context',
      title: 'Ref Context',
      data: {
        currentTokens: 420,
        tokenLimit: 1000,
        cards: [{ title: 'Context pane sentinel', summary: 'summary', sourceKind: 'workspace' }],
      },
    }),
    painted: (node) => expect(node.getByText('Context pane sentinel')).toBeInViewport(),
  },
  {
    type: 'ledger',
    create: addNode({ type: 'ledger', title: 'Ref Ledger', data: { passedChecks: 15, failedChecks: 0 } }),
    painted: (node) => expect(node.getByText('Passed Checks')).toBeInViewport(),
  },
  {
    type: 'trace',
    create: addNode({
      type: 'trace',
      title: 'Ref Trace',
      data: { toolName: 'trace_pane_sentinel', category: 'mcp', status: 'success' },
    }),
    painted: (node) => expect(node.getByText('trace_pane_sentinel')).toBeInViewport(),
  },
  {
    type: 'file',
    create: addNode({
      type: 'file',
      title: 'ref-pane.ts',
      content: 'export const sentinel = "File pane sentinel";',
    }),
    painted: async (node) => {
      await expect(node.getByRole('code')).toContainText('File pane sentinel');
      await expect(node.getByRole('code')).toBeInViewport();
    },
  },
  {
    type: 'diff',
    create: addNode({
      type: 'diff',
      title: 'Ref Diff',
      content:
        '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-const pane = old;\n+const pane = "Diff pane sentinel";',
    }),
    painted: async (node) => {
      await expect(node.locator('.diff-line-add')).toContainText('Diff pane sentinel');
      await expect(node.locator('.diff-line-add')).toBeInViewport();
    },
  },
  {
    type: 'mermaid',
    create: addNode({ type: 'mermaid', title: 'Ref Mermaid', content: 'graph TD; A[Pane] --> B[Sentinel];' }),
    painted: async (node) => {
      await expect(node.locator('svg').getByText('Sentinel')).toBeVisible();
    },
  },
  {
    type: 'image',
    create: addNode({
      type: 'image',
      title: 'Ref Image',
      content: `data:image/svg+xml,${encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#1d4ed8"/></svg>',
      )}`,
      data: { alt: 'Image pane sentinel' },
    }),
    painted: async (node) => {
      const image = node.getByAltText('Image pane sentinel');
      await expect(image).toBeInViewport();
      // A broken image is "visible" too; naturalWidth proves the bytes decoded.
      await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    },
  },
  {
    type: 'webpage',
    create: async (request) => {
      const url = await frameDocumentUrl(
        request,
        '<!doctype html><html><head><title>Webpage pane sentinel</title></head><body>body</body></html>',
      );
      return postId(request, '/api/canvas/node', {
        type: 'webpage',
        title: 'Ref Webpage',
        url: `http://127.0.0.1:${playwrightPort}${url}`,
      });
    },
    painted: (node) => expect(node.getByText('Webpage pane sentinel')).toBeInViewport(),
  },
  {
    type: 'html',
    create: addNode({ type: 'html', title: 'Ref HTML', html: '<main><h1>HTML pane sentinel</h1></main>' }),
    painted: (node) => framePainted(node, (frame) => frame.getByRole('heading', { name: 'HTML pane sentinel' })),
  },
  {
    type: 'mcp-app',
    create: async (request) => {
      const url = await frameDocumentUrl(request, '<!doctype html><main><h1>MCP app pane sentinel</h1></main>');
      return postId(request, '/api/canvas/node', {
        type: 'mcp-app',
        title: 'Ref MCP App',
        data: { url, title: 'Ref MCP App', sourceServer: 'reference-pane', trustedDomain: true },
      });
    },
    painted: (node) => framePainted(node, (frame) => frame.getByRole('heading', { name: 'MCP app pane sentinel' })),
  },
  {
    type: 'json-render',
    create: (request) =>
      postId(request, '/api/canvas/json-render', {
        title: 'Ref JSON Render',
        spec: {
          root: 'card',
          elements: {
            card: { type: 'Card', props: { title: 'JSON render pane sentinel' }, children: [] },
          },
        },
      }),
    painted: (node) => framePainted(node, (frame) => frame.getByText('JSON render pane sentinel', { exact: true })),
  },
  {
    type: 'graph',
    create: (request) =>
      postId(request, '/api/canvas/graph', {
        title: 'Ref Graph',
        graphType: 'bar',
        data: [
          { label: 'One', value: 12 },
          { label: 'Two', value: 18 },
        ],
        xKey: 'label',
        yKey: 'value',
      }),
    painted: (node) => framePainted(node, (frame) => frame.locator('.recharts-bar-rectangle').first()),
  },
  {
    type: 'group',
    create: (request) => postId(request, '/api/canvas/group', { title: 'Ref Group' }),
    painted: (node) => expect(node.getByText('Drop nodes here')).toBeInViewport(),
  },
];

test('the reference cases cover every node type the schema can create', async ({ request }) => {
  const schema = (await (await request.get('/api/canvas/schema')).json()) as { nodeTypes: Array<{ type: string }> };
  const creatable = schema.nodeTypes.map((entry) => entry.type).filter((type) => !CREATE_ONLY_ROUTES.includes(type));
  expect(CASES.map((entry) => entry.type).sort()).toEqual(creatable.sort());
});

test('every control renders in the bundled Plex faces', async ({ page, request }) => {
  await resetBoard(request);
  await postId(request, '/api/canvas/node', { type: 'markdown', title: 'Font check', content: 'Font sentinel' });

  await page.goto('/workbench');
  await expect(page.getByText('Font sentinel')).toBeVisible();
  const report = await page.evaluate(async () => {
    await document.fonts.ready;
    const controls = [...document.querySelectorAll('button, input, select, textarea')].filter(
      (element) => element.getClientRects().length > 0,
    );
    return {
      controls: controls.length,
      offenders: controls
        .map((element) => `${element.tagName}.${element.className}: ${getComputedStyle(element).fontFamily}`)
        .filter((entry) => !/: "?IBM Plex (Sans|Mono)"?,/.test(entry)),
      loaded: [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family),
    };
  });

  expect(report.controls).toBeGreaterThan(10);
  expect(report.offenders).toEqual([]);
  expect(report.loaded.some((family) => family.includes('IBM Plex Sans'))).toBe(true);
  const dot = (await page.locator('.connection-dot').boundingBox())!;
  const board = page.locator('.board-switcher-button');
  await board.focus();
  expect((await board.boundingBox())!.x - dot.x - dot.width).toBeGreaterThanOrEqual(10);
});

test('all relation kinds stay reachable without horizontal scrolling and Fit clears the legend', async ({
  page,
  request,
}) => {
  await resetBoard(request);
  const a = await postId(request, '/api/canvas/node', {
    type: 'markdown',
    title: 'Evidence',
    content: 'A measured result.',
    x: 0,
    y: 0,
    width: 280,
    height: 180,
  });
  const b = await postId(request, '/api/canvas/node', {
    type: 'markdown',
    title: 'Decision',
    content: 'A qualified conclusion.',
    x: 0,
    y: 1800,
    width: 280,
    height: 180,
  });
  const kinds = [
    'supports',
    'contradicts',
    'cites',
    'derived-from',
    'answers',
    'depends-on',
    'supersedes',
    'flow',
    'related',
    'next',
    'if-fails',
    'loop',
    'x'.repeat(80),
  ];
  for (const kind of kinds) {
    await postId(request, '/api/canvas/edge', { from: a, to: b, type: 'relation', kind });
  }
  await page.goto('/workbench');
  const legend = page.getByLabel('Relation legend');
  await expect(legend.getByRole('button')).toHaveCount(kinds.length);
  const legendBox = (await legend.boundingBox())!;
  for (const kind of kinds) {
    const button = legend.getByRole('button', { name: `${kind} 1`, exact: true });
    await expect(button).toBeInViewport();
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(legendBox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(legendBox.x + legendBox.width + 1);
    expect(await button.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  }
  // The last kind was previously offscreen. Exercise its real filter, not just its DOM presence.
  const last = legend.getByRole('button', { name: `${kinds.at(-1)} 1`, exact: true });
  await last.click();
  await expect(last).toHaveAttribute('aria-pressed', 'true');
  await last.click();
  await expect(last).toHaveAttribute('aria-pressed', 'false');
  const committed = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/canvas/viewport') && typeof response.request().postDataJSON().x === 'number',
  );
  const fit = page.getByRole('button', { name: 'Fit canvas', exact: true });
  if (await fit.isVisible()) await fit.click();
  else {
    await page.getByRole('button', { name: 'More: export, present, zoom, fit', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Fit all', exact: true }).click();
  }
  expect((await committed).ok()).toBe(true);
  for (const agentFit of [false, true]) {
    if (agentFit) {
      const response = await request.post('/api/canvas/fit', { data: {} });
      expect(response.ok()).toBe(true);
      const { viewport } = (await response.json()) as { viewport: { x: number; y: number; scale: number } };
      await expect.poll(async () => (await renderedCamera(page)).y).toBeCloseTo(viewport.y, 1);
    }
    for (const id of [a, b]) {
      const node = page.locator(`[data-node-id="${id}"]`);
      await expect(node).toBeInViewport();
      await expect.poll(async () => (await node.boundingBox())!.y).toBeGreaterThan(legendBox.y + legendBox.height);
    }
  }

  // A short pane and a large legal vocabulary must leave room for cards and a reachable last filter.
  for (let index = 0; index < 24; index++) {
    await postId(request, '/api/canvas/edge', {
      from: a,
      to: b,
      type: 'relation',
      kind: `review-${index}-${'x'.repeat(65)}`,
    });
  }
  await expect(legend.getByRole('button')).toHaveCount(kinds.length + 24);
  await page.setViewportSize({ width: 600, height: 400 });
  const finalKind = legend.getByRole('button', { name: `review-23-${'x'.repeat(65)} 1`, exact: true });
  await finalKind.scrollIntoViewIfNeeded();
  await finalKind.click();
  await expect(finalKind).toHaveAttribute('aria-pressed', 'true');
  await finalKind.click();
  const shortLegend = (await legend.boundingBox())!;
  expect(shortLegend.y + shortLegend.height).toBeLessThan(250);
  const reported = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/canvas/viewport') && typeof response.request().postDataJSON().x === 'number',
  );
  await page.getByRole('button', { name: 'More: export, present, zoom, fit', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Fit all', exact: true }).click();
  expect((await reported).ok()).toBe(true);
  const response = await request.post('/api/canvas/fit', { data: {} });
  expect(response.ok()).toBe(true);
  const { viewport } = (await response.json()) as { viewport: { x: number; y: number; scale: number } };
  await expect.poll(async () => (await renderedCamera(page)).y).toBeCloseTo(viewport.y, 1);
  for (const id of [a, b]) {
    const node = page.locator(`[data-node-id="${id}"]`);
    await expect.poll(async () => (await node.boundingBox())!.y).toBeGreaterThan(shortLegend.y + shortLegend.height);
    await expect
      .poll(async () => {
        const box = (await node.boundingBox())!;
        return box.y + box.height;
      })
      .toBeLessThan(400);
  }
});

test('Home is navigation first even with a long agent README and repeated links', async ({
  page,
  request,
}, testInfo) => {
  await setWorkspaceFeatures(request, { knowledgeLifecycle: true });
  const targetName = `Home detail target ${testInfo.project.name}`;
  const sourceName = `Navigation acceptance ${testInfo.project.name}`;
  const target = (
    await (
      await request.post('/api/canvas/boards', {
        headers: WORKBENCH,
        data: { name: targetName },
      })
    ).json()
  ).board.id as string;
  const sourceFolder = `Navigation/${testInfo.project.name}/After 0.8.2`;
  const source = (
    await (
      await request.post('/api/canvas/boards', {
        headers: WORKBENCH,
        data: { name: sourceName, folder: sourceFolder },
      })
    ).json()
  ).board.id as string;
  await request.post('/api/canvas/boards/open', { headers: WORKBENCH, data: { id: source } });
  const id = await postId(request, '/api/canvas/node', {
    type: 'markdown',
    title: 'Agent README',
    content: `# Raw agent instructions\n${'Detailed agent instructions. '.repeat(80)}\n[[${targetName}]]`,
  });
  for (let index = 0; index < 33; index++)
    await postId(request, '/api/canvas/node', {
      type: 'markdown',
      title: `Linked note ${index}`,
      content: `[[${targetName}]]`,
      x: 1000 + index * 400,
      y: 1000,
    });
  const dueId = await postId(request, '/api/canvas/node', {
    type: 'markdown',
    title: 'Review this value',
    content: 'The measured value is 37.',
    data: { contentOrigin: 'imported' },
    x: 1200,
    y: 300,
  });
  expect(
    (
      await request.post(`/api/canvas/node/${dueId}/lifecycle`, {
        headers: WORKBENCH,
        data: {
          lifecycleOverride: {
            decayType: 'reality',
            rate: 'medium',
            cadenceDays: 7,
            triggers: [],
            revalidationMethod: 'Compare the measured value.',
          },
        },
      })
    ).ok(),
  ).toBe(true);
  await request.patch(`/api/canvas/boards/${source}`, { headers: WORKBENCH, data: { readmeNodeId: id } });
  await page.goto('/workbench');
  await expect(page.locator(`[data-node-id="${id}"]`)).toBeVisible();
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  await page.getByRole('button', { name: sourceName, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'After 0.8.2' })).toBeVisible();
  expect((await page.getByRole('heading', { level: 1, name: 'After 0.8.2' }).boundingBox())!.height).toBeLessThan(56);
  const details = page.getByRole('complementary', { name: 'Board details' });
  await expect(details).not.toContainText('Raw agent instructions');
  await expect(details).not.toContainText(targetName);
  const open = details.getByRole('button', { name: 'Open board', exact: true });
  await expect(open).toBeInViewport();
  await expect(details.getByRole('switch', { name: "In the agent's context" })).toBeVisible();
  await details.getByRole('button', { name: /More: move, rename/ }).click();
  for (const item of await details.getByRole('menuitem').all()) await expect(item).toBeInViewport();
  await page.keyboard.press('Escape');
  const catalog = await (await request.get('/api/canvas/boards')).json();
  const saved = catalog.boards.find((board: { id: string }) => board.id === source);
  expect(saved.summary).toContain('Raw agent instructions');
  expect(saved.links.filter((link: { boardId: string }) => link.boardId === target)).toHaveLength(34);
  await open.click();
  await expect(page.locator(`[data-node-id="${id}"]`)).toBeVisible();
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  await page.getByRole('button', { name: 'Review needed: 1 card', exact: true }).click();
  const queue = page.getByRole('region', { name: 'Card review queue' });
  const row = queue.locator('tbody tr').filter({ hasText: 'Review this value' });
  await expect(row).toContainText(sourceName);
  await row.getByRole('button', { name: `Open review: Review this value on ${sourceName}` }).click();
  const dueCard = page.locator(`[data-node-id="${dueId}"]`);
  await expect(dueCard).toBeInViewport();
  const review = page.getByRole('dialog', { name: 'Review card' });
  await expect(review.getByRole('button', { name: 'Checked, still correct' })).toBeDisabled();
  await expect(review.locator('.lifecycle-clocks')).not.toBeVisible();
  const close = review.getByRole('button', { name: 'Close review' });
  const summary = review.locator('summary').first();
  await close.focus();
  await page.keyboard.press('Tab');
  await expect(review.getByLabel('What did you check?')).toBeFocused();
  await summary.focus();
  await page.keyboard.press('Space');
  await expect(review.locator('.lifecycle-advanced')).toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: 'Pan (Space)', exact: true })).not.toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Space');
  await expect(review.locator('.lifecycle-advanced')).not.toHaveAttribute('open', '');
  await review.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(review).toHaveCount(0);
  const deferred = await (await request.get(`/api/canvas/node/${dueId}/lifecycle`)).json();
  expect(deferred.qualification.due).toBe(true);
  expect(deferred.records).toHaveLength(0);
  await dueCard.getByRole('button', { name: /review due/ }).click();
  await review.getByLabel('What did you check?').fill('Compared with the source: value 37 is correct.');
  await review.getByRole('button', { name: 'Checked, still correct' }).click();
  await expect(review).toHaveCount(0);
  const checked = await (await request.get(`/api/canvas/node/${dueId}/lifecycle`)).json();
  expect(checked.lastValidation.evidence).toBe('Compared with the source: value 37 is correct.');
  expect(checked.qualification.due).toBe(false);
});

for (const type of ['html', 'mcp-app', 'json-render', 'graph']) {
  test(`${type} keeps native content proportions through continuous fractional zoom`, async ({ page, request }) => {
    await resetBoard(request);
    const fixture = CASES.find((entry) => entry.type === type)!;
    const id = await fixture.create(request);
    await request.patch(`/api/canvas/node/${id}`, {
      data: { position: { x: 80, y: 40 }, size: { width: 460, height: 360 }, data: { strictSize: true } },
      headers: WORKBENCH,
    });
    await page.goto('/workbench');
    const card = page.locator(`[data-node-id="${id}"]`);
    const frame = card.locator('iframe:not([inert])');
    const body = frame.contentFrame().locator('body');
    let originalWidth = 0;
    let originalClientWidth = 0;
    let originalHeight = 0;
    for (const scale of [1, 0.39, 0.28, 0.39, 0.2, 0.08, 1]) {
      await request.post('/api/canvas/viewport', {
        data: { x: 16, y: 60, scale },
        headers: WORKBENCH,
      });
      await expect.poll(async () => (await card.boundingBox())!.width).toBeCloseTo(460 * scale, 1);
      await fixture.painted(card);
      const outer = await frame.evaluate((element) => ({
        width: element.clientWidth,
        height: element.clientHeight,
        rect: element.getBoundingClientRect().width,
      }));
      const inner = await body.evaluate(() => ({
        width: innerWidth,
        clientWidth: document.documentElement.clientWidth,
        height: innerHeight,
        rootWidth: document.documentElement.getBoundingClientRect().width,
      }));
      if (!originalWidth) {
        originalWidth = inner.width;
        originalClientWidth = inner.clientWidth;
        originalHeight = inner.height;
      }
      expect(inner.width).toBe(originalWidth);
      expect(inner.height).toBe(originalHeight);
      // A document scrollbar consumes layout width, independently of canvas zoom.
      expect(inner.clientWidth).toBe(originalClientWidth);
      expect(Math.abs(inner.width - outer.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(inner.rootWidth - inner.clientWidth)).toBeLessThan(1);
      expect(Math.abs(inner.height - outer.height)).toBeLessThanOrEqual(1);
      expect(outer.rect).toBeCloseTo(outer.width * scale, 1);
      await expect(card.locator('.viewer-fallback')).toHaveCount(0);
    }
    const saved = await (await request.get(`/api/canvas/node/${id}`)).json();
    expect(saved.position).toEqual({ x: 80, y: 40 });
    expect(saved.size).toEqual({ width: 460, height: 360 });
  });
}

test('panning automatically mounts later viewer regions and preserves earlier drafts', async ({ page, request }) => {
  test.setTimeout(60_000);
  const ids: string[] = [];
  await resetBoard(request);
  for (let index = 0; index < 16; index++) {
    ids.push(
      await postId(request, '/api/canvas/node', {
        type: 'html',
        title: `Viewer ${index}`,
        html: `<p>Painted viewer ${index}</p><input aria-label="Draft" value="Original"><script>window.appState = { count: 37 };</script>`,
        x: index * 1200,
        y: 0,
        width: 400,
        height: 260,
        strictSize: true,
      }),
    );
  }
  await request.post('/api/canvas/viewport', { data: { x: 16, y: 60, scale: 1 }, headers: WORKBENCH });
  await page.goto('/workbench');
  const firstFrame = page.locator(`[data-node-id="${ids[0]}"] iframe`);
  const first = firstFrame.contentFrame();
  await first.getByLabel('Draft').fill('Unsaved human input');
  const original = await firstFrame.elementHandle();
  for (let index = 0; index < ids.length; index++) {
    await request.post('/api/canvas/viewport', {
      data: { x: 16 - index * 1200, y: 60, scale: 1 },
      headers: WORKBENCH,
    });
    await expect(
      page
        .locator(`[data-node-id="${ids[index]}"]`)
        .frameLocator('iframe')
        .getByText(`Painted viewer ${index}`, { exact: true }),
    ).toBeVisible();
  }
  for (const scale of [0.39, 0.28, 0.2, 1]) {
    await request.post('/api/canvas/viewport', { data: { x: 16, y: 60, scale }, headers: WORKBENCH });
    await expect(first.getByLabel('Draft')).toBeVisible();
    await expect(first.getByLabel('Draft')).toHaveValue('Unsaved human input');
    expect(await firstFrame.evaluate((current, previous) => current === previous, original)).toBe(true);
    expect(await first.locator('body').evaluate(() => Reflect.get(window, 'appState').count)).toBe(37);
  }
  await expect(page.locator('.viewer-host iframe')).toHaveCount(16);
});

test('section headings and full-width chart viewers follow all nine canvas themes', async ({ page, request }) => {
  test.setTimeout(90_000);
  await resetBoard(request);
  const heading = await postId(request, '/api/canvas/node', {
    type: 'markdown',
    title: 'Release evidence',
    content: 'Charts and source material',
    data: { display: 'heading' },
    x: 0,
    y: 0,
    width: 440,
    height: 120,
  });
  const chart = await postId(request, '/api/canvas/graph', {
    title: 'Build durations',
    graphType: 'bar',
    data: [
      { label: 'Baseline', value: 37 },
      { label: 'Candidate', value: 19 },
    ],
    xKey: 'label',
    yKey: 'value',
    x: 0,
    y: 170,
    width: 440,
    nodeHeight: 380,
  });
  for (const theme of [
    'harbor',
    'daylight',
    'high-contrast',
    'midnight',
    'sepia',
    'arctic',
    'ember',
    'forest',
    'volt',
  ]) {
    await page.goto(`/workbench?theme=${theme}`);
    await request.post('/api/canvas/focus', { data: { id: heading }, headers: WORKBENCH });
    const label = page.locator(`[data-node-id="${heading}"]`);
    await expect(label).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(label.locator('.node-title')).toBeVisible();
    await expect
      .poll(async () => {
        const top = (await label.boundingBox())!.y;
        return top - (await page.locator('.canvas-region').boundingBox())!.y;
      })
      .toBeGreaterThanOrEqual(44);
    await request.post('/api/canvas/focus', { data: { id: chart }, headers: WORKBENCH });
    const card = page.locator(`[data-node-id="${chart}"]`);
    const frame = card.frameLocator('iframe:not([inert])');
    await expect(frame.locator('.recharts-bar-rectangle').first()).toBeVisible();
    await expect(frame.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(frame.getByText('Build durations', { exact: true })).not.toBeVisible();
    await expect(frame.getByText('Baseline', { exact: true })).toBeVisible();
    const panel = await card.evaluate((element) => getComputedStyle(element).backgroundColor);
    await expect(frame.locator('body')).toHaveCSS('background-color', panel);
    const widths = await frame.locator('.pmx-viewer-root').evaluate((element) => ({
      viewport: window.innerWidth,
      root: element.getBoundingClientRect().width,
      card: element.firstElementChild!.getBoundingClientRect().width,
    }));
    // innerWidth is integer-rounded; allow subpixel layout rounding.
    expect(Math.abs(widths.root - widths.viewport)).toBeLessThan(1);
    expect(widths.card).toBe(widths.root);
  }
  await setWorkspaceFeatures(request, { knowledgeLifecycle: true });
  await page.locator(`[data-node-id="${chart}"]`).getByRole('button', { name: 'Expand (focus mode)' }).click();
  const header = page.locator('.expanded-header');
  await expect(header.getByRole('button', { name: 'Open in tab' })).toBeVisible();
  expect(
    await header.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return [...element.querySelectorAll('button')].every((button) => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return (
          rect.top >= bounds.top &&
          rect.bottom <= bounds.bottom &&
          rect.left >= bounds.left &&
          rect.right <= bounds.right &&
          !!hit &&
          button.contains(hit)
        );
      });
    }),
  ).toBe(true);
});

for (const referenceCase of CASES) {
  test(`${referenceCase.type} paints in the viewport`, async ({ page, request }) => {
    await resetBoard(request);
    const id = await referenceCase.create(request);

    await page.goto('/workbench');
    const node = page.locator(`.canvas-node[data-node-id="${id}"]`);
    await expect(node).toBeVisible();

    // Focus the way an agent does; the client refines the pan against the real
    // canvas region, which is what differs between widths.
    await request.post('/api/canvas/focus', { data: { id }, headers: WORKBENCH });
    await expect(node).toBeInViewport();

    await referenceCase.painted(node);
  });
}
