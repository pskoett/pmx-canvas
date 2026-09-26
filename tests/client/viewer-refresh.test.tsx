import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { RefreshingViewerFrame } from '../../src/client/nodes/McpAppNode.tsx';
import { iframeMode } from '../../src/client/state/iframe-mode.ts';

const frameRef: { current: HTMLIFrameElement | null } = { current: null };
const originalAnimationFrame = globalThis.requestAnimationFrame;

beforeEach(() => {
  iframeMode.value = 'src';
  frameRef.current = null;
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  }) as typeof requestAnimationFrame;
});

afterEach(() => {
  cleanup();
  iframeMode.value = null;
  globalThis.requestAnimationFrame = originalAnimationFrame;
});

describe('iframe-backed viewer refresh', () => {
  test('loads the first document directly when srcdoc arrives asynchronously', () => {
    const viewer = (srcdoc: string) => (
      <RefreshingViewerFrame source={{ srcdoc }} iframeRef={frameRef} onLoad={() => {}} title="viewer" />
    );
    const view = render(viewer(''));
    view.rerender(viewer('<p>First document</p>'));
    const frames = view.container.querySelectorAll('iframe');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.getAttribute('srcdoc')).toBe('<p>First document</p>');
    expect(frames[0]?.style.visibility).toBe('visible');
    expect(frameRef.current).toBe(frames[0]);
  });

  test('promotes asynchronously with a live frame ref and cancels an obsolete replacement', () => {
    const callbacks: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = (callback) => callbacks.push(callback);
    const flush = () =>
      act(() => {
        while (callbacks.length) callbacks.shift()!(0);
      });
    const loadedRef: { current: HTMLIFrameElement | null } = { current: null };
    const viewer = (version: number) => (
      <RefreshingViewerFrame
        source={{ src: `/viewer?v=${version}` }}
        iframeRef={frameRef}
        onLoad={() => {
          loadedRef.current = frameRef.current;
        }}
        title="viewer"
      />
    );
    const view = render(viewer(1));
    view.rerender(viewer(2));
    const pending = view.container.querySelectorAll('iframe')[1]!;
    fireEvent.load(pending);
    expect(view.container.querySelectorAll('iframe')).toHaveLength(2);
    flush();
    expect(loadedRef.current).toBe(pending);
    expect(frameRef.current).toBe(pending);

    view.rerender(viewer(3));
    fireEvent.load(view.container.querySelectorAll('iframe')[1]!);
    view.rerender(viewer(2));
    flush();
    expect(view.container.querySelectorAll('iframe')).toHaveLength(1);
    expect(view.container.querySelector('iframe')).toBe(pending);
  });

  test('retains the painted frame until the replacement has loaded', () => {
    const view = render(
      <RefreshingViewerFrame
        source={{ src: '/viewer?v=1&theme=dark' }}
        iframeRef={frameRef}
        onLoad={() => {}}
        title="viewer"
      />,
    );
    const first = view.container.querySelector('iframe');
    expect(first?.getAttribute('src')).toContain('v=1');
    expect(first?.style.visibility).toBe('visible');

    view.rerender(
      <RefreshingViewerFrame
        source={{ src: '/viewer?v=2&theme=dark' }}
        iframeRef={frameRef}
        onLoad={() => {}}
        title="viewer"
      />,
    );
    const loading = Array.from(view.container.querySelectorAll('iframe'));
    expect(loading).toHaveLength(2);
    expect(loading[0]?.getAttribute('src')).toContain('v=1');
    expect(loading[0]?.style.visibility).toBe('visible');
    expect(loading[1]?.getAttribute('src')).toContain('v=2');
    expect(loading[1]?.style.visibility).toBe('hidden');

    fireEvent.load(loading[1]!);
    const painted = Array.from(view.container.querySelectorAll('iframe'));
    expect(painted).toHaveLength(1);
    expect(painted[0]?.getAttribute('src')).toContain('v=2');
    expect(painted[0]?.style.visibility).toBe('visible');
    expect(frameRef.current).toBe(painted[0]);
  });

  test('preserves the theme in repeated replacement URLs', () => {
    const view = render(
      <RefreshingViewerFrame
        source={{ src: '/viewer?v=1&theme=light' }}
        iframeRef={frameRef}
        onLoad={() => {}}
        title="viewer"
      />,
    );
    for (let version = 2; version <= 4; version += 1) {
      view.rerender(
        <RefreshingViewerFrame
          source={{ src: `/viewer?v=${version}&theme=light` }}
          iframeRef={frameRef}
          onLoad={() => {}}
          title="viewer"
        />,
      );
      const frames = view.container.querySelectorAll('iframe');
      expect(frames).toHaveLength(2);
      fireEvent.load(frames[1]!);
      expect(view.container.querySelector('iframe')?.getAttribute('src')).toContain(`v=${version}&theme=light`);
    }
  });
});
