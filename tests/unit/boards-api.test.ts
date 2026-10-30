import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Marked } from 'marked';
import type { CanvasBoard } from '../../src/server/canvas-db.ts';
import type { MemoryGraph } from '../../src/shared/memory-graph.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import { createCanvas } from '../../src/server/index.ts';
import { HttpOperationInvoker } from '../../src/server/operations/invoker.ts';
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
const addNote = (title: string, headers: Record<string, string> = AGENT) =>
  call('POST', '/api/canvas/node', headers, { type: 'markdown', title, content: title });

test('board-scoped HTTP writes stay isolated from navigation and survive restart', async () => {
  const invoke = new HttpOperationInvoker(baseUrl, 'routing-test');
  const a = canvasState.createBoard('Thread A')!;
  const b = canvasState.createBoard('Thread B')!;
  const visible = canvasState.createBoard('Human view')!;
  try {
    await invoke.invoke('board.open', { id: visible.id });
    const create = (targetBoardId: string, title: string) =>
      invoke.invoke('node.add', {
        targetBoardId,
        agentId: `thread-${title}`,
        type: 'markdown',
        title,
        content: title,
      }) as Promise<{ id: string }>;
    const [left, right] = await Promise.all([create(a.id, 'Left'), create(b.id, 'Right')]);
    expect(canvasState.visibleBoardId).toBe(visible.id);
    expect(canvasState.getLayout().nodes).toHaveLength(0);
    await Promise.all([
      invoke.invoke('node.update', { targetBoardId: a.id, id: left.id, content: 'Left updated' }),
      invoke.invoke('node.update', { targetBoardId: b.id, id: right.id, content: 'Right updated' }),
    ]);
    expect(canvasState.readBoard(a.id)!.layout.nodes.map((node) => node.data.content)).toEqual(['Left updated']);
    expect(canvasState.readBoard(b.id)!.layout.nodes.map((node) => node.data.content)).toEqual(['Right updated']);
    expect((await boards()).activeBoardId).toBe(visible.id);
    await expect(invoke.invoke('node.remove', { targetBoardId: b.id, id: left.id })).rejects.toThrow();
    await expect(
      invoke.invoke('node.add', {
        targetBoardId: a.id,
        destinationBoardId: b.id,
        type: 'markdown',
        content: 'Wrong board',
      }),
    ).rejects.toThrow('conflicts');
    await expect(create('missing-board', 'Missing')).rejects.toThrow('not found');
    await expect(invoke.invoke('board.update', { targetBoardId: a.id, id: b.id, name: 'Wrong board' })).rejects.toThrow(
      'conflicts',
    );
    await invoke.invoke('board.update', { targetBoardId: a.id, id: a.id, name: 'Renamed A' });
    expect(canvasState.readBoard(a.id)!.board.name).toBe('Renamed A');
    stopCanvasServer();
    baseUrl = startCanvasServer({ workspaceRoot, port: 0 })!;
    expect(canvasState.visibleBoardId).toBe(visible.id);
    expect(canvasState.readBoard(a.id)!.layout.nodes.map((node) => node.data.content)).toEqual(['Left updated']);
    expect(canvasState.readBoard(b.id)!.layout.nodes.map((node) => node.data.content)).toEqual(['Right updated']);
    // Leave the shared fixture on Home, as the following navigation scenario expects.
    const scopedDelete = await call('DELETE', `/api/canvas/boards/${a.id}?targetBoardId=${a.id}`, HUMAN);
    expect(scopedDelete.status).toBe(409);
    expect(scopedDelete.body.error).toContain('shared view or workspace');
    expect((await call('DELETE', `/api/canvas/boards/${a.id}`, HUMAN)).status).toBe(200);
    expect(canvasState.visibleBoardId).toBe(visible.id);
  } finally {
    for (const board of [a, b, visible]) canvasState.deleteBoard(board.id);
  }
});

test('background loading keeps unsaved theme changes and targeted tours keep the visible delivery generation', async () => {
  const invoke = new HttpOperationInvoker(baseUrl, 'routing-test');
  const board = canvasState.createBoard('Tour scope')!;
  const originalTheme = canvasState.theme;
  try {
    canvasState.setTheme('harbor');
    canvasState.flushToDisk();
    canvasState.setTheme('daylight');
    await invoke.invoke('tour.set', {
      targetBoardId: board.id,
      tour: { stops: [{ target: { viewport: { x: 17, y: -85, scale: 0.6 } }, duration: 0 }] },
    });
    expect(canvasState.theme).toBe('daylight');
    await invoke.invoke('board.open', { id: board.id });
    expect(await invoke.invoke('tour.go', { targetBoardId: board.id, stop: 0 })).toMatchObject({
      index: 0,
      boardGeneration: canvasState.visibleBoardGeneration,
    });
    expect(await invoke.invoke('tour.get', {})).toMatchObject({ position: 0 });
    expect(await invoke.invoke('tour.get', { targetBoardId: board.id })).toMatchObject({ position: 0 });
  } finally {
    canvasState.setTheme(originalTheme);
    canvasState.deleteBoard(board.id);
  }
});

test('a bound steering wait wakes from another board but retains its board-bound pending work', async () => {
  const invoke = new HttpOperationInvoker(baseUrl, 'routing-test');
  const a = canvasState.createBoard('Steering recipient')!;
  const b = canvasState.createBoard('Human sender')!;
  const consumer = `amp:wait-${a.id}`;
  try {
    await invoke.invoke('board.open', { id: b.id });
    await invoke.invoke('node.add', { targetBoardId: a.id, agentId: consumer, type: 'markdown', title: 'Recipient' });
    await invoke.invoke('ax.approval.request', { targetBoardId: a.id, title: 'A gate' });
    await invoke.invoke('ax.approval.request', { targetBoardId: b.id, title: 'B gate' });
    const pending = invoke.invoke(
      'ax.delivery.pending',
      { targetBoardId: a.id, consumer, timeoutMs: 5000 },
      { signal: AbortSignal.timeout(2000) },
    );
    // The public presence timestamp is set when the claim handler enters its wait.
    let claimed = false;
    for (let n = 0; n < 50; n++) {
      const presence = await (await fetch(`${baseUrl}/api/canvas/ax/presence`)).json();
      claimed = presence.presences.some(
        (item: { sessionId: string; lastClaimAt?: string }) => item.sessionId === consumer && item.lastClaimAt,
      );
      if (claimed) break;
      await Bun.sleep(10);
    }
    expect(claimed).toBe(true);
    const { body } = await call('POST', '/api/canvas/ax/steer', HUMAN, {
      message: 'Continue A from B',
      target: consumer,
    });
    const result = (await pending) as { pending: Array<{ id: string }>; pendingActivity: unknown };
    expect(result.pending.map((item) => item.id)).toContain((body.steering as { id: string }).id);
    expect(JSON.stringify(result.pendingActivity)).toContain('A gate');
    expect(JSON.stringify(result.pendingActivity)).not.toContain('B gate');
    expect(canvasState.visibleBoardId).toBe(b.id);
  } finally {
    canvasState.deleteBoard(a.id);
    canvasState.deleteBoard(b.id);
  }
});

test('board-scoped HTTP batches and approval waits retain their board and actor', async () => {
  const invoke = new HttpOperationInvoker(baseUrl, 'routing-test');
  const a = canvasState.createBoard('Background approvals')!;
  const b = canvasState.createBoard('Visible approvals')!;
  try {
    await invoke.invoke('board.open', { id: b.id });
    const batch = await invoke.invoke('canvas.batch', {
      targetBoardId: a.id,
      agentId: 'amp:thread-A',
      operations: [
        { op: 'node.add', args: { type: 'markdown', content: 'A only' } },
        { op: 'node.add', args: { type: 'prompt', targetBoardId: b.id, text: 'Must not escape' } },
      ],
    });
    expect(batch).toMatchObject({ ok: false, failedIndex: 1 });
    const created = canvasState.readBoard(a.id)!.layout.nodes;
    expect(created).toHaveLength(1);
    expect(created[0].lastEditedBy?.agentId).toBe('amp:thread-A');
    expect(canvasState.getLayout().nodes).toHaveLength(0);
    const requested = (await invoke.invoke('ax.approval.request', {
      targetBoardId: a.id,
      agentId: 'amp:thread-A',
      title: 'Approve A',
    })) as { approvalGate: { id: string } };
    const started = Promise.withResolvers<void>();
    const pending = invoke.invoke(
      'ax.approval.get',
      {
        targetBoardId: a.id,
        id: requested.approvalGate.id,
        timeoutMs: 2000,
      },
      { onProgress: () => started.resolve() },
    );
    await started.promise;
    await invoke.invoke('ax.approval.request', { targetBoardId: b.id, title: 'Unrelated gate' });
    await invoke.invoke('board.open', { id: null });
    await invoke.invoke('ax.approval.resolve', {
      targetBoardId: a.id,
      id: requested.approvalGate.id,
      decision: 'approved',
    });
    expect(await pending).toMatchObject({
      approvalGate: { id: requested.approvalGate.id, status: 'approved' },
      pending: false,
    });
    expect(canvasState.visibleBoardId).toBeNull();
    const gate = (await invoke.invoke('ax.approval.request', { targetBoardId: a.id, title: 'Deleted wait' })) as {
      approvalGate: { id: string };
    };
    const waiting = Promise.withResolvers<void>();
    const deleted = invoke
      .invoke(
        'ax.approval.get',
        { targetBoardId: a.id, id: gate.approvalGate.id, timeoutMs: 2000 },
        { onProgress: () => waiting.resolve() },
      )
      .then(
        () => 'resolved',
        (error) => String(error),
      );
    await waiting.promise;
    canvasState.deleteBoard(a.id);
    expect(await deleted).toContain('deleted');
  } finally {
    for (const board of [a, b]) canvasState.deleteBoard(board.id);
  }
});

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

  test('boards are filed under folders, which can be changed and cleared', async () => {
    const created = await call('POST', '/api/canvas/boards', AGENT, { name: 'OKR April', folder: 'Planning' });
    const id = (created.body.board as CanvasBoard).id;
    expect((created.body.board as CanvasBoard).folder).toBe('Planning');

    await call('PATCH', `/api/canvas/boards/${id}`, AGENT, { folder: 'Quarterly' });
    const moved = (await boards()).boards.find((board) => board.id === id);
    expect(moved).toMatchObject({ name: 'OKR April', folder: 'Quarterly' });

    await call('PATCH', `/api/canvas/boards/${id}`, AGENT, { folder: '' });
    expect((await boards()).boards.find((board) => board.id === id)?.folder).toBeNull();
    expect((await call('PATCH', `/api/canvas/boards/${id}`, AGENT, { folder: 'x'.repeat(61) })).status).toBe(400);
  });

  test.each([
    'scope',
    'territory',
  ] as const)('inactive target %s fences folder changes without opening it', async (kind) => {
    const previousBoardId = (await boards()).activeBoardId;
    const target = (await call('POST', '/api/canvas/boards', HUMAN, { name: `Fenced ${kind}`, folder: 'Original' }))
      .body.board as CanvasBoard;
    const other = (await call('POST', '/api/canvas/boards', HUMAN, { name: `Unfenced ${kind}` })).body
      .board as CanvasBoard;
    await call('POST', '/api/canvas/boards/open', HUMAN, { id: target.id });
    const note = await addNote('Territory anchor', HUMAN);
    const fence = { nodeIds: [note.body.id], padding: 40 };
    expect(
      (
        await call(
          'POST',
          '/api/canvas/ax/policy',
          HUMAN,
          kind === 'scope' ? { scope: fence } : { agentScopes: { writer: fence } },
        )
      ).status,
    ).toBe(200);
    try {
      for (const active of [other.id, null]) {
        await call('POST', '/api/canvas/boards/open', HUMAN, { id: active });
        const blocked = await call('PATCH', `/api/canvas/boards/${target.id}`, AGENT, {
          folder: 'Escaped',
          agentId: 'writer',
        });
        expect(blocked.status).toBe(403);
        expect(blocked.body.error).toContain(kind === 'scope' ? 'scope fence' : 'assigned territory');
        expect((await call('GET', `/api/canvas/boards/${target.id}`, AGENT)).body.board).toMatchObject({
          folder: 'Original',
        });
        expect((await boards()).activeBoardId).toBe(active);
        expect(
          (await call('PATCH', `/api/canvas/boards/${target.id}`, AGENT, { name: `Renamed ${kind}` })).status,
        ).toBe(200);
        const control = await call('PATCH', `/api/canvas/boards/${target.id}`, AGENT, {
          folder: 'Other writer',
          agentId: 'different',
        });
        expect(control.status).toBe(kind === 'scope' ? 403 : 200);
        expect(
          (await call('PATCH', `/api/canvas/boards/${target.id}`, HUMAN, { folder: 'Human allowed' })).status,
        ).toBe(200);
        expect((await boards()).activeBoardId).toBe(active);
        await call('PATCH', `/api/canvas/boards/${target.id}`, HUMAN, { folder: 'Original' });
      }
      // The active board's fence still protects an otherwise unfenced target.
      await call('POST', '/api/canvas/boards/open', HUMAN, { id: target.id });
      expect(
        (await call('PATCH', `/api/canvas/boards/${other.id}`, AGENT, { folder: 'Escape active', agentId: 'writer' }))
          .status,
      ).toBe(403);
    } finally {
      await call('DELETE', `/api/canvas/boards/${target.id}`, HUMAN);
      await call('DELETE', `/api/canvas/boards/${other.id}`, HUMAN);
      await call('POST', '/api/canvas/boards/open', HUMAN, { id: previousBoardId });
    }
  });

  test.each([
    'scope',
    'territory',
  ] as const)('inactive %s fences inherited category and folder changes, not unrelated workspace edits', async (kind) => {
    const previousBoardId = (await boards()).activeBoardId;
    const path = `Inheritance ${kind}`;
    const category = {
      id: `inheritance-${kind}`,
      name: path,
      glyph: 'I',
      decayType: 'reality',
      rate: 'fast',
      triggers: [],
      revalidationMethod: 'Check evidence',
    };
    const folder = { path, categoryId: category.id, lifecycleOverride: null };
    await call('POST', '/api/canvas/knowledge/category', HUMAN, { category });
    await call('POST', '/api/canvas/knowledge/folder', HUMAN, folder);
    const target = (await call('POST', '/api/canvas/boards', HUMAN, { name: path, folder: `${path}/Child` })).body
      .board as CanvasBoard;
    const other = (await call('POST', '/api/canvas/boards', HUMAN, { name: `Other ${kind}` })).body
      .board as CanvasBoard;
    await call('POST', '/api/canvas/boards/open', HUMAN, { id: target.id });
    const note = await addNote('Protected inheritance', HUMAN);
    const fence = { nodeIds: [note.body.id], padding: 40 };
    await call(
      'POST',
      '/api/canvas/ax/policy',
      HUMAN,
      kind === 'scope' ? { scope: fence } : { agentScopes: { writer: fence } },
    );
    try {
      for (const active of [other.id, null]) {
        await call('POST', '/api/canvas/boards/open', HUMAN, { id: active });
        const before = (await call('GET', '/api/canvas/knowledge', AGENT)).body;
        expect(
          (
            await call('POST', '/api/canvas/knowledge/category', AGENT, {
              category: { ...category, rate: 'slow' },
              agentId: 'writer',
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await call('POST', '/api/canvas/knowledge/folder', AGENT, {
              ...folder,
              categoryId: null,
              agentId: 'writer',
            })
          ).status,
        ).toBe(403);
        const after = (await call('GET', '/api/canvas/knowledge', AGENT)).body;
        expect(after.categories).toEqual(before.categories);
        expect(after.folders).toEqual(before.folders);
        expect((await boards()).activeBoardId).toBe(active);
        expect(
          (
            await call('POST', '/api/canvas/knowledge/folder', AGENT, {
              path: `${path} unrelated`,
              categoryId: null,
              lifecycleOverride: null,
              agentId: 'writer',
            })
          ).status,
        ).toBe(200);
        expect(
          (
            await call('POST', '/api/canvas/knowledge/category', AGENT, {
              category: { ...category, rate: 'slow' },
              agentId: 'different',
            })
          ).status,
        ).toBe(kind === 'scope' ? 403 : 200);
        await call('POST', '/api/canvas/knowledge/category', HUMAN, { category });
        expect(
          (await call('POST', '/api/canvas/knowledge/category', HUMAN, { category: { ...category, rate: 'slow' } }))
            .status,
        ).toBe(200);
        await call('POST', '/api/canvas/knowledge/category', HUMAN, { category });
        const childCategory = { ...category, id: `${category.id}-child` };
        await call('POST', '/api/canvas/knowledge/category', HUMAN, { category: childCategory });
        await call('POST', '/api/canvas/knowledge/folder', HUMAN, {
          path: `${path}/Child`,
          categoryId: childCategory.id,
          lifecycleOverride: null,
        });
        expect(
          (
            await call('POST', '/api/canvas/knowledge/folder', AGENT, {
              ...folder,
              categoryId: null,
              agentId: 'writer',
            })
          ).status,
        ).toBe(200);
        await call('POST', '/api/canvas/knowledge/folder', HUMAN, folder);
        await call('POST', '/api/canvas/knowledge/folder', HUMAN, {
          path: `${path}/Child`,
          categoryId: null,
          lifecycleOverride: null,
        });
      }
    } finally {
      await call('DELETE', `/api/canvas/boards/${target.id}`, HUMAN);
      await call('DELETE', `/api/canvas/boards/${other.id}`, HUMAN);
      await call('POST', '/api/canvas/boards/open', HUMAN, { id: previousBoardId });
    }
  });

  test('nested folder paths normalize, persist and reject ambiguous segments without changing the board', async () => {
    const created = await call('POST', '/api/canvas/boards', AGENT, {
      name: 'Decision record',
      folder: ' Engineering / Canvas / Decisions ',
    });
    expect(created.status).toBe(200);
    const board = created.body.board as CanvasBoard;
    expect(board.folder).toBe('Engineering/Canvas/Decisions');
    const deep = Array.from({ length: 8 }, (_, index) => `Folder ${index}`).join('/');
    expect((await call('PATCH', `/api/canvas/boards/${board.id}`, AGENT, { folder: deep })).status).toBe(200);
    for (const folder of ['A//B', '/A', 'A/', 'A/../B', `${deep}/Ninth`, `A/${'x'.repeat(61)}`]) {
      expect(
        (await call('PATCH', `/api/canvas/boards/${board.id}`, AGENT, { folder, name: 'Must not rename' })).status,
      ).toBe(400);
    }
    const read = await call('GET', `/api/canvas/boards/${board.id}`, AGENT);
    expect(read.body.board).toMatchObject({ id: board.id, name: 'Decision record', folder: deep });
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

  test('wiki targets survive renames and saves; code and ambiguous names never become links', async () => {
    const target = (await call('POST', '/api/canvas/boards', AGENT, { name: 'Research wiki' })).body
      .board as CanvasBoard;
    await call('POST', '/api/canvas/boards/open', HUMAN, { id: target.id });
    const card = String((await addNote('Evidence')).body.id);
    const source = (await call('POST', '/api/canvas/boards', AGENT, { name: 'Wiki source' })).body.board as CanvasBoard;
    await call('POST', '/api/canvas/boards/open', HUMAN, { id: source.id });
    for (let i = 0; i < 2; i++) await call('POST', '/api/canvas/boards', AGENT, { name: 'Ambiguous' });
    const content =
      '[[Research wiki]] and [[Research wiki#Evidence|read evidence]]\n`[[Code only]]`\n```md\n[[Fence only]]\n```\n[[Ambiguous]]';
    const note = String(
      (await call('POST', '/api/canvas/node', AGENT, { type: 'markdown', title: 'Links', content })).body.id,
    );
    const bindings = canvasState.getNode(note)?.data.wikiLinks;
    expect(bindings).toEqual([
      { ref: 'Research wiki', target: { boardId: target.id } },
      { ref: 'Research wiki#Evidence', target: { boardId: target.id, cardId: card } },
      { ref: 'Ambiguous' },
    ]);
    await call('PATCH', `/api/canvas/boards/${target.id}`, HUMAN, { name: 'Renamed research' });
    await call('POST', '/api/canvas/boards/open', HUMAN, { id: target.id });
    expect((await call('PATCH', `/api/canvas/node/${card}`, HUMAN, { title: 'Renamed evidence' })).status).toBe(200);
    await call('POST', '/api/canvas/boards/open', HUMAN, { id: source.id });
    expect(
      (await call('PATCH', `/api/canvas/node/${note}`, HUMAN, { content: `${content}\nAnother paragraph.` })).status,
    ).toBe(200);
    expect(canvasState.getNode(note)?.data.wikiLinks).toEqual(bindings);
    const discovery = await createCanvas().getMemoryGraph();
    expect(discovery.unresolvedLinks).toContainEqual({
      source: { boardId: source.id, cardId: note },
      ref: 'Ambiguous',
    });
    const rendered = await call('POST', '/api/render', HUMAN, { markdown: content, nodeId: note });
    expect(rendered.body.html).toContain(`data-wiki-board="${target.id}" data-wiki-card="${card}"`);
    expect(rendered.body.html).toContain('>read evidence</a>');
    expect(rendered.body.html).not.toContain('data-wiki-ref="Code only"');
    const list = (await boards()).boards as Array<CanvasBoard & { backlinks: Array<{ nodeId: string; kind: string }> }>;
    expect(list.find((board) => board.id === target.id)?.backlinks.filter((link) => link.nodeId === note)).toHaveLength(
      2,
    );
    await call('DELETE', `/api/canvas/boards/${target.id}`, HUMAN);
    const missing = await call('POST', '/api/render', HUMAN, { markdown: content, nodeId: note });
    expect(missing.body.html).toContain('data-wiki-missing="true"');
    expect(canvasState.getNode(note)?.data.wikiLinks).toEqual(bindings);
    // Creating a target does not bind on reads; the human's explicit save binds it once.
    const pendingContent = '[[Create me]]';
    const pending = String(
      (await call('POST', '/api/canvas/node', HUMAN, { type: 'markdown', content: pendingContent })).body.id,
    );
    const created = (await call('POST', '/api/canvas/boards', HUMAN, { name: 'Create me' })).body.board as CanvasBoard;
    expect((await call('PATCH', `/api/canvas/node/${pending}`, HUMAN, { content: pendingContent })).status).toBe(200);
    expect(canvasState.getNode(pending)?.data.wikiLinks).toEqual([
      { ref: 'Create me', target: { boardId: created.id } },
    ]);
    await call('PATCH', `/api/canvas/boards/${created.id}`, HUMAN, { name: 'Created and renamed' });
    expect(canvasState.getNode(pending)?.data.wikiLinks).toEqual([
      { ref: 'Create me', target: { boardId: created.id } },
    ]);
  });

  test.each([
    'delete',
    'clear',
  ])('%s Undo restores wiki identity and unresolved bindings, not replacement titles', async (operation) => {
    const name = `Undo ${operation} research`;
    const pending = `Undo ${operation} pending`;
    const target = (await call('POST', '/api/canvas/boards', HUMAN, { name })).body.board as CanvasBoard;
    const content = `[[${name}]] [[${pending}]]`;
    const note = String((await call('POST', '/api/canvas/node', HUMAN, { type: 'markdown', content })).body.id);
    const bindings = canvasState.getNode(note)?.data.wikiLinks;
    await call('PATCH', `/api/canvas/boards/${target.id}`, HUMAN, { name: 'Undo archive' });
    await call('POST', '/api/canvas/boards', HUMAN, { name });
    await call('POST', '/api/canvas/boards', HUMAN, { name: pending });
    if (operation === 'clear') await call('POST', '/api/canvas/clear', HUMAN);
    else await call('DELETE', `/api/canvas/node/${note}`, HUMAN);
    await call('POST', '/api/canvas/undo', HUMAN);
    expect(canvasState.getNode(note)?.data.wikiLinks).toEqual(bindings);
    const rendered = await call('POST', '/api/render', HUMAN, { markdown: content, nodeId: note });
    expect(rendered.body.html).toContain(`data-wiki-board="${target.id}"`);
    expect(rendered.body.html).toContain(`data-wiki-ref="${pending}"`);
  });

  test('authoritative empty bindings do not resolve on render, prose edits or drags', async () => {
    const target = canvasState.createBoard('Empty render')!;
    const content = '[[Empty render]]';
    const note = String((await call('POST', '/api/canvas/node', HUMAN, { type: 'markdown', content })).body.id);
    canvasState.updateNode(note, { data: { content } }, []);
    const catalog = spyOn(canvasState, 'wikiCatalog');
    try {
      const rendered = await call('POST', '/api/render', HUMAN, { markdown: content, nodeId: note });
      expect(rendered.body.html).toContain('data-wiki-ref="Empty render"');
      expect(rendered.body.html).not.toContain(`data-wiki-board="${target.id}"`);
      await call('POST', '/api/render', HUMAN, { markdown: `${content} draft`, nodeId: note });
      await call('PATCH', `/api/canvas/node/${note}`, HUMAN, { content: `${content} prose edit` });
      await call('PATCH', `/api/canvas/node/${note}`, HUMAN, { x: 200, y: 300 });
      expect(canvasState.getNode(note)?.data.wikiLinks).toEqual([]);
      expect(catalog).not.toHaveBeenCalled();
    } finally {
      catalog.mockRestore();
    }
  });

  test('persisted Markdown renders inline images and saved bindings without reference-only lexing', async () => {
    const target = canvasState.createBoard('Render lex target')!;
    const image = `data:image/png;base64,${Buffer.alloc(300_000, 123).toString('base64')}`;
    const content = `[[Render lex target|Saved]] [[Render lex pending]]\n\n![Figure](${image} "Keep image")`;
    const note = String((await call('POST', '/api/canvas/node', HUMAN, { type: 'markdown', content })).body.id);
    canvasState.updateBoard(target.id, { name: 'Renamed lex target' });
    canvasState.createBoard('Render lex target');
    const pending = canvasState.createBoard('Render lex pending')!;
    // Marked.parse uses its internal Lexer; this method is the extra reference-only pass.
    const lexer = spyOn(Marked.prototype, 'lexer');
    const catalog = spyOn(canvasState, 'wikiCatalog');
    try {
      const rendered = await call('POST', '/api/render', HUMAN, { markdown: content, nodeId: note });
      expect(rendered.status).toBe(200);
      expect(rendered.body.html).toContain(`src="${image}" alt="Figure" title="Keep image"`);
      expect(rendered.body.html).toContain(`data-wiki-board="${target.id}"`);
      expect(rendered.body.html).toContain('>Saved</a>');
      expect(rendered.body.html).toContain('data-wiki-ref="Render lex pending"');
      expect(rendered.body.html).not.toContain(`data-wiki-board="${pending.id}"`);
      expect(catalog).not.toHaveBeenCalled();
      expect(lexer).not.toHaveBeenCalled();
    } finally {
      lexer.mockRestore();
      catalog.mockRestore();
    }
  });

  test('saved unresolved links stay unresolved on reads; dirty previews and explicit saves resolve', async () => {
    const content = '[[Render pending]]';
    const note = String((await call('POST', '/api/canvas/node', HUMAN, { type: 'markdown', content })).body.id);
    const target = (await call('POST', '/api/canvas/boards', HUMAN, { name: 'Render pending' })).body
      .board as CanvasBoard;
    const saved = await call('POST', '/api/render', HUMAN, { markdown: content, nodeId: note });
    expect(saved.body.html).toContain('data-wiki-ref="Render pending"');
    expect(saved.body.html).not.toContain('data-wiki-board=');
    const unresolvedMap = await createCanvas().getMemoryGraph({ projection: 'boards' });
    expect(unresolvedMap.unresolvedLinks).toContainEqual({
      source: { boardId: canvasState.activeBoardId!, cardId: note },
      ref: 'Render pending',
    });
    const draft = await call('POST', '/api/render', HUMAN, { markdown: `${content}\nDraft`, nodeId: note });
    expect(draft.body.html).toContain(`data-wiki-board="${target.id}"`);
    expect(canvasState.getNode(note)?.data.wikiLinks).toEqual([{ ref: 'Render pending' }]);
    await call('PATCH', `/api/canvas/node/${note}`, HUMAN, { content });
    expect((await call('POST', '/api/render', HUMAN, { markdown: content, nodeId: note })).body.html).toContain(
      `data-wiki-board="${target.id}"`,
    );
    const fresh = await call('POST', '/api/render', HUMAN, { markdown: `[[${target.id}]]`, nodeId: note });
    expect(fresh.body.html).toContain(`data-wiki-board="${target.id}"`);
    const bindings = canvasState.getNode(note)?.data.wikiLinks;
    const forged = [{ ref: 'Render pending', target: { boardId: 'forged-board' } }];
    await call('PATCH', `/api/canvas/node/${note}`, HUMAN, { data: { wikiLinks: forged } });
    expect(canvasState.getNode(note)?.data.wikiLinks).toEqual(bindings);
    createCanvas().updateNode(note, { data: { ...canvasState.getNode(note)!.data, wikiLinks: forged } });
    expect(canvasState.getNode(note)?.data.wikiLinks).toEqual(bindings);
  });

  test('a delayed render refuses a foreign same-ID card instead of borrowing its wiki bindings', async () => {
    const targetName = 'Qualified render target';
    const content = `[[${targetName}]]`;
    const firstTarget = (await call('POST', '/api/canvas/boards', HUMAN, { name: targetName })).body
      .board as CanvasBoard;
    const source = (await call('POST', '/api/canvas/boards', HUMAN, { name: 'Render owner A' })).body
      .board as CanvasBoard;
    await call('POST', '/api/canvas/boards/open', HUMAN, { id: source.id });
    const id = String((await call('POST', '/api/canvas/node', HUMAN, { type: 'markdown', content })).body.id);
    const template = structuredClone(canvasState.getNode(id)!);
    await call('PATCH', `/api/canvas/boards/${firstTarget.id}`, HUMAN, { name: 'Render archive' });
    const secondTarget = (await call('POST', '/api/canvas/boards', HUMAN, { name: targetName })).body
      .board as CanvasBoard;
    const other = (await call('POST', '/api/canvas/boards', HUMAN, { name: 'Render owner B' })).body
      .board as CanvasBoard;
    await call('POST', '/api/canvas/boards/open', HUMAN, { id: other.id });
    canvasState.addNode({ ...template, data: { content } });
    expect(canvasState.getNode(id)?.data.wikiLinks).toEqual([
      { ref: targetName, target: { boardId: secondTarget.id } },
    ]);
    const delayed = await call('POST', '/api/render', HUMAN, {
      markdown: content,
      nodeId: id,
      expectedBoardId: source.id,
    });
    expect(delayed.status).toBe(409);
    expect(delayed.body.html).toBeUndefined();
    const local = await call('POST', '/api/render', HUMAN, {
      markdown: content,
      nodeId: id,
      expectedBoardId: other.id,
    });
    expect(local.status).toBe(200);
    expect(local.body.html).toContain(`data-wiki-board="${secondTarget.id}"`);
    await call('POST', '/api/canvas/boards/open', HUMAN, { id: source.id });
    const returned = await call('POST', '/api/render', HUMAN, {
      markdown: content,
      nodeId: id,
      expectedBoardId: source.id,
    });
    expect(returned.body.html).toContain(`data-wiki-board="${firstTarget.id}"`);
    expect(returned.body.html).not.toContain(`data-wiki-board="${secondTarget.id}"`);
  });

  test('conditional file-backed Markdown saves keep disk and card together; ordinary PATCH remains data-only', async () => {
    const path = join(workspaceRoot, 'conditional.md');
    writeFileSync(path, 'Original on disk.');
    const created = await call('POST', '/api/canvas/node', HUMAN, {
      type: 'markdown',
      content: 'Original on disk.',
      data: { path },
    });
    const id = created.body.id as string;
    const expectedBoardId = (await boards()).activeBoardId;
    const originalRevision = created.body.contentRevision;
    const update = (body: Record<string, unknown>) => call('PATCH', `/api/canvas/node/${id}`, HUMAN, body);
    expect((await update({ content: 'Card only.' })).status).toBe(200);
    expect(readFileSync(path, 'utf8')).toBe('Original on disk.');
    const current = (await call('GET', `/api/canvas/node/${id}`, HUMAN)).body;
    const conditional = {
      expectedBoardId,
      expectedContentRevision: current.contentRevision,
      persistFile: true,
      content: 'Both\r\nnormalized.',
    };
    expect((await update({ ...conditional, expectedContentRevision: originalRevision })).status).toBe(409);
    expect((await update({ ...conditional, expectedBoardId: 'another-board' })).status).toBe(409);
    expect((await update({ ...conditional, expectedContentRevision: undefined })).status).toBe(400);
    expect((await update({ ...conditional, data: { path: 'another.md' } })).status).toBe(400);
    expect((await update({ ...conditional, data: { lifecycleOverride: null } })).status).toBe(400);
    expect(readFileSync(path, 'utf8')).toBe('Original on disk.');
    expect((await call('GET', `/api/canvas/node/${id}`, HUMAN)).body.contentRevision).toBe(current.contentRevision);
    const saved = await update(conditional);
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ content: 'Both\nnormalized.' });
    expect(readFileSync(path, 'utf8')).toBe('Both\nnormalized.');
    expect(saved.body.lastEditedBy).toMatchObject({ actor: 'human' });
    expect((await update(conditional)).status).toBe(409);
    expect(readFileSync(path, 'utf8')).toBe('Both\nnormalized.');

    const outside = createTestWorkspace('pmx-save-outside-');
    try {
      const target = join(outside, 'private.md');
      writeFileSync(target, 'Do not change.');
      const link = join(workspaceRoot, 'outside.md');
      symlinkSync(target, link);
      const linked = await update({ data: { path: link } });
      expect((await update({ ...conditional, expectedContentRevision: linked.body.contentRevision })).status).toBe(400);
      expect(readFileSync(target, 'utf8')).toBe('Do not change.');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }

    // Imported notes can be linked to a disk copy. A provenance rejection in
    // the card layer must not happen after persisting that copy.
    const sdk = createCanvas();
    const attached = sdk.attachDocument({
      boardId: expectedBoardId!,
      name: 'source.pdf',
      bytes: new Uint8Array([71, 2, 99]),
    });
    await sdk.requestImport(attached.import.id, true, workbenchToken);
    await sdk.submitImport(attached.import.id, [{ title: 'Imported', markdown: 'Both\nnormalized.' }], 'fixture');
    const importedId = (await sdk.commitImport(attached.import.id, workbenchToken)).nodeIds[0]!;
    const linked = await call('PATCH', `/api/canvas/node/${importedId}`, HUMAN, { data: { path } });
    expect(
      (
        await call('PATCH', `/api/canvas/node/${importedId}`, HUMAN, {
          ...conditional,
          expectedContentRevision: linked.body.contentRevision,
          content: 'Rejected provenance edit.',
          data: { source: null },
        })
      ).status,
    ).toBe(400);
    expect(readFileSync(path, 'utf8')).toBe('Both\nnormalized.');
    expect((await call('GET', `/api/canvas/node/${importedId}`, HUMAN)).body.data).toMatchObject({
      content: 'Both\nnormalized.',
      source: { attachmentId: attached.attachment.id },
    });
  });

  test('graph qualifies cross-board card identities, bounds exploration and survives persisted snapshots', async () => {
    const target = (await call('POST', '/api/canvas/boards', AGENT, { name: 'Graph target', folder: 'Research' })).body
      .board as CanvasBoard;
    await call('POST', '/api/canvas/boards/open', HUMAN, { id: target.id });
    const card = String((await addNote('Remote evidence')).body.id);
    const template = canvasState.getNode(card)!;
    const source = (await call('POST', '/api/canvas/boards', AGENT, { name: 'Graph source', folder: 'Planning' })).body
      .board as CanvasBoard;
    await call('POST', '/api/canvas/boards/open', HUMAN, { id: source.id });
    canvasState.addNode({ ...template, data: { title: 'Local claim', content: 'A different body' } });
    const beforeEdge = (await call('GET', '/api/workbench/poll', HUMAN)).body.seq;
    const edge = await call('POST', '/api/canvas/edge', AGENT, {
      from: card,
      to: card,
      toBoardId: target.id,
      type: 'references',
      label: 'Evidence for claim',
    });
    expect(edge.status).toBe(200);
    expect(edge.body.toBoardId).toBe(target.id);
    const published = (await call('GET', `/api/workbench/poll?since=${beforeEdge}`, HUMAN)).body.events as Array<{
      event: string;
      payload: { boards?: Array<CanvasBoard & { links: Array<{ cardTitle: string }> }> };
    }>;
    expect(published.find((event) => event.event === 'boards-changed')?.payload.boards).toContainEqual(
      expect.objectContaining({
        id: source.id,
        links: expect.arrayContaining([expect.objectContaining({ cardTitle: 'Remote evidence' })]),
      }),
    );
    const beforeMove = (await call('GET', '/api/workbench/poll', HUMAN)).body.seq;
    await call('PATCH', `/api/canvas/node/${card}`, HUMAN, { x: 273, y: 119 });
    const moved = (await call('GET', `/api/workbench/poll?since=${beforeMove}`, HUMAN)).body.events as Array<{
      event: string;
    }>;
    expect(moved.some((event) => event.event === 'canvas-layout-update')).toBe(true);
    expect(moved.some((event) => event.event === 'boards-changed')).toBe(false);
    expect(
      (await call('POST', '/api/canvas/edge', AGENT, { from: card, to: card, toBoardId: 'missing', type: 'relation' }))
        .status,
    ).toBe(400);
    await call('PATCH', `/api/canvas/boards/${source.id}`, HUMAN, { mapPosition: { x: 673, y: -115 } });
    await call('POST', `/api/canvas/boards/${target.id}/pin`, HUMAN, {});
    const graph = await createCanvas().getMemoryGraph();
    expect(
      graph.nodes
        .filter((node) => node.cardId === card)
        .map((node) => node.title)
        .sort(),
    ).toEqual(['Local claim', 'Remote evidence']);
    expect(graph.edges.find((entry) => entry.kind === 'card' && entry.source.boardId === source.id)).toMatchObject({
      source: { boardId: source.id, cardId: card },
      target: { boardId: target.id, cardId: card },
      missing: false,
    });
    expect((await boards()).boards).toContainEqual(
      expect.objectContaining({
        id: source.id,
        links: expect.arrayContaining([
          expect.objectContaining({ boardId: target.id, cardId: card, cardTitle: 'Remote evidence', missing: false }),
        ]),
      }),
    );
    const compact = (await call('GET', '/api/canvas/memory-graph?projection=boards', HUMAN))
      .body as unknown as MemoryGraph;
    expect(compact.nodes.every((node) => node.kind === 'board')).toBe(true);
    expect(compact.edges).toEqual(
      graph.edges.filter(
        (entry) => entry.kind !== 'member' && (entry.missing || entry.source.boardId !== entry.target.boardId),
      ),
    );
    expect(compact.unresolvedLinks).toEqual(graph.unresolvedLinks);
    expect(await createCanvas().getMemoryGraph({ projection: 'boards' })).toEqual(compact);
    const details = await createCanvas().getMemoryGraph({ focus: source.id, depth: 2 });
    expect(details.nodes.find((node) => node.boardId === target.id && node.cardId === card)?.title).toBe(
      'Remote evidence',
    );
    expect(details.edges.find((entry) => entry.kind === 'card' && entry.source.boardId === source.id)?.target).toEqual({
      boardId: target.id,
      cardId: card,
    });
    const focus = graph.nodes.find((node) => node.boardId === source.id && node.cardId === card)!.key;
    const local = (await call('GET', `/api/canvas/memory-graph?focus=${encodeURIComponent(focus)}&depth=1`, AGENT))
      .body as unknown as MemoryGraph;
    expect(local.nodes.map((node) => node.title).sort()).toEqual(['Graph source', 'Local claim', 'Remote evidence']);
    const before = canvasState.getContextReads().reads[0]?.seq ?? 0;
    const shallow = (await call('GET', `/api/canvas/memory-graph?focus=${encodeURIComponent(focus)}&depth=0`, AGENT))
      .body as unknown as MemoryGraph;
    expect(shallow.nodes[0]?.linksComplete).toBe(false);
    expect(
      canvasState
        .getContextReads()
        .reads.filter((read) => read.seq > before && read.resource === 'memory-graph.get')
        .every((read) => Object.keys(read.seenLinks).length === 0),
    ).toBe(true);
    expect((await call('GET', '/api/canvas/memory-graph?focus=missing', AGENT)).status).toBe(404);
    expect((await call('GET', '/api/canvas/memory-graph?depth=5', AGENT)).status).toBe(400);
    for (const depth of ['', '%20', '-1', '1.5', 'nope']) {
      expect((await call('GET', `/api/canvas/memory-graph?depth=${depth}`, AGENT)).status).toBe(400);
    }
    expect((await call('GET', '/api/canvas/memory-graph?depth=4', AGENT)).status).toBe(200);
    expect((await call('GET', '/api/canvas/memory-graph', AGENT)).body).toEqual(
      (await call('GET', '/api/canvas/memory-graph?depth=2', AGENT)).body,
    );
    const reads = canvasState.getContextReads().reads.filter((read) => read.resource === 'memory-graph.get');
    expect(reads.some((read) => read.boardId === target.id)).toBe(true);
    expect(reads.every((read) => Object.keys(read.readNodes).length === 0)).toBe(true);
    expect((await boards()).activeBoardId).toBe(source.id);
    const snapshot = canvasState.saveSnapshot('cross-board graph');
    if (!snapshot) throw new Error('Expected a snapshot of the open board');
    canvasState.removeEdge(String(edge.body.id));
    expect(canvasState.restoreSnapshot(snapshot.id)).toBe(true);
    canvasState.flushToDisk();
    canvasState.loadFromDisk({ clearExisting: true });
    expect(canvasState.getEdges().find((stored) => stored.id === edge.body.id)?.toBoardId).toBe(target.id);
    expect((await boards()).boards.find((board) => board.id === source.id)?.mapPosition).toEqual({ x: 673, y: -115 });
    const copied = (
      await call('POST', '/api/canvas/boards/from', AGENT, {
        sourceBoardId: source.id,
        name: 'Next iteration',
        nodeIds: [card],
      })
    ).body.board as CanvasBoard;
    expect(copied.previousBoardId).toBe(source.id);
    expect(canvasState.readBoard(copied.id)?.layout.edges).toContainEqual(
      expect.objectContaining({ toBoardId: target.id, to: card }),
    );
    expect(
      (await createCanvas().getMemoryGraph()).edges.find(
        (entry) => entry.kind === 'previous' && entry.source.boardId === copied.id,
      )?.target,
    ).toEqual({ boardId: source.id });
    const beforeDelete = (await call('GET', '/api/workbench/poll', HUMAN)).body.seq;
    const beforeDeleteLinks = canvasState.getNode(card)!.linksRevision ?? 0;
    await call('DELETE', `/api/canvas/boards/${target.id}`, HUMAN);
    const deletionEvents = (await call('GET', `/api/workbench/poll?since=${beforeDelete}`, HUMAN)).body
      .events as Array<{
      event: string;
      payload: { layout?: { nodes: Array<{ id: string; linksRevision?: number }> } };
    }>;
    expect(canvasState.getNode(card)!.linksRevision ?? 0).toBeGreaterThan(beforeDeleteLinks);
    expect(
      deletionEvents
        .find((event) => event.event === 'canvas-layout-update')
        ?.payload.layout?.nodes.find((node) => node.id === card)?.linksRevision,
    ).toBe(canvasState.getNode(card)!.linksRevision);
    expect(
      (await createCanvas().getMemoryGraph()).edges.find(
        (entry) => entry.source.boardId === source.id && entry.kind === 'card',
      )?.missing,
    ).toBe(true);
    const missingMap = await createCanvas().getMemoryGraph({ projection: 'boards' });
    expect(missingMap.edges.find((entry) => entry.source.boardId === source.id && entry.kind === 'card')).toMatchObject(
      {
        target: { boardId: target.id, cardId: card },
        missing: true,
      },
    );
    expect(
      missingMap.edges.find((entry) => entry.kind === 'previous' && entry.source.boardId === copied.id)?.target,
    ).toEqual({ boardId: source.id });
    expect((await call('GET', '/api/canvas/memory-graph?projection=invalid', AGENT)).status).toBe(400);
    // A same-ID local card is not a replacement for the deleted remote endpoint.
    const validation = await call('GET', '/api/canvas/validate', AGENT);
    expect(validation.body.missingEdgeEndpoints).toEqual([{ edgeId: edge.body.id, from: card, to: card }]);
  });
});
