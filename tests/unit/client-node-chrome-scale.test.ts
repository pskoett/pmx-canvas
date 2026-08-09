import { describe, expect, test } from 'bun:test';
import { nodeChromeScale } from '../../src/client/canvas/CanvasNode.tsx';

// Zoomed-out node chrome grows so it stays legible, but it must never crowd out
// the content it labels: a 116px section label at 46% zoom used to give the
// title bar 72% of the node and clip the markdown away entirely.
describe('nodeChromeScale', () => {
  test('never enlarges chrome at 100% zoom or closer', () => {
    expect(nodeChromeScale(1, 400)).toBe(1);
    expect(nodeChromeScale(2, 400)).toBe(1);
  });

  test('tall nodes keep the full inverse compensation, capped at 2.2', () => {
    expect(nodeChromeScale(0.5, 600)).toBeCloseTo(2, 3);
    expect(nodeChromeScale(0.25, 600)).toBe(2.2);
  });

  test('short nodes bound the scale by their own height', () => {
    // 116px node: the bar may use 40% => 46.4px => 46.4/37 ≈ 1.254, well under
    // the 2.174 the zoom alone would have produced at 46%.
    expect(nodeChromeScale(0.46, 116)).toBeCloseTo(1.254, 2);
    expect(nodeChromeScale(0.46, 116)).toBeLessThan(1 / 0.46);
  });

  test('never shrinks chrome below its natural size', () => {
    expect(nodeChromeScale(0.3, 40)).toBe(1);
  });

  test('an unknown or auto height skips the bound', () => {
    expect(nodeChromeScale(0.5, 0)).toBeCloseTo(2, 3);
  });
});
