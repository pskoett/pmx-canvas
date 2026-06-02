import { beforeEach, describe, expect, test } from 'bun:test';
import { arrangeCanvasNodes, createCanvasGroup } from '../../src/server/canvas-operations.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import { validateCanvasLayout } from '../../src/server/canvas-validation.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { makeNode } from './helpers.ts';

describe('arrange exclusions', () => {
  beforeEach(() => {
    canvasState.withSuppressedRecording(() => {
      canvasState.clear();
    });
    mutationHistory.reset();
  });

  test('skips pinned nodes during arrange', () => {
    canvasState.addNode(makeNode({
      id: 'locked-node',
      type: 'markdown',
      position: { x: 900, y: 700 },
      pinned: true,
      data: { title: 'Pinned' },
    }));
    canvasState.addNode(makeNode({
      id: 'movable-node',
      type: 'markdown',
      position: { x: 500, y: 500 },
      data: { title: 'Movable' },
    }));

    const result = arrangeCanvasNodes('column');

    expect(result.arranged).toBe(1);
    expect(canvasState.getNode('locked-node')?.position).toEqual({ x: 900, y: 700 });
    expect(canvasState.getNode('movable-node')?.position).toEqual({ x: 40, y: 80 });
  });

  test('skips arrange-locked groups and their children during arrange', () => {
    const child = makeNode({
      id: 'group-child',
      type: 'markdown',
      position: { x: 700, y: 640 },
      size: { width: 360, height: 200 },
      data: { title: 'Grouped child' },
    });
    const other = makeNode({
      id: 'other-node',
      type: 'markdown',
      position: { x: 1200, y: 1000 },
      data: { title: 'Other' },
    });

    canvasState.addNode(child);
    canvasState.addNode(other);
    const { id: groupId } = createCanvasGroup({
      title: 'Locked group',
      childIds: [child.id],
    });

    const group = canvasState.getNode(groupId);
    if (!group) {
      throw new Error('Expected group node to exist.');
    }
    const originalGroupPosition = { ...group.position };
    const originalChildPosition = { ...child.position };

    canvasState.updateNode(groupId, {
      data: {
        ...group.data,
        arrangeLocked: true,
      },
    });

    const result = arrangeCanvasNodes('grid');

    expect(result.arranged).toBe(1);
    expect(canvasState.getNode(groupId)?.position).toEqual(originalGroupPosition);
    expect(canvasState.getNode(child.id)?.position).toEqual(originalChildPosition);
    expect(canvasState.getNode(other.id)?.position).toEqual({ x: 40, y: 80 });
  });

  test('keeps grid-arranged nodes out of a group preserved by a docked child', () => {
    const dockedChild = makeNode({
      id: 'docked-child',
      type: 'markdown',
      position: { x: 40, y: 80 },
      size: { width: 360, height: 200 },
      data: { title: 'Docked child' },
    });
    const groupedChild = makeNode({
      id: 'grouped-child',
      type: 'status',
      position: { x: 440, y: 80 },
      size: { width: 360, height: 200 },
      data: { title: 'Grouped child' },
    });
    const graph = makeNode({
      id: 'graph-node',
      type: 'graph',
      position: { x: 960, y: 80 },
      size: { width: 360, height: 260 },
      data: { title: 'Graph' },
    });

    canvasState.addNode(dockedChild);
    canvasState.addNode(groupedChild);
    canvasState.addNode(graph);
    const { id: groupId } = createCanvasGroup({
      title: 'Group with docked child',
      childIds: [dockedChild.id, groupedChild.id],
    });

    const group = canvasState.getNode(groupId);
    if (!group) {
      throw new Error('Expected group node to exist.');
    }
    const originalGroupPosition = { ...group.position };
    const originalGroupedChildPosition = { ...groupedChild.position };
    canvasState.updateNode(dockedChild.id, { dockPosition: 'right' });

    const result = arrangeCanvasNodes('grid');
    const updatedGroup = canvasState.getNode(groupId);
    const updatedGraph = canvasState.getNode(graph.id);
    const validation = validateCanvasLayout(canvasState.getLayout());

    expect(result.arranged).toBe(1);
    expect(updatedGroup?.position).toEqual(originalGroupPosition);
    expect(canvasState.getNode(groupedChild.id)?.position).toEqual(originalGroupedChildPosition);
    expect(updatedGraph?.position.y).toBeGreaterThanOrEqual(
      (updatedGroup?.position.y ?? 0) + (updatedGroup?.size.height ?? 0),
    );
    expect(validation.ok).toBe(true);
    expect(validation.collisions).toEqual([]);
  });
});
