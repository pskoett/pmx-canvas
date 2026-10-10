import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { withCurrentActor } from '../../src/server/attribution.ts';
import { canvasState, type CanvasNodeState } from '../../src/server/canvas-state.ts';
import { contextReadFromPayload, pinnedBoardReads } from '../../src/server/context-reads.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { executeOperation } from '../../src/server/operations/registry.ts';
import { createTestWorkspace, makeNode, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

// Connection changes (option C, docs/design/LinksOptions.dc.html): links are
// tracked apart from text. A link change advances both endpoints' links
// revision — never their content revision, so read marks stay — and reaches
// the consumer's next incremental brief; the link itself records who changed it.

let root = '';
beforeEach(() => {
  root = createTestWorkspace('pmx-canvas-relations-');
  resetCanvasForTests(root);
});
afterEach(() => {
  canvasState.close();
  removeTestWorkspace(root);
});

const node = (id: string) => canvasState.getNode(id) as CanvasNodeState;
const links = (id: string) => node(id).linksRevision ?? 0;
const content = (id: string) => node(id).contentRevision ?? 0;
const edge = (id: string) => canvasState.getEdges().find((item) => item.id === id);

async function twoCards(): Promise<void> {
  canvasState.loadFromDisk({ clearExisting: true });
  const { board } = (await executeOperation('board.create', { name: 'Relations' })) as { board: { id: string } };
  await executeOperation('board.open', { id: board.id });
  canvasState.addNode(makeNode({ id: 'plan', type: 'markdown', position: { x: 0, y: 0 } }));
  canvasState.addNode(makeNode({ id: 'risk', type: 'markdown', position: { x: 2000, y: 0 } }));
}

describe('connection changes are tracked apart from text', () => {
  test('add, relabel and remove advance both links revisions; text, style and auto-edges do not', async () => {
    await twoCards();
    const cursor = canvasState.getContentRevision().revision;
    const text = { plan: content('plan'), risk: content('risk') };

    canvasState.addEdge({ id: 'e1', from: 'plan', to: 'risk', type: 'depends-on' });
    expect(links('plan')).toBeGreaterThan(cursor);
    expect(links('risk')).toBe(links('plan'));
    expect(content('plan')).toBe(text.plan);
    expect(edge('e1')?.revision).toBe(links('plan'));
    expect(edge('e1')?.changedBy?.actor).toBe('agent');
    const brief = (await executeOperation('context.get', { since: cursor })) as {
      entries: Array<{ nodeId: string; text: string }>;
    };
    expect(brief.entries.find((entry) => entry.nodeId === 'plan')?.text).toContain('→ depends-on');

    let before = links('plan');
    canvasState.updateEdge('e1', { style: 'dashed' });
    expect(links('plan')).toBe(before);
    canvasState.updateEdge('e1', { label: 'blocked by' });
    expect(links('plan')).toBeGreaterThan(before);
    expect(edge('e1')?.revision).toBe(links('plan'));

    before = links('risk');
    canvasState.removeEdge('e1');
    expect(links('risk')).toBeGreaterThan(before);
    expect(content('risk')).toBe(text.risk);

    before = links('plan');
    canvasState.addEdge({ id: 'codegraph-plan-risk', from: 'plan', to: 'risk', type: 'depends-on' });
    expect(links('plan')).toBe(before);
    expect(edge('codegraph-plan-risk')?.revision).toBeUndefined();
  });

  test('a brief that carries either end marks the link seen; a later change is unseen again', async () => {
    await twoCards();
    canvasState.addEdge({ id: 'e1', from: 'plan', to: 'risk', type: 'relation', label: 'supports' });
    const revision = edge('e1')?.revision ?? 0;
    expect(canvasState.getSeenLinks()).toEqual({});

    await executeOperation('context.get', {});
    const seen = canvasState.getSeenLinks();
    expect(Math.max(seen.plan ?? -1, seen.risk ?? -1)).toBeGreaterThanOrEqual(revision);
    const status = (await executeOperation('ax.reads.status', {})) as { links: Record<string, number> };
    expect(status.links).toEqual(seen);

    canvasState.updateEdge('e1', { label: 'contradicts' });
    const after = canvasState.getSeenLinks();
    expect(edge('e1')?.revision ?? 0).toBeGreaterThan(Math.max(after.plan ?? -1, after.risk ?? -1));
  });

  test('stamps survive a reload, and a restore that changes links restamps both ends', async () => {
    await twoCards();
    canvasState.addEdge({ id: 'e1', from: 'plan', to: 'risk', type: 'relation' });
    const stamped = edge('e1');
    await executeOperation('snapshot.save', { name: 'with link' });
    canvasState.removeEdge('e1');
    const text = content('plan');
    const before = links('plan');

    await executeOperation('snapshot.restore', { id: 'with link' });
    expect(edge('e1')).toBeDefined();
    expect(links('plan')).toBeGreaterThan(before);
    expect(content('plan')).toBe(text);
    expect(edge('e1')?.revision).toBe(links('plan'));

    const restored = edge('e1');
    canvasState.flushToDisk();
    canvasState.close();
    canvasState.setWorkspaceRoot(root);
    expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);
    expect(edge('e1')?.revision).toBe(restored?.revision);
    expect(edge('e1')?.changedBy).toEqual(restored?.changedBy);
    expect(links('plan')).toBe(restored?.revision ?? -1);
    expect(stamped?.revision).toBeLessThan(restored?.revision ?? 0);
  });

  test('undoing a node or style change never rolls a links revision or stamp back', async () => {
    await twoCards();
    canvasState.onMutation((info) => mutationHistory.record(info));
    canvasState.addEdge({ id: 'e1', from: 'plan', to: 'risk', type: 'relation' });
    canvasState.updateNode('plan', { position: { x: 40, y: 40 } });
    canvasState.updateEdge('e1', { style: 'dashed' });
    canvasState.updateEdge('e1', { label: 'supports' });
    const stamp = edge('e1')?.revision ?? 0;
    expect(links('plan')).toBe(stamp);

    mutationHistory.undo(); // relabel: a link change of its own, restamped
    mutationHistory.undo(); // style: keeps the current stamp
    const afterStyleUndo = edge('e1')?.revision ?? 0;
    expect(afterStyleUndo).toBeGreaterThan(stamp);
    mutationHistory.undo(); // the move: links revision stays
    expect(links('plan')).toBe(afterStyleUndo);
  });

  test('deleting a card stamps the card it was linked to', async () => {
    await twoCards();
    canvasState.addEdge({ id: 'e1', from: 'plan', to: 'risk', type: 'relation' });
    const before = links('risk');
    canvasState.removeNode('plan');
    expect(links('risk')).toBeGreaterThan(before);
  });

  test('a copied board starts without the source board stamps', async () => {
    await twoCards();
    canvasState.addEdge({ id: 'e1', from: 'plan', to: 'risk', type: 'relation', label: 'supports' });
    const source = canvasState.activeBoardId as string;
    const copy = canvasState.createBoardFromBoard({ sourceBoardId: source, name: 'Copy', nodeIds: ['plan', 'risk'] });
    const read = canvasState.readBoard(copy?.id as string, false);
    expect(read?.state.edges).toHaveLength(1);
    expect(read?.state.edges[0]?.revision).toBeUndefined();
    expect(read?.state.edges[0]?.changedBy).toBeUndefined();
    expect(read?.state.nodes.every((item) => (item.linksRevision ?? 0) === 0)).toBe(true);
  });

  test('a clipped entry has not carried its relations; a pinned board records its unclipped summaries', () => {
    const base = {
      channel: 'operation' as const,
      resource: 'context.get',
      source: 'mcp',
      consumer: null,
      agentId: null,
    };
    const brief = {
      entries: [
        { sourceBoardId: 'a', nodeId: 'whole', reason: 'pinned', text: 'Summary\n→ relation: x', summaryOnly: true },
        { sourceBoardId: 'a', nodeId: 'cut', reason: 'changed', text: 'Summ', summaryOnly: true, truncated: true },
        { sourceBoardId: 'b', nodeId: 'board:b', reason: 'pinned-board', text: 'Board b' },
        { sourceBoardId: 'b', nodeId: 'b-card', reason: 'pinned-board', text: 'Card', summaryOnly: true },
        { sourceBoardId: 'b', nodeId: 'b-cut', reason: 'pinned-board', text: 'Ca', summaryOnly: true, truncated: true },
      ],
    };
    const read = contextReadFromPayload({ ...base, pinnedNodeIds: ['cut'] }, brief);
    expect(read.deliveredNodeIds).toEqual(['cut']);
    expect(read.seenNodeIds).toContain('whole');
    expect(read.seenNodeIds).not.toContain('cut');
    expect(pinnedBoardReads(base, brief).map((item) => [item.boardId, item.seenNodeIds])).toEqual([['b', ['b-card']]]);
  });

  test('a link keeps its author until a person changes it; undo restores it as it was (LinkAuthorship.dc.html)', async () => {
    await twoCards();
    canvasState.onMutation((info) => mutationHistory.record(info));
    canvasState.addEdge({ id: 'e1', from: 'plan', to: 'risk', type: 'relation', label: 'supports' });
    const drawn = edge('e1');
    expect(drawn?.changedBy?.actor).toBe('agent');
    expect(drawn?.createdBy).toEqual(drawn?.changedBy);
    expect(typeof drawn?.changedAt).toBe('string');
    expect(drawn?.createdAt).toBe(drawn?.changedAt);

    // Deleting and undoing restores the agent's link, not a new one by whoever pressed undo.
    withCurrentActor({ actor: 'human', source: 'browser' }, () => canvasState.removeEdge('e1'));
    withCurrentActor({ actor: 'human', source: 'browser' }, () => mutationHistory.undo());
    expect(edge('e1')?.changedBy).toEqual(drawn?.changedBy);
    expect(edge('e1')?.createdAt).toBe(drawn?.createdAt);

    // A person's relabel takes it over; who first drew it stays. Undoing the
    // relabel hands the link back to the agent, under a new revision.
    withCurrentActor({ actor: 'human', source: 'browser' }, () => canvasState.updateEdge('e1', { label: 'informs' }));
    expect(edge('e1')?.changedBy?.actor).toBe('human');
    expect(edge('e1')?.createdBy).toEqual(drawn?.createdBy);
    const relabelled = edge('e1')?.revision ?? 0;
    withCurrentActor({ actor: 'human', source: 'browser' }, () => mutationHistory.undo());
    expect(edge('e1')?.label).toBe('supports');
    expect(edge('e1')?.changedBy).toEqual(drawn?.changedBy);
    expect(edge('e1')?.revision ?? 0).toBeGreaterThan(relabelled);
    withCurrentActor({ actor: 'human', source: 'browser' }, () => mutationHistory.redo());
    expect(edge('e1')?.changedBy?.actor).toBe('human');

    // Authorship survives a reload.
    const before = edge('e1');
    canvasState.flushToDisk();
    canvasState.close();
    canvasState.setWorkspaceRoot(root);
    expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);
    const after = edge('e1');
    expect([after?.changedBy, after?.changedAt, after?.createdBy, after?.createdAt]).toEqual([
      before?.changedBy,
      before?.changedAt,
      before?.createdBy,
      before?.createdAt,
    ]);
  });

  test('undoing a snapshot restore brings a link back with its author, not as the undoer’s', async () => {
    await twoCards();
    canvasState.onMutation((info) => mutationHistory.record(info));
    await executeOperation('snapshot.save', { name: 'before the link' });
    canvasState.addEdge({ id: 'e1', from: 'plan', to: 'risk', type: 'relation', label: 'supports' });
    const drawn = edge('e1');
    expect(drawn?.changedBy?.actor).toBe('agent');

    await withCurrentActor({ actor: 'human', source: 'browser' }, () =>
      executeOperation('snapshot.restore', { id: 'before the link' }),
    );
    expect(edge('e1')).toBeUndefined();
    withCurrentActor({ actor: 'human', source: 'browser' }, () => mutationHistory.undo());
    expect(edge('e1')?.changedBy).toEqual(drawn?.changedBy);
    expect(edge('e1')?.createdAt).toBe(drawn?.createdAt);
    expect(edge('e1')?.revision ?? 0).toBeGreaterThan(drawn?.revision ?? 0);
  });
});
