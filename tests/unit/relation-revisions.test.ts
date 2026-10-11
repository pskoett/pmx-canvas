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
  test.each([
    'node.get',
    'layout.get',
  ])('%s reads content without acknowledging omitted incoming relations', async (operation) => {
    await twoCards();
    const target = canvasState.activeBoardId as string;
    const source = canvasState.createBoard('Remote source')!;
    canvasState.switchBoard(source.id);
    canvasState.addNode(makeNode({ id: 'source', type: 'markdown' }));
    canvasState.addEdge({ id: 'incoming', from: 'source', to: 'plan', toBoardId: target, type: 'references' });
    canvasState.switchBoard(target);
    canvasState.setContextPins(['plan']);
    expect(links('plan')).toBeGreaterThan(0);
    await executeOperation(operation, operation === 'node.get' ? { id: 'plan' } : {});
    const read = canvasState.getContextReads().reads.find((item) => item.resource === operation);
    expect(read?.deliveredNodeIds).toEqual(['plan']);
    expect(read?.readNodes.plan).toBe(content('plan'));
    expect(read?.seenLinks).toEqual({});
    expect(canvasState.getSeenLinks().plan).toBeUndefined();
    await executeOperation('memory-graph.get', {});
    expect(canvasState.getSeenLinks().plan).toBe(links('plan'));
  });

  test.each(['ax.context.get', 'ax.get'])('partial %s delivery keeps omitted relations unseen', async (operation) => {
    await twoCards();
    canvasState.addEdge({ id: 'omitted', from: 'plan', to: 'risk', type: 'references' });
    canvasState.setContextPins(['plan']);
    await executeOperation('annotation.add', {
      type: 'freehand',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    });
    const pending = executeOperation(operation, {});
    canvasState.addEdge({ id: 'after-delivery', from: 'plan', to: 'risk', type: 'relation' });
    await pending;
    const read = canvasState.getContextReads().reads.find((item) => item.resource === operation);
    expect(read?.deliveredNodeIds).toEqual(['plan']);
    expect(read?.readNodes.plan).toBe(content('plan'));
    expect(read?.seenLinks).toEqual({});
    expect(canvasState.getSeenLinks().plan).toBeUndefined();
    await executeOperation('memory-graph.get', {});
    expect(canvasState.getSeenLinks().plan).toBe(links('plan'));
  });

  test('linked README summaries cannot acknowledge a same-ID local card', async () => {
    await twoCards();
    const source = canvasState.activeBoardId as string;
    const target = canvasState.createBoard('Linked README');
    expect(target).not.toBeNull();
    canvasState.switchBoard(target!.id);
    canvasState.addNode(
      makeNode({ id: 'plan', type: 'markdown', data: { title: 'README', content: 'Remote summary' } }),
    );
    canvasState.setBoardReadme(target!.id, 'plan');
    canvasState.switchBoard(source);
    canvasState.addNode(makeNode({ id: 'portal', type: 'board', data: { boardId: target!.id } }));
    const before = (await executeOperation('context.get', { consumer: 'qualified-brief', budget: 50000 })) as {
      cursor: { next: number };
    };
    canvasState.addEdge({ id: 'new-link', from: 'plan', to: 'risk', type: 'relation' });
    // A later cursor leaves only the linked README, not the local changed card.
    const brief = (await executeOperation('context.get', {
      since: canvasState.getContentRevision().revision,
      budget: 50000,
    })) as {
      entries: Array<{ sourceBoardId: string; nodeId: string; text: string }>;
    };
    expect(before.cursor.next).toBeGreaterThanOrEqual(0);
    expect(brief.entries.some((entry) => entry.sourceBoardId === target!.id && entry.nodeId === 'plan')).toBe(true);
    expect(canvasState.getNodeReadStatus().find((item) => item.nodeId === 'plan')).toBeUndefined();
    expect(canvasState.getSeenLinks().plan ?? -1).toBeLessThan(links('plan'));
  });

  test('a second human summary does not acknowledge capped relations omitted on the first read', async () => {
    await twoCards();
    canvasState.removeNode('plan');
    withCurrentActor({ actor: 'human', source: 'browser' }, () =>
      canvasState.addNode(
        makeNode({ id: 'plan', type: 'markdown', data: { title: 'Human plan', content: 'Human authored' } }),
      ),
    );
    for (let index = 0; index < 9; index += 1) {
      canvasState.addNode(makeNode({ id: `relation-${index}`, type: 'markdown' }));
      canvasState.addEdge({ id: `link-${index}`, from: 'plan', to: `relation-${index}`, type: 'relation' });
    }
    const first = (await executeOperation('context.get', { consumer: 'human-capped', budget: 50000 })) as {
      entries: Array<{ nodeId: string; linksComplete?: false }>;
    };
    expect(first.entries.find((entry) => entry.nodeId === 'plan')?.linksComplete).toBe(false);
    expect(canvasState.getSeenLinks().plan).toBeUndefined();
    const second = (await executeOperation('context.get', { consumer: 'human-capped', budget: 50000 })) as {
      entries: Array<{ nodeId: string; reason: string }>;
    };
    expect(second.entries.find((entry) => entry.nodeId === 'plan')?.reason).toBe('human');
    expect(canvasState.getSeenLinks().plan).toBeUndefined();
  });

  test('a graph acknowledges the projected revision, not a relation added while its read completes', async () => {
    await twoCards();
    const before = links('plan');
    const pending = executeOperation('memory-graph.get', {});
    canvasState.addEdge({ id: 'after-projection', from: 'plan', to: 'risk', type: 'relation' });
    const graph = (await pending) as { edges: Array<{ id: string }> };
    expect(graph.edges.some((edge) => edge.id.endsWith(':after-projection'))).toBe(false);
    expect(links('plan')).toBeGreaterThan(before);
    expect(canvasState.getSeenLinks().plan).toBe(before);
  });

  test('a brief acknowledges its captured clock, while clockless relations stay unseen', async () => {
    await twoCards();
    const boardId = canvasState.activeBoardId as string;
    const before = links('plan');
    const base = {
      channel: 'operation' as const,
      resource: 'context.get',
      source: 'api',
      consumer: null,
      agentId: null,
    };
    const payload = {
      board: { boardId },
      entries: [
        {
          sourceBoardId: boardId,
          nodeId: 'plan',
          text: 'Complete relations',
          linksRevision: before,
          summaryOnly: true,
        },
        { sourceBoardId: boardId, nodeId: 'risk', text: 'No captured clock', summaryOnly: true },
      ],
    };
    const read = contextReadFromPayload({ ...base, pinnedNodeIds: ['plan'] }, payload);
    canvasState.addEdge({ id: 'after-delivery', from: 'plan', to: 'risk', type: 'relation' });
    canvasState.recordContextRead(read);
    expect(canvasState.getSeenLinks().plan).toBe(before);
    expect(canvasState.getSeenLinks().risk).toBeUndefined();
    const pinnedRead = pinnedBoardReads(base, {
      entries: [
        { sourceBoardId: boardId, nodeId: `board:${boardId}`, reason: 'pinned-board', text: 'Board' },
        payload.entries[0],
      ],
    })[0]!;
    canvasState.recordContextRead(pinnedRead, boardId);
    expect(canvasState.getSeenLinks().plan).toBe(before);
    expect(canvasState.getSeenLinks().risk).toBeUndefined();
  });

  test('saved wiki bindings invalidate both endpoints on changes, replay and target disappearance', async () => {
    await twoCards();
    canvasState.onMutation((info) => mutationHistory.record(info));
    const source = canvasState.activeBoardId as string;
    const { board } = (await executeOperation('board.create', { name: 'Wiki target' })) as { board: { id: string } };
    await executeOperation('board.open', { id: board.id });
    canvasState.addNode(
      makeNode({ id: 'plan', type: 'markdown', data: { title: 'Evidence', content: 'Remote body' } }),
    );
    const targetContent = content('plan');
    await executeOperation('board.open', { id: source });
    canvasState.updateNode('plan', { data: { title: 'Source', content: '[[Wiki target#Evidence]]' } });
    const targetLinks = () =>
      canvasState.readBoard(board.id, false)!.layout.nodes.find((node) => node.id === 'plan')!.linksRevision ?? 0;
    expect(targetLinks()).toBeGreaterThan(0);
    const beforeRemove = targetLinks();
    canvasState.updateNode('plan', { data: { title: 'Source', content: 'No link' } });
    expect(targetLinks()).toBeGreaterThan(beforeRemove);
    mutationHistory.undo();
    expect(targetLinks()).toBeGreaterThan(beforeRemove);
    expect(canvasState.getNode('plan')!.data.wikiLinks).toEqual([
      { ref: 'Wiki target#Evidence', target: { boardId: board.id, cardId: 'plan' } },
    ]);
    const sourceContent = content('plan');
    await executeOperation('context.get', { consumer: 'wiki-reader', budget: 50000 });
    const beforeDeletion = links('plan');
    const localControl = links('risk');
    await executeOperation('board.open', { id: board.id });
    expect(content('plan')).toBe(targetContent);
    canvasState.removeNode('plan');
    await executeOperation('board.open', { id: source });
    expect(links('plan')).toBeGreaterThan(beforeDeletion);
    expect(content('plan')).toBe(sourceContent);
    expect(links('risk')).toBe(localControl);
    const brief = (await executeOperation('context.get', { consumer: 'wiki-reader', budget: 50000 })) as {
      entries: Array<{ nodeId: string; changes?: string[]; text: string }>;
    };
    expect(brief.entries.find((entry) => entry.nodeId === 'plan')).toMatchObject({ changes: ['links'] });
    expect(brief.entries.find((entry) => entry.nodeId === 'plan')?.text).toContain('Missing target');
  });

  test('capped relations stay unseen while a complete nearby card is acknowledged', async () => {
    await twoCards();
    const target = canvasState.activeBoardId as string;
    for (let index = 0; index < 8; index += 1) {
      canvasState.addNode(makeNode({ id: `local-${index}`, type: 'markdown' }));
      await executeOperation('edge.add', {
        id: `local-edge-${index}`,
        from: 'plan',
        to: `local-${index}`,
        type: 'relation',
      });
    }
    await executeOperation('pin.set', { nodeIds: ['plan', 'risk'] });
    await executeOperation('context.get', { consumer: 'capped-reader', budget: 50000 });
    const before = links('plan');
    expect(canvasState.getSeenLinks().plan).toBe(before);
    const { board } = (await executeOperation('board.create', { name: 'Incoming' })) as { board: { id: string } };
    await executeOperation('board.open', { id: board.id });
    canvasState.addNode(makeNode({ id: 'source', type: 'markdown' }));
    await executeOperation('edge.add', {
      from: 'source',
      to: 'plan',
      toBoardId: target,
      type: 'relation',
      label: 'NEW INCOMING',
    });
    await executeOperation('edge.add', {
      from: 'source',
      to: 'risk',
      toBoardId: target,
      type: 'relation',
      label: 'CONTROL INCOMING',
    });
    await executeOperation('board.open', { id: target });
    const revision = links('plan');
    expect(revision).toBeGreaterThan(before);
    const brief = (await executeOperation('context.get', { consumer: 'capped-reader', budget: 50000 })) as {
      entries: Array<{ nodeId: string; text: string; linksComplete?: false }>;
    };
    const capped = brief.entries.find((entry) => entry.nodeId === 'plan');
    expect(capped?.text).toContain('… 1 more relations');
    expect(capped?.text).not.toContain('NEW INCOMING');
    expect(capped?.linksComplete).toBe(false);
    expect(canvasState.getSeenLinks().plan).toBe(before);
    expect(brief.entries.find((entry) => entry.nodeId === 'risk')?.text).toContain('CONTROL INCOMING');
    expect(canvasState.getSeenLinks().risk).toBe(links('risk'));

    // A pinned-board map carries summaries, not card relations, even at a large budget.
    await executeOperation('board.pin', { id: target });
    await executeOperation('board.open', { id: board.id });
    await executeOperation('context.get', { budget: 50000 });
    await executeOperation('board.open', { id: target });
    expect(canvasState.getSeenLinks().plan).toBe(before);
    expect(canvasState.getNodeReadStatus().find((item) => item.nodeId === 'plan')).toBeUndefined();
  });

  test('brief resolves remote card titles in both directions without duplicating local edges', async () => {
    await twoCards();
    const source = canvasState.activeBoardId as string;
    const { board } = (await executeOperation('board.create', { name: 'Remote board' })) as { board: { id: string } };
    await executeOperation('board.open', { id: board.id });
    canvasState.addNode(makeNode({ id: 'risk', type: 'markdown', data: { title: 'Remote risk', content: 'Target' } }));
    await executeOperation('board.open', { id: source });
    canvasState.updateNode('plan', { data: { title: 'Source plan' } });
    canvasState.addEdge({ id: 'local', from: 'plan', to: 'risk', type: 'depends-on' });
    canvasState.addEdge({
      id: 'remote',
      from: 'plan',
      to: 'risk',
      toBoardId: board.id,
      type: 'references',
      label: 'remote label',
    });
    canvasState.addEdge({ id: 'missing', from: 'plan', to: 'absent', toBoardId: board.id, type: 'flow' });
    const read = async () =>
      (await executeOperation('context.get', {})) as { entries: Array<{ nodeId: string; text: string }> };
    const outgoing = (await read()).entries.find((entry) => entry.nodeId === 'plan')?.text ?? '';
    expect(outgoing).toContain('Remote board / Remote risk');
    expect(outgoing).toContain('remote label');
    expect(outgoing).toContain('Missing target');
    expect(outgoing).toContain(`${board.id} / absent`);
    expect(outgoing.match(/→ depends-on/g)).toHaveLength(1);
    await executeOperation('board.open', { id: board.id });
    const incoming = (await read()).entries.find((entry) => entry.nodeId === 'risk')?.text ?? '';
    expect(incoming).toContain('← references "remote label": Relations / Source plan');
    expect(incoming).not.toContain('depends-on');
  });

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
      board: { boardId: 'a' },
      entries: [
        {
          sourceBoardId: 'a',
          nodeId: 'whole',
          reason: 'pinned',
          text: 'Summary\n→ relation: x',
          summaryOnly: true,
          linksRevision: 0,
        },
        { sourceBoardId: 'a', nodeId: 'cut', reason: 'changed', text: 'Summ', summaryOnly: true, truncated: true },
        { sourceBoardId: 'b', nodeId: 'board:b', reason: 'pinned-board', text: 'Board b' },
        {
          sourceBoardId: 'b',
          nodeId: 'b-card',
          reason: 'pinned-board',
          text: 'Card',
          summaryOnly: true,
          linksRevision: 3,
        },
        { sourceBoardId: 'b', nodeId: 'b-cut', reason: 'pinned-board', text: 'Ca', summaryOnly: true, truncated: true },
      ],
    };
    const read = contextReadFromPayload({ ...base, pinnedNodeIds: ['cut'] }, brief);
    expect(read.deliveredNodeIds).toEqual(['cut']);
    expect(read.seenNodeIds).toContain('whole');
    expect(read.seenNodeIds).not.toContain('cut');
    expect(read.seenLinkRevisions).toEqual({ whole: 0 });
    expect(pinnedBoardReads(base, brief).map((item) => [item.boardId, item.seenNodeIds])).toEqual([['b', ['b-card']]]);
    expect(pinnedBoardReads(base, brief)[0]?.seenLinkRevisions).toEqual({ 'b-card': 3 });
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
