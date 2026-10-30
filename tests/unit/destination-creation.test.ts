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
import { humanPresence } from '../../src/server/human-presence.js';
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

test('SDK ordinary group and edge creation reject a stale active-board guard without mutations', () => {
  const sdk = new PmxCanvas();
  canvasState.switchBoard(b);
  const one = sdk.addNode({ type: 'markdown', title: 'One' });
  const two = sdk.addNode({ type: 'markdown', title: 'Two' });
  const before = canvasState.getLayout();
  expect(() => sdk.createGroup({ childIds: [one.id, two.id], expectedBoardId: a })).toThrow('active board changed');
  expect(() => sdk.addEdge({ from: one.id, to: two.id, type: 'flow', expectedBoardId: a })).toThrow(
    'active board changed',
  );
  expect(canvasState.getLayout()).toEqual(before);
  const group = sdk.createGroup({ childIds: [one.id, two.id], expectedBoardId: b });
  const edge = sdk.addEdge({ from: one.id, to: two.id, type: 'flow', expectedBoardId: b });
  expect(canvasState.getNode(group)?.data.children).toEqual([one.id, two.id]);
  expect(canvasState.getEdges().find((entry) => entry.id === edge)).toMatchObject({ from: one.id, to: two.id });
});

test('background batch creates cards, a containing group and relations, with stable retry receipts', async () => {
  const events: string[] = [];
  setOperationEventEmitter((event) => events.push(event));
  const before = canvasState.getLayout();
  const generation = canvasState.boardGeneration;
  const operations = [
    {
      op: 'node.add',
      assign: 'one',
      args: { type: 'markdown', title: 'One', x: 100, y: 150, destinationBoardId: b, requestId: 'flow-one' },
    },
    {
      op: 'node.add',
      assign: 'two',
      args: { type: 'markdown', title: 'Two', x: 850, y: 350, destinationBoardId: b, requestId: 'flow-two' },
    },
    {
      op: 'group.create',
      assign: 'frame',
      args: {
        title: 'Research',
        childIds: ['$one', '$two'],
        destinationBoardId: b,
        expectedBoardId: a,
        requestId: 'flow-group',
      },
    },
    {
      op: 'edge.add',
      assign: 'link',
      args: {
        from: '$one',
        to: '$two',
        type: 'references',
        destinationBoardId: b,
        expectedBoardId: a,
        requestId: 'flow-edge',
      },
    },
  ];
  const first = await runCanvasBatchOperation(operations);
  expect(first.ok).toBe(true);
  const replay = await runCanvasBatchOperation(operations);
  expect(replay).toEqual(first);
  expect(canvasState.activeBoardId).toBe(a);
  expect(canvasState.boardGeneration).toBe(generation);
  expect(canvasState.getLayout()).toEqual(before);
  expect(mutationHistory.canUndo()).toBe(false);
  expect(events).not.toContain('canvas-layout-update');
  const stored = canvasState.readBoard(b)!.layout;
  expect(stored.nodes).toHaveLength(3);
  expect(stored.edges).toHaveLength(1);
  const group = stored.nodes.find((node) => node.type === 'group')!;
  const cards = stored.nodes.filter((node) => node.type === 'markdown');
  expect(group.data.children).toEqual(cards.map((node) => node.id));
  expect(cards.every((node) => node.data.parentGroup === group.id)).toBe(true);
  for (const card of cards) {
    expect(card.position.x).toBeGreaterThan(group.position.x);
    expect(card.position.y).toBeGreaterThan(group.position.y);
    expect(card.position.x + card.size.width).toBeLessThan(group.position.x + group.size.width);
    expect(card.position.y + card.size.height).toBeLessThan(group.position.y + group.size.height);
    expect(card.linksRevision).toBeGreaterThan(card.contentRevision!);
  }
  canvasState.close();
  canvasState.setWorkspaceRoot(root);
  canvasState.loadFromDisk();
  expect(await runCanvasBatchOperation(operations)).toEqual(first);
  canvasState.switchBoard(b);
  canvasState.updateNode(group.id, { data: { ...group.data, title: 'Human edit' } });
  canvasState.removeEdge(stored.edges[0]!.id);
  canvasState.switchBoard(a);
  expect(await runCanvasBatchOperation(operations)).toEqual(first);
  expect(canvasState.readBoard(b)!.layout.edges).toHaveLength(0);
  expect(canvasState.readBoard(b)!.layout.nodes.find((node) => node.id === group.id)!.data.title).toBe('Human edit');
});

test('background group and edge controls preserve guards, locks, scope, and atomic rollback', async () => {
  const one = await add({ title: 'One' });
  const two = await add({ title: 'Two' });
  const group = { childIds: [one.id, two.id], destinationBoardId: b, expectedBoardId: a, requestId: 'guard-group' };
  const edge = {
    from: one.id,
    to: two.id,
    type: 'flow',
    destinationBoardId: b,
    expectedBoardId: a,
    requestId: 'guard-edge',
  };
  for (const [op, input] of [
    ['group.create', group],
    ['edge.add', edge],
  ] as const) {
    await expect(executeOperation(op, { ...input, expectedBoardId: b })).rejects.toThrow('active board changed');
    humanPresence.set({ clientId: 'locked', name: 'Human', grabbingNodeId: one.id });
    try {
      await expect(executeOperation(op, input)).rejects.toThrow('being edited');
    } finally {
      humanPresence.reset();
    }
    const db = new Database(canvasState.databasePath!);
    const before = canvasState.readBoard(b)!.layout;
    db.exec(
      "CREATE TRIGGER reject_receipt BEFORE INSERT ON node_creation_requests BEGIN SELECT RAISE(FAIL, 'receipt rejected'); END",
    );
    try {
      await expect(executeOperation(op, input)).rejects.toThrow('receipt rejected');
      expect(canvasState.readBoard(b)!.layout).toEqual(before);
    } finally {
      db.exec('DROP TRIGGER reject_receipt');
      db.close();
    }
  }
  await expect(executeOperation('group.create', { ...group, childIds: [one.id, 'missing'] })).rejects.toThrow(
    'missing',
  );
  await expect(executeOperation('edge.add', { ...edge, to: 'missing' })).rejects.toThrow('not found');
  canvasState.switchBoard(b);
  canvasState.setPolicy({ scope: { nodeIds: [one.id], padding: 0 } });
  canvasState.switchBoard(a);
  await expect(executeOperation('group.create', group)).rejects.toThrow('scope fence');
  await expect(executeOperation('edge.add', edge)).rejects.toThrow('scope fence');
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

test('SDK background grouping/search and cross-board links preserve ownership, clocks, freshness and undo', async () => {
  startCanvasServer({ workspaceRoot: root, port: 0, autoOpenBrowser: false });
  const sdk = new PmxCanvas();
  const active = sdk.addNode({ type: 'markdown', title: 'Active target' });
  const one = await add({ title: 'Needle one', x: 120, y: 140 });
  const two = await add({ title: 'Needle two', x: 800, y: 350 });
  const original = canvasState.readBoard(b)!.layout.nodes;
  const input = { childIds: [one.id, two.id], destinationBoardId: b, expectedBoardId: a, requestId: 'sdk-group' };
  const groupId = sdk.createGroup(input);
  expect(sdk.createGroup(input)).toBe(groupId);
  expect(
    sdk
      .search('Needle', { boardId: b })
      .map((result) => result.id)
      .sort(),
  ).toEqual([one.id, two.id].sort());
  expect(sdk.search('Needle', { boardId: b, scope: 'active' })).toEqual([]);
  const beforeTarget = canvasState.getNode(active.id)!;
  const link = {
    fromSearch: 'Needle two',
    to: active.id,
    toBoardId: a,
    type: 'references' as const,
    destinationBoardId: b,
    requestId: 'sdk-link',
  };
  const edgeId = sdk.addEdge(link);
  expect(sdk.addEdge(link)).toBe(edgeId);
  const stored = canvasState.readBoard(b)!.layout;
  expect(stored.edges[0]).toMatchObject({ id: edgeId, from: two.id, to: active.id, toBoardId: a });
  expect(canvasState.getNode(active.id)!.linksRevision!).toBeGreaterThan(beforeTarget.linksRevision ?? 0);
  expect(canvasState.getNode(active.id)!.contentRevision).toBe(beforeTarget.contentRevision);
  for (const node of original)
    expect(stored.nodes.find((item) => item.id === node.id)!.freshnessStartedAt).toBe(node.freshnessStartedAt);
  expect(canvasState.activeBoardId).toBe(a);
  canvasState.switchBoard(b);
  mutationHistory.reset();
  const outerId = sdk.createGroup({
    title: 'Outer',
    childIds: [groupId],
    requestId: 'active-group',
    childLayout: 'grid',
  });
  const fresh = canvasState.getNode(outerId)!.freshnessStartedAt;
  await sdk.undo();
  expect(canvasState.getNode(outerId)).toBeUndefined();
  expect(canvasState.getNode(groupId)!.data.parentGroup).toBeUndefined();
  await sdk.redo();
  expect(canvasState.getNode(groupId)!.data.parentGroup).toBe(outerId);
  expect(canvasState.getNode(outerId)!.freshnessStartedAt).toBe(fresh);
  const newEdgeId = sdk.addEdge({ from: one.id, to: two.id, type: 'flow', requestId: 'active-edge' });
  const linksRevision = canvasState.getNode(one.id)!.linksRevision!;
  await sdk.undo();
  expect(canvasState.getEdges().some((edge) => edge.id === newEdgeId)).toBe(false);
  expect(canvasState.getNode(one.id)!.linksRevision!).toBeGreaterThan(linksRevision);
  await sdk.redo();
  expect(canvasState.getEdges().some((edge) => edge.id === newEdgeId)).toBe(true);
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
    const second = (await (await post({ ...body, title: 'Other', requestId: 'transport-2' })).json()) as { id: string };
    const group = await client.callTool({
      name: 'canvas_group',
      arguments: {
        action: 'create',
        childIds: [first.id, second.id],
        destinationBoardId: b,
        expectedBoardId: a,
        requestId: 'transport-group',
      },
    });
    expect(group.isError).not.toBe(true);
    const edge = await client.callTool({
      name: 'canvas_edge',
      arguments: {
        action: 'add',
        from: first.id,
        to: second.id,
        type: 'references',
        destinationBoardId: b,
        expectedBoardId: a,
        requestId: 'transport-edge',
      },
    });
    expect(edge.isError).not.toBe(true);
    const stored = canvasState.readBoard(b)!.layout;
    expect(stored.nodes).toHaveLength(3);
    expect(stored.edges).toHaveLength(1);
    expect(
      stored.nodes
        .filter((node) => node.type === 'markdown')
        .every((node) => node.data.parentGroup === stored.nodes.find((item) => item.type === 'group')!.id),
    ).toBe(true);
    expect(canvasState.activeBoardId).toBe(a);
    expect((await fetch(`${base}/canvas/index.js`)).status).toBe(200);
  } finally {
    await client.close();
    await transport.close();
  }
});
