import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
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
