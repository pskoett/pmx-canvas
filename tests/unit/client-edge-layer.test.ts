import { describe, expect, test } from 'bun:test';
import { edgeChromeScale } from '../../src/client/canvas/EdgeLayer.tsx';

describe('edgeChromeScale', () => {
  test('is a no-op at 1:1 and when zoomed in', () => {
    expect(edgeChromeScale(1)).toBe(1);
    expect(edgeChromeScale(2)).toBe(1);
    expect(edgeChromeScale(4.5)).toBe(1);
  });

  test('fully compensates the viewport scale when zoomed out', () => {
    expect(edgeChromeScale(0.25)).toBe(4);
    expect(edgeChromeScale(0.5)).toBe(2);
    // ~26% overview zoom: a 1.5 world-px stroke stays 1.5 screen px.
    expect(1.5 * edgeChromeScale(0.26) * 0.26).toBeCloseTo(1.5, 10);
  });

  test('is uncapped so hairlines survive extreme overview zoom', () => {
    expect(edgeChromeScale(0.05)).toBe(20);
  });

  test('falls back to 1 for non-finite or non-positive scales', () => {
    expect(edgeChromeScale(0)).toBe(1);
    expect(edgeChromeScale(-0.5)).toBe(1);
    expect(edgeChromeScale(Number.NaN)).toBe(1);
    expect(edgeChromeScale(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
