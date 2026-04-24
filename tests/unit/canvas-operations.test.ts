import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { canvasState } from '../../src/server/canvas-state.ts';
import { addCanvasNode, setCanvasContextPins } from '../../src/server/canvas-operations.ts';
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

describe('image node validation', () => {
  let workspaceRoot = '';

  beforeEach(() => {
    workspaceRoot = createTestWorkspace('pmx-canvas-image-');
    resetCanvasForTests(workspaceRoot);
  });

  afterEach(() => {
    removeTestWorkspace(workspaceRoot);
  });

  test('accepts common image extensions', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif']) {
      const created = addCanvasNode({ type: 'image', content: `/tmp/screenshot.${ext}` });
      expect(created.node.type).toBe('image');
    }
  });

  test('accepts http(s) URLs and data: URIs with image/* media type', () => {
    expect(() => addCanvasNode({ type: 'image', content: 'https://example.com/cat.png' })).not.toThrow();
    expect(() => addCanvasNode({ type: 'image', content: 'data:image/png;base64,iVBORw0KGgo=' })).not.toThrow();
    expect(() => addCanvasNode({ type: 'image', content: 'data:image/svg+xml;utf8,<svg/>' })).not.toThrow();
  });

  test('rejects non-image file paths with a helpful message', () => {
    expect(() =>
      addCanvasNode({ type: 'image', content: '/tmp/Development_Platform_Roadmap.pptx' }),
    ).toThrow(/Invalid image node.*unsupported extension.*\.pptx/);
  });

  test('rejects non-image data URIs', () => {
    expect(() =>
      addCanvasNode({ type: 'image', content: 'data:application/pdf;base64,JVBERi0x' }),
    ).toThrow(/Invalid image node.*image\/\*/);
  });
});
