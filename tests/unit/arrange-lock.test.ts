import { beforeEach, describe, expect, test } from 'bun:test';
import { arrangeCanvasNodes, createCanvasGroup } from '../../src/server/canvas-operations.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
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
});
