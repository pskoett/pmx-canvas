import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canvasState } from '../../src/server/canvas-state.ts';
import { addCanvasNode, arrangeCanvasNodes, setCanvasContextPins } from '../../src/server/canvas-operations.ts';
import { validateCanvasLayout } from '../../src/server/canvas-validation.ts';
import {
  createTestWorkspace,
  makeNode,
  removeTestWorkspace,
  resetCanvasForTests,
} from './helpers.ts';

const imageFixtures: Record<string, Buffer | string> = {
  png: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  jpg: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
  gif: Buffer.from('GIF89a'),
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
  webp: Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'binary'),
  bmp: Buffer.from('BM\x00\x00\x00\x00', 'binary'),
  ico: Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]),
  avif: Buffer.from('\x00\x00\x00\x18ftypavif\x00\x00\x00\x00', 'binary'),
};

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

  test('grid arrange spaces columns by the widest movable node', () => {
    canvasState.addNode(makeNode({ id: 'wide', type: 'markdown', size: { width: 960, height: 240 } }));
    canvasState.addNode(makeNode({ id: 'small-1', type: 'markdown', size: { width: 360, height: 200 } }));
    canvasState.addNode(makeNode({ id: 'small-2', type: 'markdown', size: { width: 360, height: 200 } }));
    canvasState.addNode(makeNode({ id: 'small-3', type: 'markdown', size: { width: 360, height: 200 } }));

    arrangeCanvasNodes('grid');

    const validation = validateCanvasLayout(canvasState.getLayout());
    expect(validation.ok).toBe(true);
    expect(validation.summary.collisions).toBe(0);
  });

  test('grid arrange moves group frames without arranging grouped children separately', () => {
    canvasState.addNode(makeNode({
      id: 'group-a',
      type: 'group',
      position: { x: 40, y: 40 },
      size: { width: 600, height: 360 },
      data: { title: 'Group A', children: ['child-a'] },
    }));
    canvasState.addNode(makeNode({
      id: 'child-a',
      type: 'markdown',
      position: { x: 64, y: 84 },
      size: { width: 360, height: 200 },
      data: { title: 'Child A', parentGroup: 'group-a' },
    }));
    canvasState.addNode(makeNode({ id: 'loose-a', type: 'markdown', size: { width: 360, height: 200 } }));

    arrangeCanvasNodes('grid');

    const validation = validateCanvasLayout(canvasState.getLayout());
    expect(validation.summary.containmentViolations).toBe(0);
    expect(canvasState.getNode('child-a')?.data.parentGroup).toBe('group-a');
    expect(canvasState.getNode('group-a')?.position).toEqual({ x: 40, y: 80 });
    expect(canvasState.getNode('child-a')?.position).toEqual({ x: 64, y: 124 });
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

  test('accepts common local image files with matching image bytes', () => {
    for (const [ext, fixture] of Object.entries(imageFixtures)) {
      const imagePath = join(workspaceRoot, `screenshot.${ext}`);
      writeFileSync(imagePath, fixture);
      const created = addCanvasNode({ type: 'image', content: imagePath });
      expect(created.node.type).toBe('image');
    }
  });

  test('accepts http(s) URLs and data: URIs with image/* media type', () => {
    expect(() => addCanvasNode({ type: 'image', content: 'https://example.com/cat.png' })).not.toThrow();
    expect(() => addCanvasNode({ type: 'image', content: 'data:image/png;base64,iVBORw0KGgo=' })).not.toThrow();
    expect(() => addCanvasNode({ type: 'image', content: 'data:image/svg+xml;utf8,<svg/>' })).not.toThrow();
  });

  test('rejects non-image file paths with a helpful message', () => {
    const filePath = join(workspaceRoot, 'Development_Platform_Roadmap.pptx');
    writeFileSync(filePath, 'not image bytes', 'utf-8');
    expect(() =>
      addCanvasNode({ type: 'image', content: filePath }),
    ).toThrow(/Invalid image node.*unsupported extension.*\.pptx/);
  });

  test('rejects fake image files with image extensions', () => {
    const filePath = join(workspaceRoot, 'fake.png');
    writeFileSync(filePath, 'not image bytes', 'utf-8');
    expect(() =>
      addCanvasNode({ type: 'image', content: filePath }),
    ).toThrow(/Invalid image node.*not a recognized image file/);
  });

  test('rejects non-image data URIs', () => {
    expect(() =>
      addCanvasNode({ type: 'image', content: 'data:application/pdf;base64,JVBERi0x' }),
    ).toThrow(/Invalid image node.*image\/\*/);
  });
});
