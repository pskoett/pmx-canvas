import { describe, expect, test } from 'bun:test';
import {
  findBlocker,
  findOpenCanvasPosition,
  overlapsAny,
  rectsOverlap,
  type CanvasPlacementRect,
} from '../../src/shared/placement.ts';

function rect(x: number, y: number, width: number, height: number): CanvasPlacementRect {
  return {
    position: { x, y },
    size: { width, height },
  };
}

describe('shared placement helpers', () => {
  test('rectsOverlap respects geometry and gap', () => {
    const blocker = rect(200, 100, 120, 80);

    expect(rectsOverlap({ x: 80, y: 100 }, 80, 80, blocker, 24)).toBe(false);
    expect(rectsOverlap({ x: 97, y: 100 }, 80, 80, blocker, 24)).toBe(true);
    expect(rectsOverlap({ x: 200, y: 205 }, 120, 80, blocker, 24)).toBe(false);
    expect(rectsOverlap({ x: 200, y: 179 }, 120, 80, blocker, 24)).toBe(true);
  });

  test('overlapsAny and findBlocker return the first conflicting rect', () => {
    const existing = [
      rect(40, 80, 160, 120),
      rect(280, 80, 200, 120),
    ];

    expect(overlapsAny({ x: 520, y: 80 }, 120, 120, existing, 24)).toBe(false);
    expect(overlapsAny({ x: 190, y: 80 }, 120, 120, existing, 24)).toBe(true);
    expect(findBlocker({ x: 190, y: 80 }, 120, 120, existing, 24)).toEqual(existing[0]);
    expect(findBlocker({ x: 520, y: 80 }, 120, 120, existing, 24)).toBeUndefined();
  });

  test('findOpenCanvasPosition uses the default origin for an empty layout', () => {
    expect(findOpenCanvasPosition([], 360, 200)).toEqual({ x: 40, y: 80 });
  });

  test('findOpenCanvasPosition places a node to the right of the most recent rect when open', () => {
    const existing = [
      rect(40, 80, 180, 120),
      rect(260, 80, 220, 120),
    ];

    expect(findOpenCanvasPosition(existing, 160, 120, 24)).toEqual({ x: 504, y: 80 });
  });

  test('findOpenCanvasPosition scans rows when the immediate right-side slot is blocked', () => {
    const existing = [
      rect(40, 80, 180, 120),
      rect(244, 80, 180, 120),
      rect(448, 80, 180, 120),
      rect(40, 224, 180, 120),
    ];

    expect(findOpenCanvasPosition(existing, 180, 120, 24)).toEqual({ x: 244, y: 224 });
  });

  test('findOpenCanvasPosition falls back below the tallest node after exhausting the row scan', () => {
    const existing: CanvasPlacementRect[] = [];
    for (let row = 0; row < 20; row++) {
      existing.push(rect(40, 80 + row * 144, 2950, 120));
    }
    existing.push(rect(40, 80 + 19 * 144, 200, 120));

    expect(findOpenCanvasPosition(existing, 200, 120, 24)).toEqual({ x: 40, y: 2960 });
  });
});
