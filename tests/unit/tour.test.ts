import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import {
  derivedTour,
  interpolateCamera,
  resolveStop,
  segmentFrameCount,
  tourFrames,
  tourSchema,
} from '../../src/shared/tour.js';
import { parseRecordOptions } from '../../src/cli/commands/record.js';
import { canvasState } from '../../src/server/canvas-state.js';
import { saveCanvasSnapshotWithReuse, setClientViewportSize } from '../../src/server/canvas-operations.js';
import { agentPresence } from '../../src/server/agent-presence.js';
import { executeOperation, setOperationEventEmitter } from '../../src/server/operations/registry.js';
import { exitTour } from '../../src/server/tour-control.js';
import {
  createTestWorkspace,
  getAvailablePort,
  makeNode,
  removeTestWorkspace,
  resetCanvasForTests,
} from './helpers.js';

describe('board tour', () => {
  test('MCP canvas_view persists and reads tours through the registered operations', async () => {
    const root = createTestWorkspace('tour-mcp-');
    const transport = new StdioClientTransport({
      command: 'bun',
      args: ['run', fileURLToPath(new URL('../../src/mcp/server.ts', import.meta.url))],
      cwd: root,
      env: { ...process.env, PMX_CANVAS_PORT: String(await getAvailablePort()), PMX_CANVAS_DISABLE_BROWSER_OPEN: '1' },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'tour-test', version: '1' }, { capabilities: {} });
    try {
      await client.connect(transport);
      const tour = { stops: [{ target: { viewport: { x: 13, y: -70, scale: 0.2 } }, duration: 0 }] };
      const saved = await client.callTool({ name: 'canvas_view', arguments: { action: 'set-tour', tour } });
      expect(saved.isError).not.toBe(true);
      const result = await client.callTool({ name: 'canvas_view', arguments: { action: 'get-tour' } });
      const content = result.content as Array<{ type: string; text?: string }>;
      expect(JSON.parse(content.find((c) => c.type === 'text')!.text!)).toEqual({
        tour,
        derived: false,
        position: null,
      });
      await client.callTool({ name: 'canvas_history', arguments: { action: 'undo' } });
      const undone = await client.callTool({ name: 'canvas_view', arguments: { action: 'get-tour' } });
      const undoneContent = undone.content as Array<{ type: string; text?: string }>;
      expect(JSON.parse(undoneContent.find((c) => c.type === 'text')!.text!)).toEqual({
        tour: { stops: [] },
        derived: true,
        position: null,
      });
      await client.callTool({ name: 'canvas_history', arguments: { action: 'redo' } });
      const redone = await client.callTool({ name: 'canvas_view', arguments: { action: 'get-tour' } });
      const redoneContent = redone.content as Array<{ type: string; text?: string }>;
      expect(JSON.parse(redoneContent.find((c) => c.type === 'text')!.text!)).toEqual({
        tour,
        derived: false,
        position: null,
      });
      const text = (result: Awaited<ReturnType<Client['callTool']>>) =>
        JSON.parse((result.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')!.text!);
      const went = await client.callTool({ name: 'canvas_view', arguments: { action: 'tour-go', step: 'next' } });
      expect(text(went)).toMatchObject({ ok: true, index: 0, total: 1 });
      const moved = await client.callTool({
        name: 'canvas_view',
        arguments: { action: 'move', viewport: { x: 5, y: 6, scale: 0.5 }, duration: 0 },
      });
      expect(text(moved).viewport).toEqual({ x: 5, y: 6, scale: 0.5 });
      expect((await client.callTool({ name: 'canvas_view', arguments: { action: 'tour-exit' } })).isError).not.toBe(
        true,
      );
    } finally {
      await client.close();
      await transport.close();
      removeTestWorkspace(root);
    }
  });

  test('validates targets and duration, and rejects nonfinite and nonpositive scales', () => {
    for (const target of [{}, { viewport: { x: 0, y: 0, scale: 0 } }, { viewport: { x: Infinity, y: 0, scale: 1 } }]) {
      expect(tourSchema.safeParse({ stops: [{ target }] }).success).toBe(false);
    }
    expect(tourSchema.safeParse({ stops: [{ target: { nodeId: 'a' }, duration: -1 }] }).success).toBe(false);
    expect(tourSchema.parse({ stops: [{ target: { nodeId: 'group' }, duration: 0 }] }).stops).toHaveLength(1);
  });

  test('fits an asymmetric, distant node using screen-space padding', () => {
    const node = { id: 'a', type: 'group', position: { x: 2000, y: -700 }, size: { width: 800, height: 200 } };
    const camera = resolveStop({ target: { nodeId: 'a' }, padding: 60 }, [node], 1000, 700);
    expect(camera.scale).toBe(1.1);
    expect(node.position.x * camera.scale + camera.x).toBeCloseTo(60);
    expect((node.position.y + 100) * camera.scale + camera.y).toBeCloseTo(350);
    expect(() => resolveStop({ target: { nodeId: 'missing' } }, [node], 1000, 700)).toThrow('not found');
  });

  test('interpolates geometric zoom and world centres, with optional mid-move pullback', () => {
    const from = { x: 20, y: -100, scale: 1 };
    const to = { x: -800, y: 300, scale: 4 };
    const middle = interpolateCamera(from, to, 0.5, 1000, 600, 'linear');
    expect(middle.scale).toBe(2);
    expect(middle.x).toBe(-305);
    expect(middle.y).toBe(-100);
    expect(interpolateCamera(from, to, 0.5, 1000, 600, 'linear', Math.log(2)).scale).toBeCloseTo(1);
    expect(interpolateCamera(from, to, 1, 1000, 600, 'ease-out', 2)).toEqual(to);
    expect(interpolateCamera(from, to, 0, 1000, 600, 'ease-out', 2)).toEqual(from);
  });

  test('derives groups only in y/x order and emits exact frame counts/endpoints', () => {
    const nodes = [
      { id: 'b', type: 'group', position: { x: 800, y: 10 }, size: { width: 100, height: 100 } },
      { id: 'c', type: 'markdown', position: { x: 0, y: 0 }, size: { width: 100, height: 100 } },
      { id: 'a', type: 'group', position: { x: -30, y: 10 }, size: { width: 100, height: 100 } },
    ];
    expect(derivedTour(nodes).stops.map((s) => s.target)).toEqual([{ nodeId: 'a' }, { nodeId: 'b' }]);
    expect(segmentFrameCount(0.11, 30)).toBe(4);
    const target = { x: 90, y: -20, scale: 3 };
    const tour = tourSchema.parse({
      stops: [
        { target: { viewport: target }, duration: 0.11 },
        { target: { viewport: target }, duration: 0 },
      ],
    });
    const frames = [...tourFrames(tour, { x: 0, y: 0, scale: 1 }, [], 800, 600, 30)];
    expect(frames).toHaveLength(5);
    expect(frames[3]).toEqual(target);
    expect(frames[4]).toEqual(target);
  });

  test('persists, snapshots, clears and restores a board tour', () => {
    const root = createTestWorkspace('tour-');
    resetCanvasForTests(root);
    try {
      const tour = tourSchema.parse({ stops: [{ target: { viewport: { x: 37, y: -19, scale: 0.4 } }, duration: 2 }] });
      canvasState.setTour(tour);
      canvasState.flushToDisk();
      expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);
      expect(canvasState.getTour()).toEqual(tour);
      const snapshot = saveCanvasSnapshotWithReuse('tour').snapshot;
      expect(snapshot).not.toBeNull();
      expect(saveCanvasSnapshotWithReuse('unchanged').reused).toBe(true);
      canvasState.setTour({ stops: [] });
      const changed = saveCanvasSnapshotWithReuse('changed tour');
      expect(changed.reused).toBe(false);
      expect(changed.snapshot?.id).not.toBe(snapshot!.id);
      canvasState.clear();
      expect(canvasState.getTour()).toBeUndefined();
      expect(canvasState.restoreSnapshot(snapshot!.id)).toBe(true);
      expect(canvasState.getTour()).toEqual(tour);
      canvasState.setTour(null);
      canvasState.flushToDisk();
      canvasState.loadFromDisk({ clearExisting: true });
      expect(canvasState.getTour()).toBeUndefined();
    } finally {
      removeTestWorkspace(root);
    }
  });

  test('record options require an explicit stopping rule and valid geometry/fps', () => {
    expect(() => parseRecordOptions({ output: 'a.mp4' })).toThrow('duration');
    expect(() => parseRecordOptions({ output: 'a', duration: '1', fps: '0' })).toThrow();
    expect(() => parseRecordOptions({ output: 'a', duration: '1', resolution: '1920' })).toThrow('resolution');
    expect(() => parseRecordOptions({ output: 'a', duration: '1', mode: 'deterministic' })).toThrow('duration');
    expect(parseRecordOptions({ output: 'a', mode: 'deterministic', resolution: '1920x1080', fps: '24' }).fps).toBe(24);
    expect(parseRecordOptions({ output: 'a', 'stop-on-signal': true }).duration).toBeUndefined();
    expect(parseRecordOptions({ output: 'a', mode: 'deterministic', 'tour-file': 'tour.json' }).tourFile).toBe(
      'tour.json',
    );
    expect(() => parseRecordOptions({ output: 'a', duration: '1', 'tour-file': 'tour.json' })).toThrow('--tour-file');
  });
});

describe('driving a tour', () => {
  const emitted: Array<{ event: string; payload: Record<string, unknown> }> = [];
  let root = '';
  beforeEach(() => {
    root = createTestWorkspace('tour-drive-');
    resetCanvasForTests(root);
    exitTour();
    agentPresence.reset();
    emitted.length = 0;
    setOperationEventEmitter((event, payload) => emitted.push({ event, payload }));
  });
  afterEach(() => {
    setOperationEventEmitter(null);
    removeTestWorkspace(root);
  });

  const addGroups = () => {
    canvasState.addNode(makeNode({ id: 'late', type: 'group', position: { x: 900, y: 600 } }));
    canvasState.addNode(makeNode({ id: 'early', type: 'group', position: { x: 0, y: 0 } }));
  };

  test('frames a world rect with screen-space padding', () => {
    const camera = resolveStop(
      { target: { rect: { x: 100, y: -50, width: 400, height: 200 } }, padding: 50 },
      [],
      1000,
      600,
    );
    expect(camera.scale).toBe(2.25);
    expect(100 * camera.scale + camera.x).toBeCloseTo(50);
    expect((-50 + 100) * camera.scale + camera.y).toBeCloseTo(300);
    expect(tourSchema.safeParse({ stops: [{ target: { rect: { x: 0, y: 0, width: 0, height: 1 } } }] }).success).toBe(
      false,
    );
  });

  test('next/previous walk the derived tour, clamp at the ends and broadcast each stop', async () => {
    addGroups();
    const go = (input: Record<string, unknown>) => executeOperation('tour.go', input) as Promise<{ index: number }>;
    expect((await go({ step: 'previous' })).index).toBe(0);
    expect((await go({ step: 'next' })).index).toBe(1);
    expect((await go({ step: 'next' })).index).toBe(1);
    expect((await go({ stop: 0, present: false })).index).toBe(0);
    expect(emitted.filter((e) => e.event === 'canvas-tour-step').map((e) => e.payload)).toEqual([
      { index: 0, total: 2, stop: { target: { nodeId: 'early' } }, present: true },
      { index: 1, total: 2, stop: { target: { nodeId: 'late' } }, present: true },
      { index: 1, total: 2, stop: { target: { nodeId: 'late' } }, present: true },
      { index: 0, total: 2, stop: { target: { nodeId: 'early' } }, present: false },
    ]);
    expect(((await executeOperation('tour.get', {})) as { position: number }).position).toBe(0);
    await executeOperation('tour.exit', {});
    expect(emitted.at(-1)?.event).toBe('canvas-tour-exit');
    expect(((await executeOperation('tour.get', {})) as { position: number | null }).position).toBeNull();
    await expect(go({ stop: 2 })).rejects.toThrow('does not exist');
    await expect(go({ stop: 0, step: 'next' })).rejects.toThrow('exactly one');
    canvasState.setTour({ stops: [] });
    await expect(go({ step: 'next' })).rejects.toThrow('no tour stops');
  });

  test('camera moves resolve a fallback viewport and never touch history or writer presence', async () => {
    addGroups();
    // No server is booted here, so attach the (single-slot) recorder ourselves:
    // anything a camera op tried to record would land in `recorded`.
    const recorded: string[] = [];
    canvasState.onMutation((info) => recorded.push(info.description));
    setClientViewportSize(1000, 600);
    const moved = (await executeOperation(
      'camera.move',
      { nodeId: 'late', duration: 2, pullback: 0.5, padding: 20 },
      { source: 'mcp' },
    )) as { viewport: { x: number; y: number; scale: number } };
    expect(moved.viewport.scale).toBeCloseTo(Math.min(960 / 360, 560 / 200));
    expect(canvasState.viewport).toEqual(moved.viewport);
    expect(emitted.find((e) => e.event === 'canvas-camera-move')?.payload.stop).toEqual({
      target: { nodeId: 'late' },
      duration: 2,
      pullback: 0.5,
      padding: 20,
    });
    await executeOperation(
      'camera.move',
      { rect: { x: 0, y: 0, width: 10, height: 10 }, duration: 0 },
      { source: 'mcp' },
    );
    await executeOperation('tour.go', { step: 'next' }, { source: 'mcp' });
    await executeOperation('tour.exit', {}, { source: 'mcp' });
    expect(recorded).toEqual([]);
    expect(agentPresence.snapshot().presences).toHaveLength(0);
    expect(emitted.some((e) => e.event === 'canvas-layout-update')).toBe(false);
    await expect(executeOperation('camera.move', { nodeId: 'missing' })).rejects.toThrow('not found');
    await expect(
      executeOperation('camera.move', { nodeId: 'late', viewport: { x: 0, y: 0, scale: 1 } }),
    ).rejects.toThrow('exactly one');
  });
});
