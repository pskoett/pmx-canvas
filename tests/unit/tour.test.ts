import { describe, expect, test } from 'bun:test';
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
import { createTestWorkspace, resetCanvasForTests, removeTestWorkspace, getAvailablePort } from './helpers.js';

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
      expect(JSON.parse(content.find((c) => c.type === 'text')!.text!)).toEqual({ tour, derived: false });
      await client.callTool({ name: 'canvas_history', arguments: { action: 'undo' } });
      const undone = await client.callTool({ name: 'canvas_view', arguments: { action: 'get-tour' } });
      const undoneContent = undone.content as Array<{ type: string; text?: string }>;
      expect(JSON.parse(undoneContent.find((c) => c.type === 'text')!.text!)).toEqual({
        tour: { stops: [] },
        derived: true,
      });
      await client.callTool({ name: 'canvas_history', arguments: { action: 'redo' } });
      const redone = await client.callTool({ name: 'canvas_view', arguments: { action: 'get-tour' } });
      const redoneContent = redone.content as Array<{ type: string; text?: string }>;
      expect(JSON.parse(redoneContent.find((c) => c.type === 'text')!.text!)).toEqual({ tour, derived: false });
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
      const snapshot = canvasState.saveSnapshot('tour');
      expect(snapshot).not.toBeNull();
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
