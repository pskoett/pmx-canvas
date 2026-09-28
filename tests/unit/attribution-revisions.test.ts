import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { canvasState } from '../../src/server/canvas-state.ts';
import { currentActor, setCurrentActor, withCurrentActor } from '../../src/server/attribution.ts';
import { executeOperation } from '../../src/server/operations/registry.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { createTestWorkspace, makeNode, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

describe('bounded attribution and content revisions', () => {
  let workspaceRoot = '';

  beforeEach(() => {
    workspaceRoot = createTestWorkspace('pmx-attribution-');
    resetCanvasForTests(workspaceRoot);
    setCurrentActor(null);
  });

  afterEach(() => {
    setCurrentActor(null);
    removeTestWorkspace(workspaceRoot);
  });

  test('server stamps provenance, ignores forged fields, and geometry does not revise content', () => {
    setCurrentActor({ actor: 'agent', source: 'mcp', agentId: 'worker-a' });
    canvasState.addNode({
      ...makeNode({ id: 'owned', type: 'markdown', data: { title: 'Original', createdBy: { actor: 'human' } } }),
      createdBy: { actor: 'human', source: 'forged' },
      contentRevision: 999,
    });
    const created = canvasState.getNode('owned')!;
    expect(created.createdBy).toEqual({ actor: 'agent', source: 'mcp', agentId: 'worker-a' });
    expect(created.data.createdBy).toBeUndefined();
    const firstRevision = created.contentRevision!;

    canvasState.updateNode('owned', { position: { x: 40, y: 50 } });
    expect(canvasState.getNode('owned')!.contentRevision).toBe(firstRevision);

    setCurrentActor({ actor: 'agent', source: 'mcp', agentId: 'worker-b' });
    canvasState.updateNode('owned', { data: { title: 'Changed' } });
    const edited = canvasState.getNode('owned')!;
    expect(edited.createdBy).toEqual(created.createdBy);
    expect(edited.lastEditedBy).toEqual({ actor: 'agent', source: 'mcp', agentId: 'worker-b' });
    expect(edited.contentRevision).toBeGreaterThan(firstRevision);
  });

  test('persists attribution, revisions and deletion tombstones across restart', () => {
    setCurrentActor({ actor: 'agent', source: 'sdk', agentId: 'persisted-agent' });
    canvasState.addNode(makeNode({ id: 'keep', type: 'markdown', data: { title: 'Keep' } }));
    canvasState.addNode(makeNode({ id: 'gone', type: 'markdown', data: { title: 'Gone' } }));
    const beforeDelete = canvasState.getContentRevision().revision;
    canvasState.removeNode('gone');
    const beforeRestart = canvasState.getContentRevision().revision;
    canvasState.flushToDisk();
    canvasState.close();
    canvasState.setWorkspaceRoot(workspaceRoot);
    expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);

    expect(canvasState.getNode('keep')!.createdBy?.agentId).toBe('persisted-agent');
    expect(canvasState.getContentRevision().revision).toBe(beforeRestart);
    expect(canvasState.readContentDelta(beforeDelete).deleted).toEqual([
      expect.objectContaining({ nodeId: 'gone', revision: beforeRestart }),
    ]);
  });

  test('concurrent and nested work keeps its own writer across awaits', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delayed = withCurrentActor({ actor: 'agent', source: 'mcp', agentId: 'slow' }, async () => {
      await gate;
      canvasState.addNode(makeNode({ id: 'slow-card', type: 'markdown' }));
      await withCurrentActor({ actor: 'agent', source: 'cli', agentId: 'nested' }, async () => {
        await Promise.resolve();
        expect(currentActor().agentId).toBe('nested');
      });
      expect(currentActor().agentId).toBe('slow');
    });
    await withCurrentActor({ actor: 'human', source: 'browser' }, async () => {
      canvasState.addNode(makeNode({ id: 'human-card', type: 'markdown' }));
      release();
      await delayed;
      expect(currentActor().actor).toBe('human');
    });
    expect(canvasState.getNode('slow-card')?.createdBy?.agentId).toBe('slow');
    expect(canvasState.getNode('human-card')?.createdBy?.actor).toBe('human');
    expect(currentActor().actor).toBe('agent');
  });

  test('ordinary undo, clear, and restoring an old snapshot never hide a delta', () => {
    canvasState.onMutation((info) => mutationHistory.record(info));
    canvasState.addNode(makeNode({ id: 'stable', type: 'markdown', data: { content: 'original' } }));
    const snapshot = canvasState.saveSnapshot('old')!;
    canvasState.updateNode('stable', { data: { content: 'new' } });
    const afterEdit = canvasState.getContentRevision().revision;
    mutationHistory.undo();
    expect(canvasState.readContentDelta(afterEdit).nodes.map((node) => node.id)).toEqual(['stable']);
    canvasState.addNode(makeNode({ id: 'deleted-after-snapshot', type: 'markdown' }));
    const beforeDelete = canvasState.getContentRevision().revision;
    canvasState.removeNode('deleted-after-snapshot');
    canvasState.restoreSnapshot(snapshot.id);
    expect(canvasState.readContentDelta(beforeDelete).deleted.map((node) => node.nodeId)).toContain(
      'deleted-after-snapshot',
    );
    const beforeClear = canvasState.getContentRevision().revision;
    canvasState.clear();
    expect(canvasState.readContentDelta(beforeClear).deleted.map((node) => node.nodeId)).toContain('stable');
  });

  test('restore and undo allocate fresh revisions and preserve creator provenance', () => {
    canvasState.onMutation((info) => mutationHistory.record(info));
    setCurrentActor({ actor: 'agent', source: 'sdk', agentId: 'creator' });
    canvasState.addNode(makeNode({ id: 'card', type: 'markdown', data: { title: 'v1' } }));
    const creator = canvasState.getNode('card')!.createdBy;
    const snapshot = canvasState.saveSnapshot('v1')!;
    canvasState.updateNode('card', { data: { title: 'v2' } });
    const beforeRestore = canvasState.getContentRevision().revision;
    expect(canvasState.restoreSnapshot(snapshot.id)).toBe(true);
    expect(canvasState.getContentRevision().revision).toBeGreaterThan(beforeRestore);
    expect(canvasState.getNode('card')!.createdBy).toEqual(creator);
    const beforeUndo = canvasState.getContentRevision().revision;
    mutationHistory.undo();
    expect(canvasState.getContentRevision().revision).toBeGreaterThan(beforeUndo);
  });

  test('group membership changes and their one-step undo stamp semantic revisions', () => {
    canvasState.onMutation((info) => mutationHistory.record(info));
    canvasState.addNode(makeNode({ id: 'group', type: 'group', data: { title: 'Group', children: [] } }));
    canvasState.addNode(makeNode({ id: 'child', type: 'markdown' }));

    setCurrentActor({ actor: 'agent', source: 'mcp', agentId: 'grouper' });
    const beforeGroup = canvasState.getContentRevision().revision;
    expect(canvasState.groupNodes('group', ['child'], { preservePositions: true })).toBe(true);
    expect(canvasState.getNode('group')!.contentRevision).toBeGreaterThan(beforeGroup);
    expect(canvasState.getNode('child')!.contentRevision).toBeGreaterThan(beforeGroup);
    expect(canvasState.getNode('child')!.lastEditedBy?.agentId).toBe('grouper');

    const beforeUndo = canvasState.getContentRevision().revision;
    expect(mutationHistory.undo()).not.toBeNull();
    expect(canvasState.getNode('group')!.contentRevision).toBeGreaterThan(beforeUndo);
    expect(canvasState.getNode('child')!.contentRevision).toBeGreaterThan(beforeUndo);
    expect(canvasState.getNode('group')!.data.children).toEqual([]);
    expect(canvasState.getNode('child')!.data.parentGroup).toBeUndefined();
    expect(mutationHistory.undo()).not.toBeNull();
    expect(canvasState.getNode('child')).toBeUndefined();
  });

  test('release and group dissolution stamp every changed membership on apply and undo', () => {
    canvasState.onMutation((info) => mutationHistory.record(info));
    canvasState.addNode(makeNode({ id: 'group', type: 'group', data: { title: 'Group', children: [] } }));
    canvasState.addNode(makeNode({ id: 'child', type: 'markdown' }));
    canvasState.groupNodes('group', ['child'], { preservePositions: true });

    let cursor = canvasState.getContentRevision().revision;
    expect(canvasState.releaseGroupChildren('group')).toBe(true);
    expect(
      canvasState
        .readContentDelta(cursor)
        .nodes.map((node) => node.id)
        .sort(),
    ).toEqual(['child', 'group']);
    cursor = canvasState.getContentRevision().revision;
    expect(mutationHistory.undo()).not.toBeNull();
    expect(
      canvasState
        .readContentDelta(cursor)
        .nodes.map((node) => node.id)
        .sort(),
    ).toEqual(['child', 'group']);

    cursor = canvasState.getContentRevision().revision;
    canvasState.removeNode('group');
    expect(canvasState.readContentDelta(cursor).nodes.map((node) => node.id)).toEqual(['child']);
    cursor = canvasState.getContentRevision().revision;
    expect(mutationHistory.undo()).not.toBeNull();
    expect(
      canvasState
        .readContentDelta(cursor)
        .nodes.map((node) => node.id)
        .sort(),
    ).toEqual(['child', 'group']);
  });

  test('create-from externalizes copied large HTML before direct board persistence', () => {
    const html = `<main>${'copied content '.repeat(500)}</main>`;
    canvasState.addNode(makeNode({ id: 'large-html', type: 'html', data: { title: 'Large', html } }));
    canvasState.flushToDisk();
    const sourceBoardId = canvasState.activeBoardId!;

    const copied = canvasState.createBoardFromBoard({
      sourceBoardId,
      name: 'Copied HTML',
      nodeIds: ['large-html'],
    })!;
    const persisted = canvasState.readBoard(copied.id, false)!;
    const copiedHtml = persisted.layout.nodes.find((node) => node.type === 'html')!;
    expect(canvasState.isBlobReference(copiedHtml.data.html)).toBe(true);
    expect(canvasState.readBoard(copied.id, true)!.layout.nodes.find((node) => node.type === 'html')!.data.html).toBe(
      html,
    );
  });

  test('answer attribution distinguishes agents, self-answer, human and TTL system', async () => {
    const requested = (await executeOperation(
      'ax.approval.request',
      { title: 'Agent ask', agentId: 'orchestrator' },
      { source: 'mcp' },
    )) as { approvalGate: { id: string } };
    const other = (await executeOperation(
      'ax.approval.resolve',
      { id: requested.approvalGate.id, decision: 'approved', agentId: 'reviewer' },
      { source: 'mcp' },
    )) as { approvalGate: { resolvedBy: { agentId?: string }; selfAnswer: boolean } };
    expect(other.approvalGate.resolvedBy.agentId).toBe('reviewer');
    expect(other.approvalGate.selfAnswer).toBe(false);

    const selfRequest = (await executeOperation(
      'ax.approval.request',
      { title: 'Self ask', agentId: 'orchestrator' },
      { source: 'mcp' },
    )) as { approvalGate: { id: string } };
    const self = (await executeOperation(
      'ax.approval.resolve',
      { id: selfRequest.approvalGate.id, decision: 'approved', agentId: 'orchestrator' },
      { source: 'mcp' },
    )) as { approvalGate: { selfAnswer: boolean } };
    expect(self.approvalGate.selfAnswer).toBe(true);

    const humanRequest = canvasState.requestApproval({ title: 'Human answer' }, { source: 'sdk' });
    setCurrentActor({ actor: 'human', source: 'browser' });
    const human = canvasState.resolveApproval(humanRequest.id, 'rejected', { source: 'browser' })!;
    expect(human.resolvedBy).toEqual({ actor: 'human', source: 'browser' });

    setCurrentActor(null);
    const systemRequest = canvasState.requestApproval({ title: 'Timeout' }, { source: 'sdk' });
    const system = canvasState.resolveApproval(systemRequest.id, 'held', { source: 'system' })!;
    expect(system.resolvedBy).toEqual({ actor: 'system', source: 'system' });
  });
});
