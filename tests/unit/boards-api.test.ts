import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { CanvasBoard } from '../../src/server/canvas-db.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

interface BoardsBody {
  ok: boolean;
  activeBoardId: string | null;
  boards: CanvasBoard[];
  error?: string;
}

let workspaceRoot = '';
let baseUrl = '';
const HUMAN = { 'Content-Type': 'application/json', 'x-pmx-workbench': '1' };
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

    // Only the human opens or deletes a board.
    expect((await call('POST', '/api/canvas/boards/open', AGENT, { id: planning })).status).toBe(403);
    expect((await call('DELETE', `/api/canvas/boards/${planning}`, AGENT)).status).toBe(403);

    const opened = await call('POST', '/api/canvas/boards/open', HUMAN, { id: planning });
    expect(opened.body.activeBoardId).toBe(planning);
    expect(((await (await fetch(`${baseUrl}/api/canvas/state`)).json()) as { nodes: unknown[] }).nodes).toEqual([]);

    // Writes follow the human: the agent's next note lands on Planning.
    await addNote('Planning note');
    expect((await boards()).boards.find((board) => board.id === planning)?.nodeCount).toBe(1);

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
});
