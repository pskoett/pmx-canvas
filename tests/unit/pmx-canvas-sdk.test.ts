import { afterEach, describe, expect, test } from 'bun:test';
import { createServer } from 'node:net';
import { createCanvas } from '../../src/server/index.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import { intentRegistry } from '../../src/server/intent-registry.ts';
import { stopCanvasServer } from '../../src/server/server.ts';
import {
  createTestWorkspace,
  removeTestWorkspace,
  resetCanvasForTests,
} from './helpers.ts';

describe('PmxCanvas SDK surface', () => {
  let workspaceRoot = '';

  afterEach(() => {
    intentRegistry.reset();
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

    const firstNode = canvas.addNode({
      type: 'markdown',
      title: 'First note',
      content: 'Alpha',
      x: 140,
      y: 220,
      width: 300,
      height: 180,
    });
    // addNode returns the created node (with .id), not a bare id string.
    expect(typeof firstNode.id).toBe('string');
    expect(firstNode.type).toBe('markdown');
    const firstId = firstNode.id;
    const secondId = canvas.addNode({
      type: 'markdown',
      title: 'Second note',
      content: 'Beta',
      x: 520,
      y: 220,
    }).id;

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

    const axFocus = canvas.setAxFocus([secondId, 'missing-node']);
    expect(axFocus.nodeIds).toEqual([secondId]);
    expect(canvas.getAxState().focus.primaryNodeId).toBe(secondId);
    expect(canvas.getAxContext().pinned.nodeIds).toEqual([firstId, secondId]);
    expect(canvas.getAxContext().focus.nodes[0]?.id).toBe(secondId);

    canvas.focusNode(firstId);
    expect(canvas.getAxState().focus.primaryNodeId).toBe(firstId);
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

  test('combines structured graph updates with metadata and rejects wrong node types', () => {
    workspaceRoot = createTestWorkspace('pmx-canvas-sdk-structured-');
    resetCanvasForTests(workspaceRoot);

    const canvas = createCanvas({ port: 4790 });
    const graph = canvas.addGraphNode({
      title: 'SDK graph',
      graphType: 'line',
      data: [{ label: 'A', value: 1 }],
      xKey: 'label',
      yKey: 'value',
    });

    canvas.updateNode(graph.id, {
      data: [{ label: 'B', value: 5 }],
      arrangeLocked: true,
    });

    const updatedGraph = canvas.getNode(graph.id);
    expect(updatedGraph?.data.arrangeLocked).toBe(true);
    expect((updatedGraph?.data.graphConfig as { data?: Array<Record<string, unknown>> } | undefined)?.data)
      .toEqual([{ label: 'B', value: 5 }]);

    const markdownId = canvas.addNode({ type: 'markdown', title: 'Plain note' }).id;
    expect(() => canvas.updateNode(markdownId, { spec: { root: 'card', elements: {} } }))
      .toThrow('Structured spec and graph updates can only be used');
  });

  test('start() honors the port by default but can fall back when it is taken', async () => {
    workspaceRoot = createTestWorkspace('pmx-canvas-sdk-fallback-');
    resetCanvasForTests(workspaceRoot);

    // Occupy the preferred port on the canvas server's host (stands in for a
    // daemon already running on it — e.g. one serving a different workspace).
    const preferred = 4799;
    const blocker = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(preferred, '127.0.0.1', () => resolve());
    });
    try {
      // Default: the explicit SDK port is honored exactly, so a taken port fails loud.
      const strict = createCanvas({ port: preferred });
      await expect(strict.start({ open: false })).rejects.toThrow(/Failed to start canvas server/);

      // allowPortFallback (used by the MCP auto-start): bind a nearby free port
      // instead of crashing with EADDRINUSE.
      const lenient = createCanvas({ port: preferred });
      await lenient.start({ open: false, allowPortFallback: true });
      expect(lenient.port).toBeGreaterThan(0);
      expect(lenient.port).not.toBe(preferred);
    } finally {
      stopCanvasServer();
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  test('node create/get responses include nodeId + surfaceUrl, mirroring HTTP/CLI', () => {
    workspaceRoot = createTestWorkspace('pmx-canvas-sdk-parity-');
    resetCanvasForTests(workspaceRoot);
    const canvas = createCanvas({ port: 4791 });

    // addNode: nodeId aliases id; a markdown node is not surface-eligible.
    const md = canvas.addNode({ type: 'markdown', title: 'Note', content: 'hi' });
    expect(md.nodeId).toBe(md.id);
    expect(md.surfaceUrl).toBeNull();

    // addHtmlNode now returns the node object (not a bare id string), with both
    // the nodeId alias and a surfaceUrl pointing at the standalone surface.
    const html = canvas.addHtmlNode({ html: '<h1>Hi</h1>', title: 'My HTML' });
    expect(typeof html).toBe('object');
    expect(html.id).toEqual(expect.any(String));
    expect(html.nodeId).toBe(html.id);
    expect(html.surfaceUrl).toBe(`/api/canvas/surface/${html.id}`);

    // getNode mirrors the same enriched shape and preserves node data.
    const got = canvas.getNode(html.id);
    expect(got?.nodeId).toBe(html.id);
    expect(got?.surfaceUrl).toBe(`/api/canvas/surface/${html.id}`);
    expect(got?.data.title).toBe('My HTML');

    // Parity holds for other surface-eligible types: getNode on a graph node
    // exposes a surfaceUrl + nodeId (documented parity for html/json-render/graph).
    const graph = canvas.addGraphNode({
      title: 'G', graphType: 'line', data: [{ label: 'a', value: 1 }], xKey: 'label', yKey: 'value',
    });
    const graphNode = canvas.getNode(graph.id);
    expect(graphNode?.nodeId).toBe(graph.id);
    expect(graphNode?.surfaceUrl).toBe(`/api/canvas/surface/${graph.id}`);

    expect(canvas.getNode('missing-node')).toBeUndefined();
  });

  test('linked SDK mutations settle only after a successful mutation', () => {
    workspaceRoot = createTestWorkspace('pmx-canvas-sdk-intent-');
    resetCanvasForTests(workspaceRoot);
    const canvas = createCanvas({ port: 4792 });

    intentRegistry.signal({
      id: 'sdk-create',
      kind: 'create',
      position: { x: 100, y: 120 },
    });
    const created = canvas.addNode({
      intentId: 'sdk-create',
      type: 'markdown',
      title: 'Intent-backed SDK node',
      x: 100,
      y: 120,
    });
    expect(canvas.getNode(created.id)?.data.title).toBe('Intent-backed SDK node');
    expect(intentRegistry.list().some((intent) => intent.id === 'sdk-create')).toBe(false);

    intentRegistry.signal({
      id: 'sdk-missing-edit',
      kind: 'edit',
      nodeId: 'missing-node',
    });
    expect(() => canvas.updateNode('missing-node', {
      intentId: 'sdk-missing-edit',
      title: 'Must not settle',
    })).toThrow('Node "missing-node" not found.');
    expect(intentRegistry.list().some((intent) => intent.id === 'sdk-missing-edit')).toBe(true);

    intentRegistry.signal({
      id: 'sdk-veto',
      kind: 'create',
      position: { x: 200, y: 220 },
    });
    expect(intentRegistry.clear('sdk-veto', { vetoed: true })).toBe(true);
    expect(() => canvas.addNode({
      intentId: 'sdk-veto',
      type: 'markdown',
      title: 'Must not exist',
    })).toThrow(/was vetoed/);
    expect(canvasState.getLayout().nodes.some((node) => node.data.title === 'Must not exist')).toBe(false);
  });
});
