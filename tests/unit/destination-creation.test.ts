import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { canvasState } from '../../src/server/canvas-state.js';
import { loadStateFromDB } from '../../src/server/canvas-db.js';
import { PmxCanvas } from '../../src/server/index.js';
import { mutationHistory } from '../../src/server/mutation-history.js';
import { intentRegistry } from '../../src/server/intent-registry.js';
import { runCanvasBatchOperation } from '../../src/server/operations/index.js';
import {
  executeOperation,
  getOperationEventEmitter,
  setOperationEventEmitter,
} from '../../src/server/operations/registry.js';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.js';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.js';

let root: string;
let a: string;
let b: string;
let previousEmitter: ReturnType<typeof getOperationEventEmitter>;
beforeEach(() => {
  previousEmitter = getOperationEventEmitter();
  root = createTestWorkspace('destination-create-');
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  a = canvasState.createBoard('A')!.id;
  canvasState.switchBoard(a);
  b = canvasState.createBoard('B')!.id;
  mutationHistory.reset();
});
afterEach(() => {
  stopCanvasServer();
  setOperationEventEmitter(previousEmitter);
  canvasState.close();
  removeTestWorkspace(root);
});
const add = (input: Record<string, unknown> = {}) =>
  executeOperation('node.add', {
    type: 'markdown',
    content: 'same content',
    destinationBoardId: b,
    ...input,
  }) as Promise<{ id: string }>;

test('inactive static creation preserves active maps, revision, undo, ghosts, layout and global theme', async () => {
  canvasState.setTheme('sepia');
  const before = canvasState.getLayout();
  const revision = canvasState.getContentRevision();
  const ghosts = intentRegistry.list();
  const events: string[] = [];
  setOperationEventEmitter((event) => {
    events.push(event);
  });
  const first = await add({ expectedBoardId: a });
  const second = await add();
  expect(first.id).not.toBe(second.id);
  expect(canvasState.activeBoardId).toBe(a);
  expect(canvasState.getLayout()).toEqual(before);
  expect(canvasState.getContentRevision()).toEqual(revision);
  expect(mutationHistory.canUndo()).toBe(false);
  expect(intentRegistry.list()).toEqual(ghosts);
  expect(events).not.toContain('canvas-layout-update');
  expect(canvasState.readBoard(b)!.layout.nodes).toHaveLength(2);
  canvasState.switchBoard(b);
  expect(canvasState.getLayout().nodes.map((node) => node.id)).toEqual([first.id, second.id]);
  expect(canvasState.getLayout().theme).toBe('sepia');
});

test('expectedBoardId is still an active-board guard; unsupported runtime/membership requests fail', async () => {
  await expect(add({ expectedBoardId: b })).rejects.toThrow('active board changed');
  for (const type of ['file', 'webpage', 'mcp-app', 'group', 'prompt', 'html-primitive'])
    await expect(add({ type })).rejects.toThrow('static');
  await expect(add({ data: { children: [] } })).rejects.toThrow('membership');
  expect(canvasState.readBoard(b)!.layout.nodes).toHaveLength(0);
});

test('stored edit preserves raw pin state and existing clocks, and works from Home without navigation', async () => {
  canvasState.switchBoard(b);
  const existing = new PmxCanvas().addNode({ type: 'markdown', content: 'Existing' });
  canvasState.setContextPins([existing.id]);
  const before = canvasState.getNode(existing.id)!;
  canvasState.switchBoard(null);
  const generation = canvasState.boardGeneration;
  await add({ expectedBoardId: null });
  expect(canvasState.activeBoardId).toBeNull();
  expect(canvasState.boardGeneration).toBe(generation);
  expect(canvasState.getLayout().nodes).toHaveLength(0);
  await expect(add({ destinationBoardId: undefined, requestId: 'home-retry' })).rejects.toThrow('Open a board');
  expect(canvasState.activeBoardId).toBeNull();
  expect(canvasState.boardGeneration).toBe(generation);
  canvasState.switchBoard(b);
  expect(canvasState.getNode(existing.id)).toEqual(before);
  canvasState.setContextPins([]);
  expect(canvasState.getNode(existing.id)!.pinned).toBe(false);
});

test('explicit identity survives restart, rejects mismatches, and never resurrects removed nodes', async () => {
  const first = await add({ requestId: 'logical-1' });
  expect((await add({ requestId: 'logical-1' })).id).toBe(first.id);
  await expect(add({ requestId: 'logical-1', content: 'different' })).rejects.toThrow('different creation');
  await expect(add({ requestId: 'logical-1', destinationBoardId: a })).rejects.toThrow('different creation');
  expect((await add({ requestId: 'logical-2' })).id).not.toBe(first.id);
  canvasState.close();
  canvasState.setWorkspaceRoot(root);
  canvasState.loadFromDisk();
  expect((await add({ requestId: 'logical-1' })).id).toBe(first.id);
  canvasState.switchBoard(b);
  canvasState.removeNode(first.id);
  canvasState.flushToDisk();
  canvasState.switchBoard(a);
  canvasState.close();
  canvasState.setWorkspaceRoot(root);
  canvasState.loadFromDisk();
  expect((await add({ requestId: 'logical-1' })).id).toBe(first.id);
  expect(canvasState.readBoard(b)!.layout.nodes).toHaveLength(1);
});

test('active and destination fences refuse static creation, including the SDK path', async () => {
  const anchor = new PmxCanvas().addNode({ type: 'markdown', title: 'Anchor' });
  canvasState.setPolicy({ scope: { nodeIds: [anchor.id], padding: 0 } });
  await expect(add()).rejects.toThrow('scope');
  expect(() => new PmxCanvas().addNode({ type: 'markdown', destinationBoardId: b })).toThrow('scope fence');
  canvasState.setPolicy({ scope: null });
  canvasState.switchBoard(b);
  const target = new PmxCanvas().addNode({ type: 'markdown', title: 'Target' });
  canvasState.setPolicy({ scope: { nodeIds: [target.id], padding: 0 } });
  canvasState.switchBoard(a);
  await expect(add()).rejects.toThrow('scope fence');
});

test('batch retries retain named refs and prefix commits without duplicating static creations', async () => {
  const operations = [
    {
      op: 'node.add',
      assign: 'first',
      args: { type: 'markdown', destinationBoardId: b, requestId: 'batch-1', title: 'First' },
    },
    {
      op: 'node.add',
      assign: 'second',
      args: { type: 'markdown', destinationBoardId: b, requestId: 'batch-2', content: '$first' },
    },
    { op: 'node.add', args: { type: 'file', destinationBoardId: b } },
  ];
  const first = await runCanvasBatchOperation(operations);
  const retry = await runCanvasBatchOperation(operations);
  expect(first.ok).toBe(false);
  expect(first.failedIndex).toBe(2);
  expect(retry.results.map((result) => result.id)).toEqual(first.results.map((result) => result.id));
  const nodes = canvasState.readBoard(b)!.layout.nodes;
  expect(nodes).toHaveLength(2);
  expect(nodes[1]!.data.content).toBe(first.results[0]!.id);
  expect(canvasState.activeBoardId).toBe(a);
});

test('node and request receipt roll back together on database failure', async () => {
  const db = new Database(canvasState.databasePath!);
  db.exec(
    "CREATE TRIGGER reject_receipt BEFORE INSERT ON node_creation_requests BEGIN SELECT RAISE(FAIL, 'receipt rejected'); END",
  );
  try {
    await expect(add({ requestId: 'atomic' })).rejects.toThrow('receipt rejected');
    expect(canvasState.readBoard(b)!.layout.nodes).toHaveLength(0);
  } finally {
    db.exec('DROP TRIGGER reject_receipt');
    db.close();
  }
  await add({ requestId: 'atomic' });
  expect(canvasState.readBoard(b)!.layout.nodes).toHaveLength(1);
});

test('active batch replay resolves named content refs from the creation receipt after a later edit', async () => {
  const operations = [
    { op: 'node.add', assign: 'first', args: { type: 'markdown', requestId: 'active-batch-1', content: 'original' } },
    { op: 'node.add', args: { type: 'markdown', requestId: 'active-batch-2', content: '$first.data.content' } },
  ];
  const first = await runCanvasBatchOperation(operations);
  expect(first.ok).toBe(true);
  const id = first.results[0]!.id as string;
  canvasState.updateNode(id, { data: { ...canvasState.getNode(id)!.data, content: 'later edit' } });
  const replay = await runCanvasBatchOperation(operations);
  expect(replay.ok).toBe(true);
  expect(replay.results).toEqual(first.results);
  expect(canvasState.getNode(id)!.data.content).toBe('later edit');
  expect(canvasState.getLayout().nodes).toHaveLength(2);
});

test('SDK active-board retry creation is durable and intentional identical content remains distinct', () => {
  const sdk = new PmxCanvas();
  const first = sdk.addNode({ type: 'markdown', requestId: 'sdk-1', content: 'same' });
  expect(sdk.addNode({ type: 'markdown', requestId: 'sdk-1', content: 'same' }).id).toBe(first.id);
  expect(sdk.addNode({ type: 'markdown', requestId: 'sdk-2', content: 'same' }).id).not.toBe(first.id);
  expect(canvasState.getLayout().nodes).toHaveLength(2);
});

test('creation receipts and live clocks agree, and inactive wiki links include unsaved active targets', async () => {
  const sdk = new PmxCanvas();
  const target = sdk.addNode({ type: 'markdown', title: 'Target' });
  sdk.updateNode(target.id, { title: 'Renamed target' });
  const before = canvasState.getNode(target.id)!;
  const first = await add({ requestId: 'wiki-create', content: '[[A#Renamed target]]' });
  const source = canvasState.readBoard(b)!.layout.nodes.find((node) => node.id === first.id)!;
  expect(source.data.wikiLinks).toMatchObject([{ target: { boardId: a, cardId: target.id } }]);
  const after = canvasState.getNode(target.id)!;
  expect(after.linksRevision!).toBeGreaterThan(before.linksRevision ?? 0);
  expect(after.contentRevision).toBe(before.contentRevision);
  expect(after.freshnessStartedAt).toBe(before.freshnessStartedAt);
  const live = sdk.addNode({ type: 'markdown', requestId: 'active-receipt', content: '[[A#Renamed target]]' });
  const db = new Database(canvasState.databasePath!);
  try {
    const row = db
      .query<{ node: string }, [string]>('SELECT node FROM node_creation_requests WHERE request_id = ?')
      .get('active-receipt')!;
    const receipt = JSON.parse(row.node);
    expect(canvasState.getNode(live.id)).toEqual(receipt);
    expect(loadStateFromDB(db, a)!.nodes.find((node) => node.id === live.id)).toEqual(receipt);
    canvasState.flushToDisk();
    expect(loadStateFromDB(db, a)!.nodes.find((node) => node.id === target.id)!.linksRevision).toBe(
      canvasState.getNode(target.id)!.linksRevision,
    );
  } finally {
    db.close();
  }
  const revision = canvasState.getContentRevision();
  await add({ requestId: 'wiki-create', content: '[[A#Renamed target]]' });
  expect(canvasState.getContentRevision()).toEqual(revision);
});

test.each([
  false,
  true,
])('receipt failure leaves endpoint clocks and active memory unchanged (active destination: %s)', async (active) => {
  const target = new PmxCanvas().addNode({ type: 'markdown', title: 'Target' });
  canvasState.flushToDisk();
  const before = canvasState.getLayout();
  const revision = canvasState.getContentRevision();
  const history = mutationHistory.getSummaries();
  const db = new Database(canvasState.databasePath!);
  const stored = loadStateFromDB(db, a);
  db.exec(
    "CREATE TRIGGER reject_receipt BEFORE INSERT ON node_creation_requests BEGIN SELECT RAISE(FAIL, 'receipt rejected'); END",
  );
  try {
    await expect(
      add({ destinationBoardId: active ? a : b, requestId: 'atomic-links', content: '[[A#Target]]' }),
    ).rejects.toThrow('receipt rejected');
    expect(canvasState.getLayout()).toEqual(before);
    expect(canvasState.getContentRevision()).toEqual(revision);
    expect(mutationHistory.getSummaries()).toEqual(history);
    expect(loadStateFromDB(db, a)).toEqual(stored);
    expect(canvasState.getNode(target.id)!.linksRevision).toBe(before.nodes[0]!.linksRevision);
  } finally {
    db.exec('DROP TRIGGER reject_receipt');
    db.close();
  }
});

test('HTTP and stdio MCP expose the same destination and persistent request identity contract', async () => {
  const base = startCanvasServer({ workspaceRoot: root, port: 0, autoOpenBrowser: false })!;
  const transport = new StdioClientTransport({
    command: 'bun',
    args: ['run', fileURLToPath(new URL('../../src/mcp/server.ts', import.meta.url))],
    cwd: root,
    env: {
      ...process.env,
      PMX_CANVAS_URL: base,
      PMX_CANVAS_PORT: new URL(base).port,
      PMX_CANVAS_DISABLE_BROWSER_OPEN: '1',
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'destination-test', version: '1' }, { capabilities: {} });
  try {
    await client.connect(transport);
    const body = {
      type: 'markdown',
      content: 'transport',
      destinationBoardId: b,
      expectedBoardId: a,
      requestId: 'transport-1',
    };
    const post = (input: Record<string, unknown>) =>
      fetch(`${base}/api/canvas/node`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
    const response = await post(body);
    expect(response.status).toBe(200);
    const first = (await response.json()) as { id: string };
    const replay = (await client.callTool({ name: 'canvas_node', arguments: { action: 'add', ...body } })) as {
      content: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    expect(replay.isError).not.toBe(true);
    const text = replay.content.find((item) => item.type === 'text');
    expect(JSON.parse(text?.text ?? '{}').id).toBe(first.id);
    expect((await post({ ...body, expectedBoardId: b })).status).toBe(409);
    expect((await post({ ...body, content: 'different' })).status).toBe(409);
    expect(canvasState.activeBoardId).toBe(a);
    expect(canvasState.getLayout().nodes).toHaveLength(0);
    expect(canvasState.readBoard(b)!.layout.nodes).toHaveLength(1);
    expect((await fetch(`${base}/canvas/index.js`)).status).toBe(200);
  } finally {
    await client.close();
    await transport.close();
  }
});
