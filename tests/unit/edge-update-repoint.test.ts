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
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { executeOperation } from '../../src/server/operations/index.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

let workspaceRoot = '';

beforeEach(() => {
  workspaceRoot = createTestWorkspace('pmx-canvas-edge-update-');
  resetCanvasForTests(workspaceRoot);
});

afterEach(() => {
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
  test('patching path re-reads content, follows the filename, and keeps edges', async () => {
    const dir = join(workspaceRoot, 'src');
    mkdirSync(dir, { recursive: true });
    const fileA = join(dir, 'alpha.ts');
    const fileB = join(dir, 'beta.ts');
    writeFileSync(fileA, 'export const alpha = 1;\n');
    writeFileSync(fileB, 'export const beta = 2;\nexport const more = 3;\n');

    const fileNode = (await executeOperation('node.add', { type: 'file', content: fileA })) as { id: string };
    const other = (await executeOperation('node.add', { type: 'markdown', title: 'notes', content: 'n' })) as {
      id: string;
    };
    const edge = (await executeOperation('edge.add', { from: fileNode.id, to: other.id, type: 'references' })) as {
      id: string;
    };

    await executeOperation('node.update', { id: fileNode.id, path: fileB });

    const node = canvasState.getNode(fileNode.id);
    expect(node?.data.path).toBe(fileB);
    expect(node?.data.fileContent).toContain('beta = 2');
    expect(node?.data.title).toBe('beta.ts');
    // The whole point of repoint over recreate: connections survive.
    expect(canvasState.getEdges().some((e) => e.id === edge.id)).toBe(true);
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
