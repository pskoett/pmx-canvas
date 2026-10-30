import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { render as renderDom } from 'preact';
import {
  RefreshingViewerFrame,
  VIEWER_LOAD_DEADLINE_MS,
  waitForViewerPaint,
} from '../../src/client/nodes/ViewerFrame.tsx';
import { HTML_SURFACE_PUSH_SOURCE } from '../../src/shared/ax-surface-protocol.ts';
import { resetAttentionBridge } from '../../src/client/state/attention-bridge.ts';
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
  resetAttentionBridge();
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

  test('promotes asynchronously with a live frame ref and cancels an obsolete replacement', async () => {
    const callbacks: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = (callback) => callbacks.push(callback);
    const flush = () =>
      act(() => {
        while (callbacks.length) callbacks.shift()!(0);
      });
    const loadedRef: { current: HTMLIFrameElement | null } = { current: null };
    const initialized: HTMLIFrameElement[] = [];
    let committed!: () => void;
    let ready = new Promise<boolean>((resolve) => {
      committed = () => resolve(true);
    });
    const viewer = (version: number) => (
      <RefreshingViewerFrame
        source={{ src: `/viewer?v=${version}` }}
        iframeRef={frameRef}
        onDocumentLoad={(frame) => {
          initialized.push(frame);
          return ready;
        }}
        onLoad={() => {
          loadedRef.current = frameRef.current;
        }}
        title="viewer"
      />
    );
    const view = render(viewer(1));
    view.rerender(viewer(2));
    const first = view.container.querySelectorAll('iframe')[0]!;
    const pending = view.container.querySelectorAll('iframe')[1]!;
    fireEvent.load(pending);
    expect(initialized).toEqual([pending]);
    expect(loadedRef.current).toBeNull();
    expect(pending.hasAttribute('inert')).toBe(true);
    expect(pending.getAttribute('aria-hidden')).toBe('true');
    expect(Number(first.style.zIndex)).toBeGreaterThan(Number(pending.style.zIndex));
    expect(view.container.querySelectorAll('iframe')).toHaveLength(2);
    flush();
    expect(loadedRef.current).toBeNull();
    expect(frameRef.current).toBe(first);
    await act(async () => committed());
    act(() => callbacks.shift()!(0));
    expect(frameRef.current).toBe(first);
    expect(Number(first.style.zIndex)).toBeGreaterThan(Number(pending.style.zIndex));
    act(() => callbacks.shift()!(0));
    expect(loadedRef.current).toBe(pending);
    expect(frameRef.current).toBe(pending);
    expect(pending.hasAttribute('inert')).toBe(false);
    expect(pending.hasAttribute('aria-hidden')).toBe(false);

    ready = new Promise<boolean>((resolve) => {
      committed = () => resolve(true);
    });
    view.rerender(viewer(3));
    fireEvent.load(view.container.querySelectorAll('iframe')[1]!);
    view.rerender(viewer(2));
    await act(async () => committed());
    flush();
    expect(view.container.querySelectorAll('iframe')).toHaveLength(1);
    expect(view.container.querySelector('iframe')).toBe(pending);

    view.rerender(viewer(3));
    fireEvent.load(view.container.querySelectorAll('iframe')[1]!);
    await act(async () => committed());
    act(() => callbacks.shift()!(0));
    // Commit a newer source without flushing passive effects, between the
    // obsolete replacement's two parent frames.
    renderDom(viewer(4), view.container);
    callbacks.shift()!(0);
    expect(frameRef.current).toBe(pending);
    expect(loadedRef.current).toBe(pending);
  });

  test('retains the painted frame until the replacement has loaded', () => {
    const view = render(
      <RefreshingViewerFrame
        source={{ src: '/viewer?v=1&theme=harbor' }}
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
        source={{ src: '/viewer?v=2&theme=harbor' }}
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
    expect(loading[1]?.hasAttribute('inert')).toBe(true);
    expect(Number(loading[0]?.style.zIndex)).toBeGreaterThan(Number(loading[1]?.style.zIndex));

    fireEvent.load(loading[1]!);
    const painted = Array.from(view.container.querySelectorAll('iframe'));
    expect(painted).toHaveLength(1);
    expect(painted[0]?.getAttribute('src')).toContain('v=2');
    expect(painted[0]?.style.visibility).toBe('visible');
    expect(frameRef.current).toBe(painted[0]);
  });

  test('a failed readiness check retains painted content and offers explicit retry', async () => {
    let ready = false;
    const viewer = (version: number) => (
      <RefreshingViewerFrame
        source={{ src: `/viewer?v=${version}` }}
        iframeRef={frameRef}
        onDocumentLoad={() => Promise.resolve(ready)}
        onLoad={() => {}}
        title="viewer"
      />
    );
    const view = render(viewer(1));
    const first = view.container.querySelector('iframe');
    view.rerender(viewer(2));
    const failed = view.container.querySelectorAll('iframe')[1]!;
    await act(async () => {
      fireEvent.load(failed);
    });
    expect(frameRef.current).toBe(first);
    expect(view.container.querySelectorAll('iframe')).toHaveLength(2);
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    const retry = view.container.querySelectorAll('iframe')[1]!;
    expect(retry).not.toBe(failed);
    await act(async () => {
      fireEvent.load(retry);
    });
    expect(view.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(frameRef.current).toBe(first);
    ready = true;
    view.rerender(viewer(3));
    await act(async () => {
      fireEvent.load(view.container.querySelectorAll('iframe')[1]!);
    });
    expect(view.container.querySelectorAll('iframe')).toHaveLength(1);
    expect(frameRef.current?.getAttribute('src')).toBe('/viewer?v=3');
  });

  for (const loadFirst of [true, false]) {
    test(`initial paint can finish after a failed replacement (load first: ${loadFirst})`, async () => {
      let finishInitial!: (ready: boolean) => void;
      const initialReady = new Promise<boolean>((resolve) => {
        finishInitial = resolve;
      });
      const viewer = (version: number) => (
        <RefreshingViewerFrame
          source={{ src: `/viewer?v=${version}` }}
          iframeRef={frameRef}
          onDocumentLoad={() => (version === 1 ? initialReady : Promise.resolve(false))}
          title="viewer"
        />
      );
      const view = render(viewer(1));
      const first = view.container.querySelector('iframe')!;
      if (loadFirst) fireEvent.load(first);
      view.rerender(viewer(2));
      if (!loadFirst) fireEvent.load(first);
      await act(async () => {
        fireEvent.load(view.container.querySelectorAll('iframe')[1]!);
      });
      expect(view.getByRole('button', { name: 'Retry' })).toBeTruthy();
      await act(async () => finishInitial(true));
      expect(view.getByRole('status').textContent).toContain('Keeping the last view.');
      expect(frameRef.current).toBe(first);
      expect(view.container.querySelectorAll('iframe')).toHaveLength(2);
    });
  }

  test('a retained document error cannot make Retry replace the newer source with the old one', () => {
    const viewer = (version: number) => (
      <RefreshingViewerFrame source={{ src: `/viewer?v=${version}` }} iframeRef={frameRef} title="viewer" />
    );
    const view = render(viewer(1));
    const first = view.container.querySelector('iframe')!;
    fireEvent.load(first);
    view.rerender(viewer(2));
    fireEvent.error(first);
    expect(view.queryByRole('button', { name: 'Retry' })).toBeNull();
    fireEvent.error(view.container.querySelectorAll('iframe')[1]!);
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    const retry = view.container.querySelectorAll('iframe')[1]!;
    expect(retry.getAttribute('src')).toBe('/viewer?v=2');
    fireEvent.load(retry);
    expect(frameRef.current?.getAttribute('src')).toBe('/viewer?v=2');
    expect(view.container.querySelectorAll('iframe')).toHaveLength(1);
  });

  test('Retry cancels a late-loaded document still awaiting its paint acknowledgement', async () => {
    jest.useFakeTimers();
    const signals: AbortSignal[] = [];
    const reply = (frame: HTMLIFrameElement, type: string) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          data: { source: HTML_SURFACE_PUSH_SOURCE, token: 'paint', type },
        }),
      );
    try {
      const view = render(
        <RefreshingViewerFrame
          source={{ src: '/viewer' }}
          iframeRef={frameRef}
          onDocumentLoad={(frame, signal) => {
            signals.push(signal);
            return waitForViewerPaint(frame, 'paint', signal);
          }}
          title="viewer"
        />,
      );
      const first = view.container.querySelector('iframe')!;
      act(() => {
        jest.advanceTimersByTime(VIEWER_LOAD_DEADLINE_MS);
      });
      fireEvent.load(first);
      reply(first, 'mounted');
      fireEvent.click(view.getByRole('button', { name: 'Retry' }));
      expect(signals[0]!.aborted).toBe(true);
      const retry = view.container.querySelector('iframe')!;
      expect(retry).not.toBe(first);
      fireEvent.load(retry);
      expect(signals[1]!.aborted).toBe(false);
      reply(retry, 'mounted');
      await act(async () => {
        reply(retry, 'ready');
      });
      expect(view.queryByRole('status')).toBeNull();
      expect(frameRef.current).toBe(retry);
    } finally {
      cleanup();
      jest.useRealTimers();
    }
  });

  test('preserves the theme in repeated replacement URLs', () => {
    const view = render(
      <RefreshingViewerFrame
        source={{ src: '/viewer?v=1&theme=daylight' }}
        iframeRef={frameRef}
        onLoad={() => {}}
        title="viewer"
      />,
    );
    for (let version = 2; version <= 4; version += 1) {
      view.rerender(
        <RefreshingViewerFrame
          source={{ src: `/viewer?v=${version}&theme=daylight` }}
          iframeRef={frameRef}
          onLoad={() => {}}
          title="viewer"
        />,
      );
      const frames = view.container.querySelectorAll('iframe');
      expect(frames).toHaveLength(2);
      fireEvent.load(frames[1]!);
      expect(view.container.querySelector('iframe')?.getAttribute('src')).toContain(`v=${version}&theme=daylight`);
    }
  });
});
