import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { canvasState, type CanvasNodeState } from '../../src/server/canvas-state.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { executeOperation } from '../../src/server/operations/registry.ts';
import { createTestWorkspace, makeNode, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

// The receipt's Undo on an edit (docs/design/AgentContext.dc.html): one card
// back to its content in the pre-session snapshot, the rest of the board kept.

let root = '';
beforeEach(() => {
  root = createTestWorkspace('pmx-canvas-restore-node-');
  resetCanvasForTests(root);
});
afterEach(() => {
  canvasState.close();
  removeTestWorkspace(root);
});

const card = (id: string) => canvasState.getNode(id) as CanvasNodeState;
const human = { suppressAutoGhost: true, fromWorkbench: true, humanAuthor: true, source: 'browser' };

async function editedSinceSnapshot(): Promise<string> {
  canvasState.loadFromDisk({ clearExisting: true });
  const { board } = (await executeOperation('board.create', { name: 'Receipt' })) as { board: { id: string } };
  await executeOperation('board.open', { id: board.id });
  canvasState.addNode(
    makeNode({ id: 'smb', type: 'markdown', data: { title: 'SMB is price-sensitive', content: 'Eight of twelve.' } }),
  );
  canvasState.addNode(makeNode({ id: 'other', type: 'markdown', data: { title: 'Other', content: 'Kept.' } }));
  const snapshot = (await executeOperation('snapshot.save', { name: 'Before session' })) as { id: string };
  await executeOperation('node.update', { id: 'smb', content: 'Rewritten by the agent.', x: 500, y: 500 });
  await executeOperation('node.update', { id: 'other', content: 'Also edited.' });
  return snapshot.id;
}

describe('snapshot.restore-node', () => {
  test.each([
    false,
    true,
  ])('empty and unresolved bindings remain authoritative when restoring (legacy=%s)', async (legacy) => {
    await editedSinceSnapshot();
    canvasState.createBoard('Negative restore');
    const content = '[[Negative restore]] before';
    canvasState.updateNode('smb', { data: { content } }, []);
    canvasState.updateNode('other', { data: { content } }, [{ ref: 'Negative restore' }]);
    const snapshot = canvasState.saveSnapshot('Negative bindings')!;
    if (legacy) {
      const db = new Database(canvasState.databasePath!);
      db.run("UPDATE snapshot_nodes SET data = json_remove(data, '$.wikiLinks') WHERE snapshot_id = ?", [snapshot.id]);
      db.close();
    }
    for (const id of ['smb', 'other']) {
      canvasState.updateNode(id, { data: { content: '[[Negative restore]] after' } }, null);
      await executeOperation('snapshot.restore-node', { id: snapshot.id, nodeId: id }, human);
    }
    expect(card('smb').data.wikiLinks).toEqual([]);
    expect(card('other').data.wikiLinks).toEqual([{ ref: 'Negative restore' }]);
    canvasState.restoreSnapshot(snapshot.id);
    expect(card('smb').data.wikiLinks).toEqual([]);
    expect(card('other').data.wikiLinks).toEqual([{ ref: 'Negative restore' }]);
  });

  test('legacy snapshot retains the current R1 binding after rename rather than resolving R2', async () => {
    await editedSinceSnapshot();
    const r1 = canvasState.createBoard('Restore reference')!;
    await executeOperation('node.update', { id: 'smb', content: '[[Restore reference]] original' });
    const snapshot = canvasState.saveSnapshot('Legacy reference')!;
    const db = new Database(canvasState.databasePath!);
    db.run("UPDATE snapshot_nodes SET data = json_remove(data, '$.wikiLinks') WHERE snapshot_id = ?", [snapshot.id]);
    db.close();
    canvasState.updateBoard(r1.id, { name: 'Renamed R1' });
    canvasState.createBoard('Restore reference');
    await executeOperation('node.update', { id: 'smb', content: '[[Restore reference]] revised' });
    const binding = [{ ref: 'Restore reference', target: { boardId: r1.id } }];
    expect(card('smb').data.wikiLinks).toEqual(binding);
    canvasState.onMutation((info) => mutationHistory.record(info));
    await executeOperation('snapshot.restore-node', { id: snapshot.id, nodeId: 'smb' }, human);
    expect(card('smb').data.wikiLinks).toEqual(binding);
    mutationHistory.undo();
    expect(card('smb').data.wikiLinks).toEqual(binding);
    mutationHistory.redo();
    expect(card('smb').data.wikiLinks).toEqual(binding);
    canvasState.restoreSnapshot(snapshot.id);
    expect(card('smb').data.wikiLinks).toEqual(binding);
  });

  test('restores snapshot wiki identities including unresolved and empty bindings', async () => {
    await editedSinceSnapshot();
    const target = (await executeOperation('board.create', { name: 'Evidence restore' })) as { board: { id: string } };
    await executeOperation('node.update', { id: 'smb', content: '[[Evidence restore]] [[Pending restore]]' });
    const bindings = structuredClone(card('smb').data.wikiLinks);
    const snapshot = (await executeOperation('snapshot.save', { name: 'Wiki identity' })) as { id: string };
    await executeOperation('node.update', { id: 'smb', content: 'Agent removed links.' });
    await executeOperation('board.update', { id: target.board.id, name: 'Archived restore' }, human);
    await executeOperation('board.create', { name: 'Evidence restore' });
    await executeOperation('board.create', { name: 'Pending restore' });
    await executeOperation('snapshot.restore-node', { id: snapshot.id, nodeId: 'smb' }, human);
    expect(card('smb').data.wikiLinks).toEqual(bindings);
    await executeOperation('snapshot.restore-node', { id: snapshot.id, nodeId: 'other' }, human);
    expect(card('other').data.wikiLinks ?? []).toEqual([]);
  });

  test('puts one card back to its snapshot content as an undoable edit; position and other cards stay', async () => {
    const snapshotId = await editedSinceSnapshot();
    const revision = card('smb').contentRevision ?? 0;
    // A bare test has no server to attach the history recorder.
    canvasState.onMutation((info) => mutationHistory.record(info));
    await executeOperation('snapshot.restore-node', { id: snapshotId, nodeId: 'smb' }, human);
    expect(card('smb').data.content).toBe('Eight of twelve.');
    expect(card('smb').position).toEqual({ x: 500, y: 500 });
    expect(card('smb').contentRevision).toBeGreaterThan(revision);
    expect(card('smb').lastEditedBy?.actor).toBe('human');
    expect(card('other').data.content).toBe('Also edited.');

    mutationHistory.undo();
    expect(card('smb').data.content).toBe('Rewritten by the agent.');
  });

  test('conditional restore leaves a latest-human edit alone; explicit restore still works', async () => {
    const snapshotId = await editedSinceSnapshot();
    await executeOperation('node.update', { id: 'smb', content: 'Human correction.' }, human);
    const revision = card('smb').contentRevision;
    expect(
      await executeOperation(
        'snapshot.restore-node',
        { id: snapshotId, nodeId: 'smb', preserveHumanEdits: true },
        human,
      ),
    ).toMatchObject({ ok: true, restored: false, skipped: 'human-edit' });
    expect(card('smb').data.content).toBe('Human correction.');
    expect(card('smb').contentRevision).toBe(revision);
    expect(card('smb').lastEditedBy?.actor).toBe('human');
    expect(await executeOperation('snapshot.restore-node', { id: snapshotId, nodeId: 'smb' }, human)).toMatchObject({
      ok: true,
      restored: true,
    });
    expect(card('smb').data.content).toBe('Eight of twelve.');
  });

  test('keeps the group the card is in today, and refuses a card whose type changed', async () => {
    const snapshotId = await editedSinceSnapshot();
    canvasState.updateNode('smb', { data: { ...card('smb').data, parentGroup: 'g1' } });
    await executeOperation('snapshot.restore-node', { id: snapshotId, nodeId: 'smb' }, human);
    expect(card('smb').data.content).toBe('Eight of twelve.');
    expect(card('smb').data.parentGroup).toBe('g1');

    canvasState.updateNode('other', { type: 'status' });
    await expect(
      executeOperation('snapshot.restore-node', { id: snapshotId, nodeId: 'other' }, human),
    ).rejects.toMatchObject({ status: 409 });
  });

  test('refuses a missing snapshot or card (404) and a file card (400)', async () => {
    const snapshotId = await editedSinceSnapshot();
    await expect(executeOperation('snapshot.restore-node', { id: 'nope', nodeId: 'smb' }, human)).rejects.toMatchObject(
      {
        status: 404,
      },
    );
    await expect(
      executeOperation('snapshot.restore-node', { id: snapshotId, nodeId: 'ghost' }, human),
    ).rejects.toMatchObject({ status: 404 });
    canvasState.updateNode('smb', { type: 'file' });
    await expect(
      executeOperation('snapshot.restore-node', { id: snapshotId, nodeId: 'smb' }, human),
    ).rejects.toMatchObject({ status: 400 });
  });

  test('an agent cannot restore a card outside its scope fence', async () => {
    const snapshotId = await editedSinceSnapshot();
    await executeOperation('ax.policy.set', { scope: { nodeIds: ['other'], padding: 0 } }, human);
    await expect(executeOperation('snapshot.restore-node', { id: snapshotId, nodeId: 'smb' })).rejects.toMatchObject({
      status: 403,
    });
  });
});
