import { describe, expect, test } from 'bun:test';
import { shouldShowPresentationControls } from '../../src/client/nodes/HtmlNode.tsx';
import type { CanvasNodeState } from '../../src/client/types.ts';

function makeHtmlNode(data: Record<string, unknown>): CanvasNodeState {
  return {
    id: 'html-test',
    type: 'html',
    position: { x: 0, y: 0 },
    size: { width: 720, height: 640 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data,
  };
}

describe('HtmlNode presentation controls', () => {
  test('only explicit presentation html nodes can present', () => {
    expect(shouldShowPresentationControls(makeHtmlNode({ html: '<main>Report</main>' }))).toBe(false);
    expect(shouldShowPresentationControls(makeHtmlNode({ html: '<main>Deck</main>', presentation: true }))).toBe(true);
  });
});
