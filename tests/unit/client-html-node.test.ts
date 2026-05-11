import { describe, expect, test } from 'bun:test';
import {
  createHtmlNodeSrcDocForTest,
  shouldShowPresentationControls,
} from '../../src/client/nodes/HtmlNode.tsx';
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

describe('HtmlNode iframe srcdoc theming', () => {
  test('injects a live theme bridge into full html documents', () => {
    const srcDoc = createHtmlNodeSrcDocForTest('<!doctype html><html><head><title>x</title></head><body>Hi</body></html>', {
      theme: 'light',
      themeCss: ':root { --color-bg: #fff; }',
      themeToken: 'theme-token',
    });

    expect(srcDoc).toContain('data-pmx-canvas-theme="light"');
    expect(srcDoc).toContain('data-pmx-canvas-theme-bridge');
    expect(srcDoc).toContain('theme-update');
    expect(srcDoc).toContain('theme-token');
    expect(srcDoc).toContain(':root { --color-bg: #fff; }');
  });

  test('marks present-mode srcdoc and keeps review-mode srcdoc unmarked', () => {
    const review = createHtmlNodeSrcDocForTest('<!doctype html><html><head></head><body>Deck</body></html>', {
      theme: 'dark',
      themeCss: ':root {}',
      presentation: false,
    });
    const present = createHtmlNodeSrcDocForTest('<!doctype html><html><head></head><body>Deck</body></html>', {
      theme: 'dark',
      themeCss: ':root {}',
      presentation: true,
      presentationExitToken: 'exit-token',
    });

    expect(review).not.toContain('data-pmx-presentation-mode="present"');
    expect(present).toContain('data-pmx-presentation-mode="present"');
    expect(present).toContain('exit-token');
  });
});
