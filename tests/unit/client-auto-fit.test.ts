import { describe, expect, test } from 'bun:test';
import {
  AUTO_FIT_BODY_PADDING,
  AUTO_FIT_MAX_HEIGHT_IFRAME,
  AUTO_FIT_TITLEBAR_HEIGHT,
  computeAutoFitHeight,
  computeContentGrowHeight,
  shouldAutoFitNode,
  shouldContentFitIframeNode,
} from '../../src/client/canvas/auto-fit.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';

function makeNode(overrides: Partial<CanvasNodeState> & Pick<CanvasNodeState, 'type'>): CanvasNodeState {
  return {
    id: 'auto-fit-test',
    type: overrides.type,
    position: overrides.position ?? { x: 0, y: 0 },
    size: overrides.size ?? { width: 760, height: 520 },
    zIndex: overrides.zIndex ?? 1,
    collapsed: overrides.collapsed ?? false,
    pinned: overrides.pinned ?? false,
    dockPosition: overrides.dockPosition ?? null,
    data: overrides.data ?? {},
  };
}

describe('client auto-fit helpers', () => {
  test('does not shrink structured graph and json-render frames', () => {
    const graph = makeNode({ type: 'graph', size: { width: 480, height: 380 } });
    const jsonRender = makeNode({ type: 'json-render', size: { width: 900, height: 420 } });

    expect(shouldAutoFitNode(graph)).toBe(false);
    expect(shouldAutoFitNode(jsonRender)).toBe(false);
    expect(computeAutoFitHeight(graph, 120)).toBeNull();
    expect(computeAutoFitHeight(jsonRender, 160)).toBeNull();
  });

  test('still caps regular content auto-fit at 600px', () => {
    const markdown = makeNode({ type: 'markdown', size: { width: 360, height: 200 } });

    expect(computeAutoFitHeight(markdown, 900)).toBe(600);
  });

  test('does not auto-fit strict-size content nodes', () => {
    const markdown = makeNode({ type: 'markdown', size: { width: 360, height: 160 }, data: { strictSize: true } });

    expect(shouldAutoFitNode(markdown)).toBe(false);
    expect(computeAutoFitHeight(markdown, 900)).toBeNull();
  });

  test('does not shrink presentation html frames', () => {
    const presentation = makeNode({ type: 'html', size: { width: 1120, height: 700 }, data: { presentation: true } });

    expect(shouldAutoFitNode(presentation)).toBe(false);
    expect(computeAutoFitHeight(presentation, 900)).toBeNull();
  });

  test('iframe nodes are excluded from the DOM auto-fit (handled by the content-height bridge)', () => {
    for (const type of ['html', 'json-render', 'graph', 'mcp-app', 'webpage'] as const) {
      expect(shouldAutoFitNode(makeNode({ type }))).toBe(false);
    }
  });
});

describe('iframe content-fit (grow-only)', () => {
  test('authored surfaces are content-fit eligible; scrolling/unbounded ones are not', () => {
    expect(shouldContentFitIframeNode(makeNode({ type: 'html', size: { width: 400, height: 300 } }))).toBe(true);
    expect(shouldContentFitIframeNode(makeNode({ type: 'json-render', size: { width: 400, height: 300 } }))).toBe(true);
    expect(shouldContentFitIframeNode(makeNode({ type: 'graph', size: { width: 400, height: 300 } }))).toBe(true);
    expect(shouldContentFitIframeNode(makeNode({ type: 'mcp-app', data: { viewerType: 'web-artifact' } }))).toBe(true);

    // Unbounded / scrolling / non-surface — must NOT drive node height.
    expect(shouldContentFitIframeNode(makeNode({ type: 'html', data: { presentation: true } }))).toBe(false);
    expect(shouldContentFitIframeNode(makeNode({ type: 'mcp-app', data: { mode: 'ext-app' } }))).toBe(false);
    expect(shouldContentFitIframeNode(makeNode({ type: 'mcp-app', data: { url: 'https://x.test' } }))).toBe(false);
    expect(shouldContentFitIframeNode(makeNode({ type: 'webpage' }))).toBe(false);
    expect(shouldContentFitIframeNode(makeNode({ type: 'markdown' }))).toBe(false);
  });

  test('exempt: strictSize, user-resized, docked, collapsed', () => {
    expect(shouldContentFitIframeNode(makeNode({ type: 'graph', data: { strictSize: true } }))).toBe(false);
    expect(shouldContentFitIframeNode(makeNode({ type: 'graph', data: { userResized: true } }))).toBe(false);
    expect(shouldContentFitIframeNode(makeNode({ type: 'graph', dockPosition: 'right' }))).toBe(false);
    expect(shouldContentFitIframeNode(makeNode({ type: 'graph', collapsed: true }))).toBe(false);
  });

  test('grows to fit when content is taller, accounting for titlebar + body padding (the #48 fix)', () => {
    const graph = makeNode({ type: 'graph', size: { width: 420, height: 300 } });
    // +titlebar +body-padding so the content fully clears (no residual inner scrollbar).
    expect(computeContentGrowHeight(graph, 360)).toBe(360 + AUTO_FIT_TITLEBAR_HEIGHT + AUTO_FIT_BODY_PADDING);
  });

  test('grow-only: never shrinks when content already fits', () => {
    const graph = makeNode({ type: 'graph', size: { width: 420, height: 520 } });
    expect(computeContentGrowHeight(graph, 200)).toBeNull(); // content shorter → no shrink
    expect(computeContentGrowHeight(graph, 440)).toBeNull(); // 440+37+24 ≈ 501 ≤ 520 → already fits
  });

  test('caps growth at the iframe ceiling', () => {
    const graph = makeNode({ type: 'graph', size: { width: 420, height: 300 } });
    expect(computeContentGrowHeight(graph, 5000)).toBe(AUTO_FIT_MAX_HEIGHT_IFRAME);
  });

  test('returns null for exempt / ineligible nodes', () => {
    expect(computeContentGrowHeight(makeNode({ type: 'graph', data: { strictSize: true } }), 900)).toBeNull();
    expect(computeContentGrowHeight(makeNode({ type: 'webpage', size: { width: 400, height: 300 } }), 900)).toBeNull();
  });
});
