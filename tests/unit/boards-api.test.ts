import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { CanvasBoard } from '../../src/server/canvas-db.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import { createCanvas } from '../../src/server/index.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import { workbenchToken } from '../../src/server/workbench-auth.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

interface BoardsBody {
  ok: boolean;
  activeBoardId: string | null;
  boards: CanvasBoard[];
  error?: string;
}

let workspaceRoot = '';
let baseUrl = '';
const HUMAN = {
  'Content-Type': 'application/json',
  'x-pmx-workbench': '1',
  'x-pmx-workbench-token': workbenchToken,
};
const MARKER_ONLY = { 'Content-Type': 'application/json', 'x-pmx-workbench': '1' };
const AGENT = { 'Content-Type': 'application/json', 'x-pmx-source': 'codex' };

beforeAll(() => {
  workspaceRoot = createTestWorkspace('pmx-canvas-boards-api-');
  resetCanvasForTests(workspaceRoot);
  const base = startCanvasServer({ workspaceRoot, port: 0 });
  if (!base) throw new Error('Failed to start canvas server for tests.');
  baseUrl = base.replace(/\/$/, '');
});

afterAll(() => {
  stopCanvasServer();
  removeTestWorkspace(workspaceRoot);
});

async function call(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as BoardsBody & Record<string, unknown> };
}

const boards = async () => (await call('GET', '/api/canvas/boards', AGENT)).body;
const addNote = (title: string, headers = AGENT) =>
  call('POST', '/api/canvas/node', headers, { type: 'markdown', title, content: title });

describe('boards over HTTP', () => {
  test('agents write to the open board; Home opens the most recent board, or a new one when there are none', async () => {
    expect(await boards()).toMatchObject({ activeBoardId: null, boards: [] });

    // No boards yet: the agent's first write creates and opens one.
    await addNote('First note');
    const first = await boards();
    expect(first.boards).toHaveLength(1);
    expect(first.activeBoardId).toBe(first.boards[0].id);

    // An agent may create a board, but it does not open.
    const created = await call('POST', '/api/canvas/boards', AGENT, { name: 'Planning' });
    expect(created.status).toBe(200);
    const planning = (created.body.board as CanvasBoard).id;
    expect((await boards()).activeBoardId).toBe(first.activeBoardId);

    // Agents can open boards, but deletion still requires trusted human authority.
    expect((await call('DELETE', `/api/canvas/boards/${planning}`, AGENT)).status).toBe(403);
    expect((await call('DELETE', `/api/canvas/boards/${planning}`, MARKER_ONLY)).status).toBe(403);

    const opened = await call('POST', '/api/canvas/boards/open', AGENT, { id: planning });
    expect(opened.status).toBe(200);
    expect(opened.body.activeBoardId).toBe(planning);
    expect(((await (await fetch(`${baseUrl}/api/canvas/state`)).json()) as { nodes: unknown[] }).nodes).toEqual([]);

    const staleDrop = await call('POST', '/api/canvas/node', HUMAN, {
      type: 'markdown',
      title: 'Delayed drop',
      content: 'Belongs to the first board',
      boardId: first.activeBoardId,
    });
    expect(staleDrop.status).toBe(409);
    expect(((await (await fetch(`${baseUrl}/api/canvas/state`)).json()) as { nodes: unknown[] }).nodes).toEqual([]);

    // Writes follow the open board, without changing the previous board's content.
    await addNote('Planning note');
    expect((await boards()).boards.find((board) => board.id === planning)?.nodeCount).toBe(1);
    const original = await call('GET', `/api/canvas/state?board=${first.activeBoardId}`, AGENT);
    expect((original.body.nodes as Array<{ title: string }>).map((node) => node.title)).toEqual(['First note']);
    expect((await call('POST', '/api/canvas/boards/open', AGENT, { id: 'missing' })).status).toBe(404);
    expect((await boards()).activeBoardId).toBe(planning);

    // A board created later but never opened does not count as recent.
    await call('POST', '/api/canvas/boards', AGENT, { name: 'Never opened' });

    // Back on Home, a clear opens nothing (it would wipe the board it opened)...
    await call('POST', '/api/canvas/boards/open', HUMAN, { id: null });
    await call('POST', '/api/canvas/clear', AGENT);
    expect((await boards()).activeBoardId).toBeNull();

    // ...and the next write opens the most recently opened board, Planning.
    await addNote('Back to planning');
    const after = await boards();
    expect(after.activeBoardId).toBe(planning);
    expect(after.boards).toHaveLength(3);
    expect(after.boards.find((board) => board.id === planning)?.nodeCount).toBe(2);
  });

  test('resolving a pending approval from Home reopens its recent board', async () => {
    const created = await call('POST', '/api/canvas/ax/approval', AGENT, {
      title: 'Ship release',
      detail: 'Approve deployment',
    });
    const approvalId = String((created.body.approvalGate as { id: string }).id);
    const recentBoardId = (await boards()).activeBoardId;

    await call('POST', '/api/canvas/boards/open', HUMAN, { id: null });
    expect((await boards()).activeBoardId).toBeNull();

    const resolved = await call('POST', `/api/canvas/ax/approval/${approvalId}/resolve`, HUMAN, {
      decision: 'approved',
    });
    expect(resolved.status).toBe(200);
    expect((await boards()).activeBoardId).toBe(recentBoardId);
    expect((resolved.body.approvalGate as { status: string }).status).toBe('approved');
  });

  test('boards are filed under categories, which can be changed and cleared', async () => {
    const created = await call('POST', '/api/canvas/boards', AGENT, { name: 'OKR April', category: 'Planning' });
    const id = (created.body.board as CanvasBoard).id;
    expect((created.body.board as CanvasBoard).category).toBe('Planning');

    await call('PATCH', `/api/canvas/boards/${id}`, AGENT, { category: 'Quarterly' });
    const moved = (await boards()).boards.find((board) => board.id === id);
    expect(moved).toMatchObject({ name: 'OKR April', category: 'Quarterly' });

    await call('PATCH', `/api/canvas/boards/${id}`, AGENT, { category: '' });
    expect((await boards()).boards.find((board) => board.id === id)?.category).toBeNull();
    expect((await call('PATCH', `/api/canvas/boards/${id}`, AGENT, { category: 'x'.repeat(61) })).status).toBe(400);
  });

  test('nested folder paths normalize, persist and reject ambiguous segments without changing the board', async () => {
    const created = await call('POST', '/api/canvas/boards', AGENT, {
      name: 'Decision record',
      category: ' Engineering / Canvas / Decisions ',
    });
    expect(created.status).toBe(200);
    const board = created.body.board as CanvasBoard;
    expect(board.category).toBe('Engineering/Canvas/Decisions');
    const deep = Array.from({ length: 8 }, (_, index) => `Folder ${index}`).join('/');
    expect((await call('PATCH', `/api/canvas/boards/${board.id}`, AGENT, { category: deep })).status).toBe(200);
    for (const category of ['A//B', '/A', 'A/', 'A/../B', `${deep}/Ninth`, `A/${'x'.repeat(61)}`]) {
      expect(
        (await call('PATCH', `/api/canvas/boards/${board.id}`, AGENT, { category, name: 'Must not rename' })).status,
      ).toBe(400);
    }
    const read = await call('GET', `/api/canvas/boards/${board.id}`, AGENT);
    expect(read.body.board).toMatchObject({ id: board.id, name: 'Decision record', category: deep });
  });

  test('rename, get, and deleting the open board returns to Home', async () => {
    const { activeBoardId } = await boards();
    const id = activeBoardId as string;
    await call('PATCH', `/api/canvas/boards/${id}`, AGENT, { name: 'Renamed' });
    const got = await call('GET', `/api/canvas/boards/${id}`, AGENT);
    expect(got.body).toMatchObject({ open: true, board: { id, name: 'Renamed' } });
    expect((await call('PATCH', `/api/canvas/boards/${id}`, AGENT, { name: '  ' })).status).toBe(400);

    const deleted = await call('DELETE', `/api/canvas/boards/${id}`, HUMAN);
    expect(deleted.body.activeBoardId).toBeNull();
    expect(deleted.body.boards.some((board) => board.id === id)).toBe(false);
    expect((await call('GET', `/api/canvas/boards/${id}`, AGENT)).status).toBe(404);
  });

  test('reads an inactive board without switching the active board', async () => {
    const first = await call('POST', '/api/canvas/boards', AGENT, { name: 'Read target' });
    const targetId = (first.body.board as CanvasBoard).id;
    await call('POST', '/api/canvas/boards/open', HUMAN, { id: targetId });
    const inactiveCreated = await call('POST', '/api/canvas/node', AGENT, {
      type: 'markdown',
      title: 'Inactive title',
      content: 'inactive content',
    });
    const inactiveNodeId = String(inactiveCreated.body.id);
    const inactiveNode = canvasState.getNode(inactiveNodeId)!;
    const blob = 'inactive tool result '.repeat(300);
    canvasState.addNode({ ...inactiveNode, id: 'blob-node', type: 'mcp-app', data: { toolResult: blob } });
    await call('POST', '/api/canvas/context-pins', HUMAN, { nodeIds: [inactiveNodeId] });

    const second = await call('POST', '/api/canvas/boards', AGENT, { name: 'Still active' });
    const activeId = (second.body.board as CanvasBoard).id;
    await call('POST', '/api/canvas/boards/open', HUMAN, { id: activeId });
    canvasState.addNode({ ...inactiveNode, data: { title: 'Same id, active board', content: 'different' } });
    await call('POST', '/api/canvas/node', AGENT, {
      type: 'markdown',
      title: 'Active title',
      content: 'active content',
    });

    const targetNode = await call('GET', `/api/canvas/node/${inactiveNodeId}?board=${targetId}`, AGENT);
    expect(targetNode.body).toMatchObject({ id: inactiveNodeId, title: 'Inactive title' });
    const targetLayout = await call('GET', `/api/canvas/state?board=${targetId}`, AGENT);
    expect(
      (targetLayout.body.nodes as Array<{ id: string; title: string }>).find((node) => node.id === inactiveNodeId)
        ?.title,
    ).toBe('Inactive title');
    const targetPins = await call('GET', `/api/canvas/pinned-context?board=${targetId}`, AGENT);
    expect(targetPins.body).toMatchObject({ count: 1, nodeIds: [inactiveNodeId] });
    expect((await call('GET', `/api/canvas/summary?board=${targetId}`, AGENT)).body).toMatchObject({
      totalNodes: 2,
      pinnedCount: 1,
    });
    const full = await call('GET', `/api/canvas/node/blob-node?board=${targetId}&includeBlobs=true`, AGENT);
    expect(full.body.data).toMatchObject({ toolResult: blob });
    const compact = await call('GET', `/api/canvas/node/blob-node?board=${targetId}`, AGENT);
    expect(compact.body.data).toMatchObject({ toolResult: { stored: 'sidecar' } });
    const sdk = createCanvas();
    expect(sdk.getNode('blob-node', { board: targetId })?.data.toolResult).toBe(blob);
    expect(sdk.getLayout({ board: targetId }).nodes.find((node) => node.id === inactiveNodeId)?.pinned).toBe(true);
    const log = (await call('GET', '/api/canvas/ax/context-reads', HUMAN)).body.reads as Array<{
      boardId: string;
      resource: string;
      pinnedNodeIds: string[];
      deliveredNodeIds: string[];
    }>;
    expect(log.find((read) => read.resource === 'pinned-context.get')).toMatchObject({
      boardId: targetId,
      pinnedNodeIds: [inactiveNodeId],
      deliveredNodeIds: [inactiveNodeId],
    });
    expect((await boards()).activeBoardId).toBe(activeId);
    expect((await call('GET', `/api/canvas/node/${inactiveNodeId}`, AGENT)).body.title).toBe('Same id, active board');
    expect((await call('GET', '/api/canvas/state?board=missing', AGENT)).status).toBe(404);
  });
});
