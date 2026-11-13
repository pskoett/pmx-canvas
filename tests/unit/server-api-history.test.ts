import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { canvasState } from '../../src/server/canvas-state.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { emitPrimaryWorkbenchEvent } from '../../src/server/server.ts';
import {
  resetServerApiState,
  startServerApiSuite,
  stopServerApiSuite,
  type CanvasStateResponse,
  type ServerApiSuite,
} from './server-api-harness.ts';

describe('canvas server HTTP API: history', () => {
  let suite: ServerApiSuite | null = null;
  let baseUrl = '';
  let webpageOrigin = '';

  async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, init);
    expect(response.ok).toBe(true);
    return (await response.json()) as T;
  }

  beforeAll(() => {
    suite = startServerApiSuite('pmx-canvas-api-history-');
    ({ baseUrl, webpageOrigin } = suite);
  });

  afterAll(() => {
    if (suite) stopServerApiSuite(suite);
  });

  beforeEach(resetServerApiState);

  test('records batch updates in history and supports undo/redo over HTTP', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'History target', x: 120, y: 120 }),
    });

    const batchResult = await jsonRequest<{ ok: boolean; applied: number; skipped: number }>('/api/canvas/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updates: [{ id: created.id, position: { x: 520, y: 420 }, collapsed: true }],
      }),
    });
    expect(batchResult.applied).toBe(1);

    const history = await jsonRequest<{
      text: string;
      entries: Array<{ operationType: string; description: string }>;
      canUndo: boolean;
      canRedo: boolean;
    }>('/api/canvas/history');
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    expect(history.text).toContain('Updated 1 node (1 moved, 1 collapsed)');
    expect(
      history.entries.some(
        (entry) => entry.operationType === 'batch' && entry.description === 'Updated 1 node (1 moved, 1 collapsed)',
      ),
    ).toBe(true);

    const undone = await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/undo', {
      method: 'POST',
    });
    expect(undone.ok).toBe(true);
    expect(undone.description).toContain('Updated 1 node (1 moved, 1 collapsed)');

    const reverted = await jsonRequest<{
      id: string;
      position: { x: number; y: number };
      collapsed: boolean;
    }>(`/api/canvas/node/${created.id}`);
    expect(reverted.position).toEqual({ x: 120, y: 120 });
    expect(reverted.collapsed).toBe(false);

    const redone = await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/redo', {
      method: 'POST',
    });
    expect(redone.ok).toBe(true);
    expect(redone.description).toContain('Updated 1 node (1 moved, 1 collapsed)');

    const replayed = await jsonRequest<{
      id: string;
      position: { x: number; y: number };
      collapsed: boolean;
    }>(`/api/canvas/node/${created.id}`);
    expect(replayed.position).toEqual({ x: 520, y: 420 });
    expect(replayed.collapsed).toBe(true);
  });

  test('records arrange as a single undoable history entry', async () => {
    const first = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Arrange A', x: 600, y: 600 }),
    });
    await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Arrange B', x: 900, y: 900 }),
    });
    mutationHistory.reset();

    const before = await jsonRequest<{ position: { x: number; y: number } }>(`/api/canvas/node/${first.id}`);
    const arranged = await jsonRequest<{ ok: boolean; arranged: number }>('/api/canvas/arrange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: 'column' }),
    });
    expect(arranged.ok).toBe(true);
    expect(arranged.arranged).toBe(2);

    const history = await jsonRequest<{
      entries: Array<{ description: string; operationType: string }>;
      canUndo: boolean;
    }>('/api/canvas/history');
    expect(history.canUndo).toBe(true);
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]).toMatchObject({
      operationType: 'arrange',
      description: 'Auto-arranged 2 nodes (column)',
    });

    const undone = await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/undo', {
      method: 'POST',
    });
    expect(undone.description).toContain('Auto-arranged 2 nodes (column)');
    const afterUndo = await jsonRequest<{ position: { x: number; y: number } }>(`/api/canvas/node/${first.id}`);
    expect(afterUndo.position).toEqual(before.position);

    const afterHistory = await jsonRequest<{
      entries: Array<{ isUndone: boolean }>;
      canUndo: boolean;
    }>('/api/canvas/history');
    expect(afterHistory.canUndo).toBe(false);
    expect(afterHistory.entries).toHaveLength(1);
    expect(afterHistory.entries[0]?.isUndone).toBe(true);
  });

  test('runtime ext-app result sync does not clear redo history after undo', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Redo survives runtime sync', x: 120, y: 120 }),
    });

    const batchResult = await jsonRequest<{ ok: boolean; applied: number }>('/api/canvas/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: [{ id: created.id, position: { x: 520, y: 420 } }] }),
    });
    expect(batchResult.applied).toBe(1);

    const undone = await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/undo', {
      method: 'POST',
    });
    expect(undone.ok).toBe(true);

    const eventId = 'ext-app-redo-runtime-sync';
    canvasState.withSuppressedRecording(() => {
      canvasState.addNode({
        id: eventId,
        type: 'mcp-app',
        position: { x: 40, y: 40 },
        size: { width: 320, height: 240 },
        zIndex: 1,
        collapsed: false,
        pinned: false,
        data: { mode: 'ext-app', toolCallId: 'redo-sync', serverName: 'Fixture', toolName: 'show_counter' },
      });
    });
    const beforeRuntimeHistory = await jsonRequest<{ canRedo: boolean }>('/api/canvas/history');
    expect(beforeRuntimeHistory.canRedo).toBe(true);

    // Runtime app updates are SSE synchronization side effects and must not
    // truncate the user-visible redo stack.
    emitPrimaryWorkbenchEvent('ext-app-result', {
      toolCallId: 'redo-sync',
      nodeId: eventId,
      serverName: 'Fixture',
      toolName: 'show_counter',
      success: true,
      result: { content: [{ type: 'text', text: 'runtime result' }] },
    });

    const history = await jsonRequest<{ canRedo: boolean }>('/api/canvas/history');
    expect(history.canRedo).toBe(true);

    const redone = await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/redo', {
      method: 'POST',
    });
    expect(redone.ok).toBe(true);
    expect(redone.description).toContain('Updated 1 node (1 moved)');

    const replayed = await jsonRequest<{
      position: { x: number; y: number };
    }>(`/api/canvas/node/${created.id}`);
    expect(replayed.position).toEqual({ x: 520, y: 420 });
  });

  test('ext-app open remains user-visible history while runtime result sync is suppressed', async () => {
    emitPrimaryWorkbenchEvent('ext-app-open', {
      toolCallId: 'undoable-open',
      nodeId: 'ext-app-undoable-open',
      title: 'Undoable app',
      html: '<main>app</main>',
      toolInput: {},
      serverName: 'Fixture',
      toolName: 'show_counter',
      appSessionId: 'session-undoable-open',
      transportConfig: { type: 'http', url: 'https://example.test/mcp' },
      resourceUri: 'ui://fixture/counter.html',
      toolDefinition: { name: 'show_counter' },
      sessionStatus: 'ready',
      sessionError: null,
    });

    const afterOpen = await jsonRequest<{ canUndo: boolean; text: string }>('/api/canvas/history');
    expect(afterOpen.canUndo).toBe(true);
    expect(afterOpen.text).toContain('Added mcp-app node "Undoable app"');

    const undone = await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/undo', {
      method: 'POST',
    });
    expect(undone.ok).toBe(true);
    expect(undone.description).toContain('Added mcp-app node "Undoable app"');

    const afterUndo = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(afterUndo.nodes.some((node) => node.id === 'ext-app-undoable-open')).toBe(false);
  });

  test('records viewport changes in history and supports undo/redo over HTTP', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Viewport target', x: 640, y: 480 }),
    });

    const focused = await jsonRequest<{ ok: boolean; focused: string }>('/api/canvas/focus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: created.id }),
    });
    expect(focused.focused).toBe(created.id);

    const afterFocus = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    // Focus margins are screen-space (64px left, 96px top — Finding Z):
    // screen = world * scale + viewport, so the node's top-left lands on the
    // margin regardless of where it sits in world space.
    const focusView = afterFocus.viewport;
    if (!focusView) throw new Error('viewport missing from state');
    expect(focusView.scale).toBe(1);
    expect(640 * focusView.scale + focusView.x).toBeCloseTo(64, 0);
    expect(480 * focusView.scale + focusView.y).toBeCloseTo(96, 0);

    const history = await jsonRequest<{
      text: string;
      entries: Array<{ operationType: string; description: string }>;
      canUndo: boolean;
      canRedo: boolean;
    }>('/api/canvas/history');
    expect(history.text).toContain('Updated viewport');
    expect(history.entries.some((entry) => entry.operationType === 'viewport')).toBe(true);

    const undone = await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/undo', {
      method: 'POST',
    });
    expect(undone.description).toContain('Updated viewport');

    const afterUndo = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(afterUndo.viewport).toEqual({ x: 0, y: 0, scale: 1 });

    const redone = await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/redo', {
      method: 'POST',
    });
    expect(redone.description).toContain('Updated viewport');

    const afterRedo = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(afterRedo.viewport).toEqual(focusView);
  });

  test('can suppress browser-driven viewport updates from undo history', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Suppressed viewport target' }),
    });

    await jsonRequest<{ ok: boolean }>('/api/canvas/viewport', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 120, y: -80, scale: 1.5, recordHistory: false }),
    });

    const history = await jsonRequest<{ text: string }>('/api/canvas/history');
    expect(history.text).not.toContain('Updated viewport');

    const undone = await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/undo', {
      method: 'POST',
    });
    expect(undone.ok).toBe(true);
    expect(undone.description).toContain('Added markdown node "Suppressed viewport target"');

    const state = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(state.nodes.some((node) => node.id === created.id)).toBe(false);
    expect(state.viewport).toEqual({ x: 120, y: -80, scale: 1.5 });
  });

  test('re-sending the current camera (a touch tap) adds no history and keeps redo', async () => {
    const created = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Redo survives a tap' }),
    });
    await jsonRequest('/api/canvas/undo', { method: 'POST' });
    const { viewport } = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    await jsonRequest('/api/canvas/viewport', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(viewport),
    });
    const redone = await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/redo', { method: 'POST' });
    expect(redone).toMatchObject({ ok: true, description: expect.stringContaining('Redo survives a tap') });
    const state = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(state.nodes.some((node) => node.id === created.id)).toBe(true);
  });

  test('limits, filters, and garbage-collects snapshots over HTTP', async () => {
    for (const name of ['http-alpha', 'http-beta', 'http-alpha-old']) {
      // An unchanged board would REUSE the newest snapshot — change it first.
      await jsonRequest('/api/canvas/node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'markdown', title: `gc-${name}`, x: 40, y: 40 }),
      });
      const saved = await jsonRequest<{ ok: boolean; snapshot: { name: string } }>('/api/canvas/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      expect(saved.snapshot.name).toBe(name);
      // Deliberate 2ms gap: snapshots sort by millisecond createdAt, so each needs a distinct timestamp.
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const limited = await jsonRequest<Array<{ name: string }>>('/api/canvas/snapshots?limit=2');
    expect(limited.map((item) => item.name)).toEqual(['http-alpha-old', 'http-beta']);

    const filtered = await jsonRequest<Array<{ name: string }>>('/api/canvas/snapshots?q=alpha&all=true');
    expect(filtered.map((item) => item.name)).toEqual(['http-alpha-old', 'http-alpha']);

    const preview = await jsonRequest<{
      ok: boolean;
      kept: number;
      dryRun: boolean;
      deleted: Array<{ name: string }>;
    }>('/api/canvas/snapshots/gc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keep: 1, dryRun: true }),
    });
    expect(preview.ok).toBe(true);
    expect(preview.kept).toBe(1);
    expect(preview.dryRun).toBe(true);
    expect(preview.deleted.map((item) => item.name)).toEqual(['http-beta', 'http-alpha']);

    const result = await jsonRequest<{
      ok: boolean;
      kept: number;
      dryRun: boolean;
      deleted: Array<{ name: string }>;
    }>('/api/canvas/snapshots/gc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keep: 1 }),
    });
    expect(result.ok).toBe(true);
    expect(result.kept).toBe(1);
    expect(result.dryRun).toBe(false);
    expect(result.deleted.map((item) => item.name)).toEqual(['http-beta', 'http-alpha']);

    const remaining = await jsonRequest<Array<{ name: string }>>('/api/canvas/snapshots?all=true');
    expect(remaining.map((item) => item.name)).toEqual(['http-alpha-old']);
  });

  test('snapshot diff ignores restored webpage key order and sync times but retains content changes', async () => {
    const node = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'webpage',
        url: `${webpageOrigin}/article-long`,
        data: {
          metadata: { first: 1, second: { a: 2, b: 3 }, sequence: [1, 2] },
        },
      }),
    });
    const saved = await jsonRequest<{ id: string }>('/api/canvas/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'webpage' }),
    });
    const diff = () =>
      jsonRequest<{ diff: { modifiedNodes: Array<{ changes: string[] }> } }>(`/api/canvas/snapshots/${saved.id}/diff`);
    const update = (data: Record<string, unknown>) =>
      jsonRequest(`/api/canvas/node/${node.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });
    await jsonRequest(`/api/canvas/snapshots/${saved.id}`, { method: 'POST' });
    expect((await diff()).diff.modifiedNodes).toEqual([]);
    await update({
      fetchedAt: '2026-10-02T00:00:00Z',
      provenance: {
        snapshotContent: true,
        refreshStrategy: 'webpage-refresh',
        sourceUri: `${webpageOrigin}/article-long`,
        sourceKind: 'webpage-url',
        syncedAt: '2026-10-02T00:00:00Z',
      },
      metadata: { sequence: [1, 2], second: { b: 3, a: 2 }, first: 1 },
    });
    expect((await diff()).diff.modifiedNodes).toEqual([]);
    for (const data of [
      { content: 'Revised' },
      { url: 'https://example.com/changed' },
      {
        provenance: {
          sourceKind: 'webpage-url',
          sourceUri: `${webpageOrigin}/article-long`,
          refreshStrategy: 'webpage-refresh',
          snapshotContent: true,
          details: { note: 'Changed source metadata' },
        },
      },
      { metadata: { first: 1, second: { a: 2, b: 4 }, sequence: [1, 2] } },
      { metadata: { first: 1, second: { a: 2, b: 3 }, sequence: [2, 1] } },
      { metadata: { syncedAt: 'Authored content, not a provenance timestamp' } },
    ]) {
      await jsonRequest(`/api/canvas/snapshots/${saved.id}`, { method: 'POST' });
      await update(data);
      expect((await diff()).diff.modifiedNodes).toHaveLength(1);
    }
  });

  test('saving a snapshot of an unchanged board reuses the newest one instead of duplicating it', async () => {
    await jsonRequest('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Dedupe base', x: 50, y: 50 }),
    });
    const first = await jsonRequest<{ ok: boolean; id: string; reused?: boolean }>('/api/canvas/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dedupe-one' }),
    });
    expect(first.reused).toBeUndefined();
    const again = await jsonRequest<{ ok: boolean; id: string; reused?: boolean }>('/api/canvas/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dedupe-two' }),
    });
    expect(again.reused).toBe(true);
    expect(again.id).toBe(first.id);
    // A real change makes the next save a real snapshot again.
    await jsonRequest('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Dedupe delta', x: 400, y: 50 }),
    });
    const third = await jsonRequest<{ ok: boolean; id: string; reused?: boolean }>('/api/canvas/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dedupe-three' }),
    });
    expect(third.reused).toBeUndefined();
    expect(third.id).not.toBe(first.id);
  });
});
