import { describe, expect, test } from 'bun:test';
import { DEFAULT_POSITIONS, makeNodeState } from '../../src/client/state/node-factory.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';

// Regression pin: these are the exact frame defaults the SSE bridge shipped
// before the factory extraction (plan-009 H5, client half). Changing a value
// here moves/resizes newly created nodes — do so deliberately, never as a
// refactor side effect.
const EXPECTED_FRAMES: Record<CanvasNodeState['type'], { x: number; y: number; w: number; h: number }> = {
  status: { x: 40, y: 80, w: 300, h: 120 },
  markdown: { x: 380, y: 80, w: 720, h: 600 },
  context: { x: 1130, y: 80, w: 320, h: 400 },
  'mcp-app': { x: 380, y: 720, w: 960, h: 600 },
  webpage: { x: 380, y: 80, w: 520, h: 420 },
  'json-render': { x: 380, y: 720, w: 840, h: 620 },
  graph: { x: 380, y: 720, w: 760, h: 520 },
  ledger: { x: 1130, y: 520, w: 320, h: 280 },
  trace: { x: 40, y: 900, w: 200, h: 56 },
  file: { x: 380, y: 80, w: 720, h: 600 },
  diff: { x: 380, y: 80, w: 640, h: 420 },
  mermaid: { x: 380, y: 80, w: 640, h: 460 },
  image: { x: 380, y: 80, w: 720, h: 520 },
  html: { x: 380, y: 80, w: 720, h: 640 },
  group: { x: 220, y: 60, w: 840, h: 560 },
  prompt: { x: 380, y: 1260, w: 520, h: 400 },
  response: { x: 380, y: 1480, w: 720, h: 400 },
};

const ALL_TYPES = Object.keys(EXPECTED_FRAMES) as Array<CanvasNodeState['type']>;

describe('node-factory defaults', () => {
  test('table matches the pre-extraction sse-bridge defaults exactly', () => {
    expect(DEFAULT_POSITIONS).toEqual(EXPECTED_FRAMES);
  });

  test('makeNodeState fills frame defaults from the table for every type', () => {
    for (const type of ALL_TYPES) {
      const expected = EXPECTED_FRAMES[type];
      const node = makeNodeState(`n-${type}`, type, {});
      expect(node.id).toBe(`n-${type}`);
      expect(node.type).toBe(type);
      expect(node.position).toEqual({ x: expected.x, y: expected.y });
      expect(node.size).toEqual({ width: expected.w, height: expected.h });
      expect(node.zIndex).toBe(type === 'status' ? 0 : 1);
      expect(node.collapsed).toBe(false);
      expect(node.pinned).toBe(false);
    }
  });

  test('explicit position and size win over defaults', () => {
    const node = makeNodeState(
      'n-custom',
      'markdown',
      { title: 'T' },
      {
        position: { x: 7, y: 9 },
        size: { width: 111, height: 222 },
      },
    );
    expect(node.position).toEqual({ x: 7, y: 9 });
    expect(node.size).toEqual({ width: 111, height: 222 });
  });

  test('data is passed through by reference, not cloned', () => {
    const data = { phase: 'idle' };
    const node = makeNodeState('n-data', 'status', data);
    expect(node.data).toBe(data);
  });
});
