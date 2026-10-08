import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { canvasState, type CanvasNodeState } from '../../src/server/canvas-state.ts';
import { executeOperation } from '../../src/server/operations/registry.ts';
import { createTestWorkspace, makeNode, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

// The brief is a map: each card carries its relations, so a relation change
// must reach a consumer's next incremental brief through both endpoints.

let root = '';
beforeEach(() => {
  root = createTestWorkspace('pmx-canvas-relations-');
  resetCanvasForTests(root);
});
afterEach(() => {
  canvasState.close();
  removeTestWorkspace(root);
});

const revision = (id: string) => (canvasState.getNode(id) as CanvasNodeState).contentRevision ?? 0;

describe('relation changes advance both endpoints', () => {
  test('add, relabel and remove an edge each resend both cards; style and auto-edges do not', async () => {
    canvasState.loadFromDisk({ clearExisting: true });
    const { board } = (await executeOperation('board.create', { name: 'Relations' })) as { board: { id: string } };
    await executeOperation('board.open', { id: board.id });
    canvasState.addNode(makeNode({ id: 'plan', type: 'markdown', position: { x: 0, y: 0 } }));
    canvasState.addNode(makeNode({ id: 'risk', type: 'markdown', position: { x: 2000, y: 0 } }));
    const cursor = canvasState.getContentRevision().revision;

    canvasState.addEdge({ id: 'e1', from: 'plan', to: 'risk', type: 'depends-on' });
    expect(revision('plan')).toBeGreaterThan(cursor);
    expect(revision('risk')).toBeGreaterThan(cursor);
    const brief = (await executeOperation('context.get', { since: cursor })) as {
      entries: Array<{ nodeId: string; text: string }>;
    };
    expect(brief.entries.find((entry) => entry.nodeId === 'plan')?.text).toContain('→ depends-on');

    let before = revision('plan');
    canvasState.updateEdge('e1', { style: 'dashed' });
    expect(revision('plan')).toBe(before);
    canvasState.updateEdge('e1', { label: 'blocked by' });
    expect(revision('plan')).toBeGreaterThan(before);

    before = revision('risk');
    canvasState.removeEdge('e1');
    expect(revision('risk')).toBeGreaterThan(before);

    before = revision('plan');
    canvasState.addEdge({ id: 'codegraph-plan-risk', from: 'plan', to: 'risk', type: 'depends-on' });
    expect(revision('plan')).toBe(before);
  });
});
