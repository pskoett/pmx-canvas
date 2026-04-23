import { afterEach, describe, expect, test } from 'bun:test';
import { createCanvas } from '../../src/server/index.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import {
  createTestWorkspace,
  removeTestWorkspace,
  resetCanvasForTests,
} from './helpers.ts';

describe('PmxCanvas SDK surface', () => {
  let workspaceRoot = '';

  afterEach(() => {
    if (workspaceRoot) {
      resetCanvasForTests(workspaceRoot);
      removeTestWorkspace(workspaceRoot);
      workspaceRoot = '';
    }
  });

  test('supports core in-memory node, grouping, pinning, viewport, and snapshot flows', async () => {
    workspaceRoot = createTestWorkspace('pmx-canvas-sdk-');
    resetCanvasForTests(workspaceRoot);

    const canvas = createCanvas({ port: 4789 });

    const firstId = canvas.addNode({
      type: 'markdown',
      title: 'First note',
      content: 'Alpha',
      x: 140,
      y: 220,
      width: 300,
      height: 180,
    });
    const secondId = canvas.addNode({
      type: 'markdown',
      title: 'Second note',
      content: 'Beta',
      x: 520,
      y: 220,
    });

    expect(canvas.port).toBe(4789);
    expect(canvas.getNode(firstId)?.data.title).toBe('First note');
    expect(() => canvas.addNode({ type: 'webpage', content: 'https://example.com' })).toThrow(
      'Use addWebpageNode',
    );

    const groupId = canvas.createGroup({ title: 'Cluster', childIds: [firstId] });
    expect(canvas.groupNodes(groupId, [secondId], { childLayout: 'column' })).toBe(true);

    const group = canvas.getNode(groupId);
    expect(group?.type).toBe('group');
    expect(group?.data.children).toEqual([firstId, secondId]);

    const pins = canvas.setContextPins([firstId, secondId]);
    expect(pins).toEqual({ count: 2, nodeIds: [firstId, secondId] });

    canvas.focusNode(firstId);
    expect(canvasState.viewport).toEqual({ x: 40, y: 120, scale: 1 });

    const applied = canvas.applyUpdates([
      {
        id: secondId,
        position: { x: 640, y: 360 },
        collapsed: true,
      },
    ]);
    expect(applied).toEqual({ applied: 1, skipped: 0 });
    expect(canvas.getNode(secondId)?.position).toEqual({ x: 640, y: 360 });
    expect(canvas.getNode(secondId)?.collapsed).toBe(true);

    const snapshot = canvas.saveSnapshot('sdk-baseline');
    expect(snapshot?.name).toBe('sdk-baseline');

    canvas.updateNode(secondId, { data: { title: 'Second note updated', content: 'Gamma' } });
    const diff = canvas.diffSnapshot(snapshot?.id ?? '');
    expect(diff.ok).toBe(true);
    expect(diff.text).toContain('Second note');

    const restored = await canvas.restoreSnapshot(snapshot?.id ?? '');
    expect(restored.ok).toBe(true);
    expect(canvas.getNode(secondId)?.data.title).toBe('Second note');

    expect(canvas.ungroupNodes(groupId)).toBe(true);
    expect((canvas.getNode(groupId)?.data.children as string[]) ?? []).toEqual([]);
  });
});
