import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { canvasState } from '../../src/server/canvas-state.ts';
import { seedDemoCanvas } from '../../src/server/demo.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

describe('demo canvas seed', () => {
  let workspaceRoot = '';

  beforeEach(() => {
    workspaceRoot = createTestWorkspace('pmx-canvas-demo-');
    resetCanvasForTests(workspaceRoot);
  });

  afterEach(() => {
    removeTestWorkspace(workspaceRoot);
  });

  test('seeds the saved dashboard with stable grouped layout', () => {
    const result = seedDemoCanvas();
    const layout = canvasState.getLayout();
    const types = new Set(layout.nodes.map((node) => node.type));

    expect(result).toEqual({ nodes: 19, edges: 6, groups: 3 });
    expect(types).toEqual(new Set([
      'markdown',
      'graph',
      'group',
    ]));
    expect(layout.edges).toHaveLength(6);
    expect(Array.from(canvasState.contextPinnedNodeIds)).toEqual([
      'node-mo0xsd9m-5dkm',
      'graph-mo0xsd9s-sm0g',
    ]);

    const title = layout.nodes.find((node) => node.id === 'node-mo0xsd9l-jobh');
    expect(title?.data.title).toContain('Tech Enabling OKRs');
    expect(title?.data.arrangeLocked).toBe(true);

    const graph = layout.nodes.find((node) => node.id === 'graph-mo0xsd9q-lssn');
    expect(graph?.type).toBe('graph');
    expect(graph?.data.graphConfig).toMatchObject({ graphType: 'bar' });

    expect(layout.nodes.some((node) => node.data.viewerType === 'web-artifact')).toBe(false);
    expect(layout.nodes.some((node) => node.data.kind === 'web-artifact')).toBe(false);

    const groupNodes = layout.nodes.filter((node) => node.type === 'group');
    expect(groupNodes).toHaveLength(3);
    expect(layout.nodes.some((node) => node.type === 'prompt')).toBe(false);
    expect(layout.nodes.some((node) => node.type === 'response')).toBe(false);

    for (const group of groupNodes) {
      const children = group.data.children;
      expect(Array.isArray(children), `${group.id} stores children`).toBe(true);
      for (const childId of children as string[]) {
        const child = layout.nodes.find((node) => node.id === childId);
        expect(child, `${group.id} has missing child ${childId}`).toBeDefined();
        expect(child?.data.parentGroup).toBe(group.id);
        expect(child!.position.x).toBeGreaterThanOrEqual(group.position.x + 40);
        expect(child!.position.y).toBeGreaterThanOrEqual(group.position.y + 40);
        expect(child!.position.x + child!.size.width).toBeLessThanOrEqual(group.position.x + group.size.width);
        expect(child!.position.y + child!.size.height).toBeLessThanOrEqual(group.position.y + group.size.height);
      }
    }

    const nodesById = new Map(layout.nodes.map((node) => [node.id, node]));
    for (const edge of layout.edges) {
      const from = nodesById.get(edge.from);
      const to = nodesById.get(edge.to);
      expect(from, `${edge.id} has missing source ${edge.from}`).toBeDefined();
      expect(to, `${edge.id} has missing target ${edge.to}`).toBeDefined();
      const fromCenterX = from!.position.x + from!.size.width / 2;
      const fromCenterY = from!.position.y + from!.size.height / 2;
      const toCenterX = to!.position.x + to!.size.width / 2;
      const toCenterY = to!.position.y + to!.size.height / 2;
      const distance = Math.hypot(fromCenterX - toCenterX, fromCenterY - toCenterY);
      expect(distance, `${edge.id} is too long for the demo layout`).toBeLessThan(2200);
    }

    const visibleNodes = layout.nodes.filter((node) => node.type !== 'group');
    for (let i = 0; i < visibleNodes.length; i += 1) {
      for (let j = i + 1; j < visibleNodes.length; j += 1) {
        const a = visibleNodes[i];
        const b = visibleNodes[j];
        const separated =
          a.position.x + a.size.width <= b.position.x ||
          b.position.x + b.size.width <= a.position.x ||
          a.position.y + a.size.height <= b.position.y ||
          b.position.y + b.size.height <= a.position.y;
        expect(separated, `${a.id} overlaps ${b.id}`).toBe(true);
      }
    }
  });
});
