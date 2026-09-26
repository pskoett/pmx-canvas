/**
 * Reference surface: every node type must paint in a 600 px Chromium pane.
 *
 * The workbench lives in a 500–600 px panel inside Claude Code, Codex and
 * Copilot, not in the 1440×900 window the rest of the suite runs at. This file
 * runs only in the `pane-600` Playwright project (playwright.config.ts) and is
 * part of the required e2e gate, so a node type that paints blank at pane width
 * blocks the release (docs/product-vision-2026-09.md, move 5).
 *
 * Each type gets its own test so a failure names the type. A test creates the
 * node at its default size, focuses it the way an agent would, and asserts what
 * the human sees: the node is in the pane and its content rendered — for
 * iframe-backed kinds, a sentinel inside the frame document is visible.
 */
import { expect, test, type APIRequestContext, type Locator } from '@playwright/test';

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
    painted: (node) => framePainted(node, (frame) => frame.locator('svg').getByText('Sentinel')),
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

for (const referenceCase of CASES) {
  test(`${referenceCase.type} paints in a 600 px pane`, async ({ page, request }) => {
    await resetBoard(request);
    const id = await referenceCase.create(request);

    await page.goto('/workbench');
    const node = page.locator(`.canvas-node[data-node-id="${id}"]`);
    await expect(node).toBeVisible();

    // Focus the way an agent does; the client refines the pan against the real
    // canvas region, which is what differs at pane width.
    await request.post('/api/canvas/focus', { data: { id }, headers: WORKBENCH });
    await expect(node).toBeInViewport();

    await referenceCase.painted(node);
  });
}
