/**
 * Round-2 review fixes: edges are editable in place (`edge.update`), file
 * nodes repoint by patching `path` (edges/pins survive), and the roster gets
 * pump-health truth (pendingSteers + lastClaimAt — attached ≠ polling).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentPresence } from '../../src/server/agent-presence.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import { unwatchAll } from '../../src/server/file-watcher.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { executeOperation } from '../../src/server/operations/index.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests, waitForCondition } from './helpers.ts';

let workspaceRoot = '';

beforeEach(() => {
  workspaceRoot = createTestWorkspace('pmx-canvas-edge-update-');
  resetCanvasForTests(workspaceRoot);
});

afterEach(() => {
  unwatchAll();
  removeTestWorkspace(workspaceRoot);
});

async function addPair(): Promise<{ a: string; b: string; edgeId: string }> {
  const a = (await executeOperation('node.add', { type: 'markdown', title: 'A', content: 'a' })) as { id: string };
  const b = (await executeOperation('node.add', { type: 'markdown', title: 'B', content: 'b' })) as { id: string };
  const edge = (await executeOperation('edge.add', { from: a.id, to: b.id, type: 'flow', label: 'first' })) as {
    id: string;
  };
  return { a: a.id, b: b.id, edgeId: edge.id };
}

describe('edge.update', () => {
  test('patches label, style, and type in place; empty label clears', async () => {
    const { edgeId } = await addPair();
    const updated = (await executeOperation('edge.update', {
      id: edgeId,
      label: 'retries',
      style: 'dashed',
      type: 'depends-on',
    })) as { label?: string; style?: string; type: string };
    expect(updated.label).toBe('retries');
    expect(updated.style).toBe('dashed');
    expect(updated.type).toBe('depends-on');

    const cleared = (await executeOperation('edge.update', { id: edgeId, label: '' })) as { label?: string };
    expect(cleared.label).toBeUndefined();
    const stored = canvasState.getEdges().find((edge) => edge.id === edgeId);
    expect(stored?.label).toBeUndefined();
    expect(stored?.type).toBe('depends-on');
  });

  test('retyping onto an existing from/to/type triple is refused', async () => {
    const { a, b, edgeId } = await addPair();
    await executeOperation('edge.add', { from: a, to: b, type: 'relation' });
    await expect(executeOperation('edge.update', { id: edgeId, type: 'relation' })).rejects.toThrow(/duplicate/i);
    // The refused patch changed nothing.
    expect(canvasState.getEdges().find((edge) => edge.id === edgeId)?.type).toBe('flow');
  });

  test('unknown edge is a 404-shaped error and undo restores a patch', async () => {
    const { edgeId } = await addPair();
    await expect(executeOperation('edge.update', { id: 'edge-nope', label: 'x' })).rejects.toThrow(/not found/i);

    // Single-slot listener (architecture rule 8): wire history exactly like
    // the server does, only for this test's mutation.
    canvasState.onMutation((info) => {
      mutationHistory.record({
        description: info.description,
        operationType: info.operationType,
        forward: info.forward,
        inverse: info.inverse,
      });
    });
    await executeOperation('edge.update', { id: edgeId, label: 'second' });
    expect(mutationHistory.undo()?.operationType).toBe('updateEdge');
    expect(canvasState.getEdges().find((edge) => edge.id === edgeId)?.label).toBe('first');
  });
});

describe('file node repoint', () => {
  test('resolves relative paths from the workspace, rewires the watcher, and preserves node state', async () => {
    const dir = join(workspaceRoot, 'src');
    mkdirSync(dir, { recursive: true });
    const fileA = join(dir, 'alpha.ts');
    const fileB = join(dir, 'beta.ts');
    writeFileSync(fileA, 'export const alpha = 1;\n');
    writeFileSync(fileB, 'export const beta = 2;\nexport const more = 3;\n');

    const wrongCwd = createTestWorkspace('pmx-canvas-repoint-cwd-');
    mkdirSync(join(wrongCwd, 'src'), { recursive: true });
    writeFileSync(join(wrongCwd, 'src', 'beta.ts'), 'WRONG CWD SENTINEL');

    const fileNode = (await executeOperation('node.add', {
      type: 'file',
      content: fileA,
      x: 145,
      y: 260,
    })) as { id: string };
    await executeOperation('node.update', { id: fileNode.id, pinned: true });
    const other = (await executeOperation('node.add', { type: 'markdown', title: 'notes', content: 'n' })) as {
      id: string;
    };
    const edge = (await executeOperation('edge.add', { from: fileNode.id, to: other.id, type: 'references' })) as {
      id: string;
    };

    const originalCwd = process.cwd();
    try {
      process.chdir(wrongCwd);
      await executeOperation('node.update', { id: fileNode.id, path: 'src/beta.ts' });
    } finally {
      process.chdir(originalCwd);
      removeTestWorkspace(wrongCwd);
    }

    let node = canvasState.getNode(fileNode.id);
    expect(node?.data.path).toBe(fileB);
    expect(node?.data.fileContent).toContain('beta = 2');
    expect(node?.data.fileContent).not.toContain('WRONG CWD SENTINEL');
    expect(node?.data.title).toBe('beta.ts');
    expect(node?.position).toEqual({ x: 145, y: 260 });
    expect(node?.pinned).toBe(true);
    expect(canvasState.getEdges().some((e) => e.id === edge.id)).toBe(true);

    await Bun.sleep(30);
    writeFileSync(fileB, 'export const watched = 4;\n');
    await waitForCondition(() => canvasState.getNode(fileNode.id)?.data.fileContent === 'export const watched = 4;\n', {
      timeoutMs: 1500,
      label: 'repointed file watcher update',
    });
    node = canvasState.getNode(fileNode.id);
    expect(node?.data.fileContent).toContain('watched = 4');
  });

  test('a renamed node keeps its custom title across repoint', async () => {
    const fileA = join(workspaceRoot, 'a.md');
    const fileB = join(workspaceRoot, 'b.md');
    writeFileSync(fileA, 'aaa');
    writeFileSync(fileB, 'bbb');
    const fileNode = (await executeOperation('node.add', { type: 'file', content: fileA, title: 'Spec draft' })) as {
      id: string;
    };
    await executeOperation('node.update', { id: fileNode.id, path: fileB });
    const node = canvasState.getNode(fileNode.id);
    expect(node?.data.title).toBe('Spec draft');
    expect(node?.data.fileContent).toBe('bbb');
  });

  test('rejects a missing target before mutation and accepts data.path through batch', async () => {
    const fileA = join(workspaceRoot, 'a.md');
    const fileB = join(workspaceRoot, 'b.md');
    writeFileSync(fileA, 'aaa');
    writeFileSync(fileB, 'bbb');
    const fileNode = (await executeOperation('node.add', { type: 'file', content: fileA, title: 'Keep me' })) as {
      id: string;
    };

    await expect(executeOperation('node.update', { id: fileNode.id, path: 'missing.md' })).rejects.toThrow(
      /not.*read|unavailable|missing/i,
    );
    expect(canvasState.getNode(fileNode.id)?.data).toMatchObject({
      path: fileA,
      fileContent: 'aaa',
      title: 'Keep me',
    });
    await Bun.sleep(30);
    writeFileSync(fileA, 'aaa still watched');
    await waitForCondition(() => canvasState.getNode(fileNode.id)?.data.fileContent === 'aaa still watched', {
      timeoutMs: 1500,
      label: 'original watcher after rejected repoint',
    });

    const batch = (await executeOperation('canvas.batch', {
      operations: [{ op: 'node.update', args: { id: fileNode.id, data: { path: 'b.md' } } }],
    })) as { ok: boolean };
    expect(batch.ok).toBe(true);
    expect(canvasState.getNode(fileNode.id)?.data).toMatchObject({
      path: fileB,
      fileContent: 'bbb',
      title: 'Keep me',
    });
  });
});

describe('roster pump health', () => {
  test('pendingSteers counts the writer queue and lastClaimAt records proof-of-polling', async () => {
    agentPresence.touch({ source: 'api', agentId: 'codex', label: 'Codex', attached: true });
    await executeOperation('ax.steer', {
      message: 'do the thing',
      source: 'claude-code',
      agentId: 'claude-code',
      target: 'codex',
    });

    let row = agentPresence.snapshot().presences.find((p) => p.sessionId === 'codex');
    expect(row?.steerable).toBe(true);
    expect(row?.pendingSteers).toBe(1);
    expect(row?.lastClaimAt).toBeUndefined();

    // A claim proves the consumer polls: lastClaimAt appears; the mark drains the queue.
    const pending = (await executeOperation('ax.delivery.pending', { consumer: 'codex', limit: 5 })) as {
      pending: Array<{ id: string }>;
    };
    expect(pending.pending.length).toBe(1);
    await executeOperation('ax.delivery.mark', { id: pending.pending[0]!.id, consumer: 'codex' });

    row = agentPresence.snapshot().presences.find((p) => p.sessionId === 'codex');
    expect(row?.pendingSteers).toBe(0);
    expect(typeof row?.lastClaimAt).toBe('string');
  });
});
