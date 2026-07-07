import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { canvasState } from '../../src/server/canvas-state.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { createTestWorkspace, makeNode, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

function orphanNotes() {
  return canvasState.getAxEvents().filter((e) => e.kind === 'note' && e.data?.systemEvent === 'ax-node-orphan');
}

describe('AX node-orphan audit (plan-007 Slice A)', () => {
  let workspaceRoot = '';

  beforeEach(() => {
    workspaceRoot = createTestWorkspace('pmx-canvas-ax-orphan-');
    resetCanvasForTests(workspaceRoot);
  });

  afterEach(() => {
    removeTestWorkspace(workspaceRoot);
  });

  test('removing a node soft-orphans canvas-bound AX items and records one system note', () => {
    const node = makeNode({ id: 'orphan-node', type: 'markdown', data: { title: 'Doomed node' } });
    canvasState.addNode(node);

    // A work item that references the node (soft-orphan: should survive, id stripped).
    const workItem = canvasState.addWorkItem({ title: 'wire it up', nodeIds: [node.id] }, { source: 'api' });
    expect(workItem.nodeIds).toEqual([node.id]);

    // A node-anchored review annotation (should be dropped when the node goes away).
    const review = canvasState.addReviewAnnotation(
      { body: 'fix this', anchorType: 'node', nodeId: node.id },
      { source: 'api' },
    );
    expect(review).not.toBeNull();
    expect(canvasState.getReviewAnnotations().map((r) => r.id)).toEqual([review!.id]);

    canvasState.removeNode(node.id);

    // (a) the work item SURVIVES with the node id stripped from its nodeIds.
    const survivors = canvasState.getWorkItems();
    expect(survivors.map((w) => w.id)).toEqual([workItem.id]);
    expect(survivors[0]?.nodeIds).toEqual([]);

    // (b) the node-anchored review annotation is REMOVED.
    expect(canvasState.getReviewAnnotations()).toEqual([]);

    // (c) a single timeline `note` event (source 'system') describes the orphaning.
    const noteEvents = canvasState
      .getAxEvents()
      .filter((e) => e.kind === 'note' && e.data?.systemEvent === 'ax-node-orphan');
    expect(noteEvents).toHaveLength(1);
    const note = noteEvents[0]!;
    expect(note.source).toBe('system');
    expect(note.data?.removedNodeId).toBe(node.id);
    expect(note.data?.reanchoredIds).toEqual([workItem.id]);
    expect(note.data?.removedReviewIds).toEqual([review!.id]);
    // Summary format is part of the contract (docs/ax-state-contract.md) — pin it.
    expect(note.summary).toContain('Doomed node');
    expect(note.summary).toContain('re-anchored 1 AX item');
    expect(note.summary).toContain('removed 1 node-anchored review annotation');

    // Round-trips through the timeline read surface too.
    const timelineNotes = canvasState
      .getAxTimeline()
      .events.filter((e) => e.kind === 'note' && e.data?.systemEvent === 'ax-node-orphan');
    expect(timelineNotes.map((e) => e.id)).toEqual([note.id]);
  });

  test('soft-orphans approval gates, elicitations, and mode requests too', () => {
    const node = makeNode({ id: 'multi-node', type: 'markdown', data: { title: 'Anchor' } });
    canvasState.addNode(node);
    const gate = canvasState.requestApproval({ title: 'ship it', nodeIds: [node.id] }, { source: 'api' });
    const elicit = canvasState.requestElicitation({ prompt: 'which?', nodeIds: [node.id] }, { source: 'api' });
    const mode = canvasState.requestMode({ mode: 'execute', nodeIds: [node.id] }, { source: 'api' });

    canvasState.removeNode(node.id);

    // All three survive with the node id stripped (soft-orphan), not deleted.
    expect(canvasState.getApprovalGates().find((g) => g.id === gate.id)?.nodeIds).toEqual([]);
    expect(canvasState.getElicitations().find((e) => e.id === elicit.id)?.nodeIds).toEqual([]);
    expect(canvasState.getModeRequests().find((m) => m.id === mode.id)?.nodeIds).toEqual([]);

    const note = orphanNotes()[0]!;
    expect(new Set(note.data?.reanchoredIds as string[])).toEqual(new Set([gate.id, elicit.id, mode.id]));
  });

  test('focus loss is reported in the audit note', () => {
    const node = makeNode({ id: 'focus-node', type: 'markdown', data: { title: 'Focused' } });
    canvasState.addNode(node);
    canvasState.setAxFocus([node.id], { source: 'api' });

    canvasState.removeNode(node.id);

    const note = orphanNotes()[0]!;
    expect(note.data?.reanchoredFocus).toBe(true);
    expect(note.summary).toContain('focus anchor cleared');
  });

  test('undo + redo of a node deletion does not duplicate the audit note', () => {
    const node = makeNode({ id: 'replay-node', type: 'markdown', data: { title: 'Replay' } });
    canvasState.addNode(node);
    canvasState.addWorkItem({ title: 'task', nodeIds: [node.id] }, { source: 'api' });

    canvasState.removeNode(node.id);
    expect(orphanNotes()).toHaveLength(1);

    // Undo restores the node + AX; redo replays the deletion inside suppressed().
    // The original note must NOT be duplicated (timeline is append-only).
    mutationHistory.undo();
    mutationHistory.redo();
    expect(orphanNotes()).toHaveLength(1);
  });

  test('removing a node that orphans nothing records no audit note', () => {
    const orphaning = makeNode({ id: 'used-node', type: 'markdown', data: { title: 'Used' } });
    const bystander = makeNode({ id: 'free-node', type: 'markdown', data: { title: 'Free' } });
    canvasState.addNode(orphaning);
    canvasState.addNode(bystander);
    // The work item references the OTHER node — removing the bystander affects nothing AX-side.
    canvasState.addWorkItem({ title: 'unrelated', nodeIds: [orphaning.id] }, { source: 'api' });

    canvasState.removeNode(bystander.id);

    const noteEvents = canvasState
      .getAxEvents()
      .filter((e) => e.kind === 'note' && e.data?.systemEvent === 'ax-node-orphan');
    expect(noteEvents).toHaveLength(0);
  });
});
