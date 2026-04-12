import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { canvasState } from '../../src/server/canvas-state.ts';
import { setCanvasContextPins } from '../../src/server/canvas-operations.ts';
import {
  createTestWorkspace,
  makeNode,
  removeTestWorkspace,
  resetCanvasForTests,
} from './helpers.ts';

describe('canvas operations', () => {
  let workspaceRoot = '';

  beforeEach(() => {
    workspaceRoot = createTestWorkspace('pmx-canvas-ops-');
    resetCanvasForTests(workspaceRoot);
  });

  afterEach(() => {
    removeTestWorkspace(workspaceRoot);
  });

  test('supports set, add, and remove pin modes with shared pin limits', () => {
    const nodeIds: string[] = [];
    for (let index = 0; index < 25; index++) {
      const id = `node-${index}`;
      nodeIds.push(id);
      canvasState.addNode(makeNode({ id, type: 'markdown', data: { title: id } }));
    }

    const setResult = setCanvasContextPins([...nodeIds, nodeIds[0]!], 'set');
    expect(setResult.count).toBe(20);
    expect(setResult.nodeIds).toEqual(nodeIds.slice(0, 20));

    const addResult = setCanvasContextPins([nodeIds[18]!, nodeIds[20]!, 'missing-node'], 'add');
    expect(addResult.count).toBe(20);
    expect(addResult.nodeIds).toEqual(nodeIds.slice(0, 20));

    const removeResult = setCanvasContextPins([nodeIds[0]!, nodeIds[5]!, 'missing-node'], 'remove');
    expect(removeResult.nodeIds).toEqual(nodeIds.slice(1, 5).concat(nodeIds.slice(6, 20)));
    expect(Array.from(canvasState.contextPinnedNodeIds)).toEqual(removeResult.nodeIds);
  });
});
