import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, render } from '@testing-library/preact';
import {
  IFRAME_PROBE_PATH,
  forcedIframeMode,
  iframeMode,
  probeSrcIframes,
  resetIframeModeForTests,
  resolveIframeMode,
} from '../../src/client/state/iframe-mode.ts';
import { IFRAME_PROBE_MESSAGE_SOURCE } from '../../src/shared/iframe-probe.ts';
import { useIframeDocument } from '../../src/client/nodes/iframe-document-url.ts';
import { useSurfaceFrame } from '../../src/client/nodes/use-surface-frame.ts';
import { workbenchConnectionEpoch } from '../../src/client/state/canvas-store.ts';

// Amp orb portals embed the canvas page in a nested iframe where Chrome blocks
// child iframes from loading ANY src URL (same-origin included) while srcdoc
// still renders. These tests pin the boot probe, the ?iframe-mode override, and
// the srcdoc fallback behavior of the surface hooks.

function probeElement(): HTMLIFrameElement {
  const el = document.querySelector<HTMLIFrameElement>('iframe[data-pmx-iframe-probe]');
  if (!el) throw new Error('probe iframe not mounted');
  return el;
}

/** Simulate the probe document's postMessage handshake arriving from its frame. */
function dispatchHandshake(el: HTMLIFrameElement, source: Window | null = el.contentWindow): void {
  window.dispatchEvent(new MessageEvent('message', { data: { source: IFRAME_PROBE_MESSAGE_SOURCE }, source }));
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

// happy-dom boots on about:blank (origin "null"); give the page a real origin
// so same-origin checks against window.location.origin behave like a browser.
function setPageUrl(url: string): void {
  (window as unknown as { happyDOM: { setURL(next: string): void } }).happyDOM.setURL(url);
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  setPageUrl('http://localhost:3000/workbench');
  // Default stub for the connect-time requests (viewport report, presence, AX
  // snapshot); tests that assert on fetch install their own.
  globalThis.fetch = (async () =>
    new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
});

afterEach(() => {
  // The library's automatic cleanup registers under the first importing test
  // file only — unmount explicitly so stale probe components don't linger and
  // react to the next test's iframeMode changes.
  cleanup();
  globalThis.fetch = originalFetch;
  resetIframeModeForTests();
  document.querySelectorAll('iframe[data-pmx-iframe-probe]').forEach((el) => {
    el.remove();
  });
});

describe('probeSrcIframes', () => {
  test('resolves src-capable on the probe document handshake', async () => {
    const result = probeSrcIframes(5000);
    const el = probeElement();
    expect(el.getAttribute('src')).toBe(IFRAME_PROBE_PATH);
    expect(el.getAttribute('sandbox')).toBe('allow-scripts');
    dispatchHandshake(el);
    expect(await result).toBe(true);
    expect(document.querySelector('iframe[data-pmx-iframe-probe]')).toBeNull();
  });

  test('load alone proves nothing — blocked hosts fire it on their error page', async () => {
    // The Claude Code desktop browser cancels the sub-frame request
    // (ERR_BLOCKED_BY_CLIENT) yet still fires `load`; only the handshake counts.
    const result = probeSrcIframes(30);
    probeElement().dispatchEvent(new Event('load'));
    expect(await result).toBe(false);
  });

  test('a handshake from any other window is ignored (surfaces cannot spoof the probe)', async () => {
    const result = probeSrcIframes(30);
    dispatchHandshake(probeElement(), window);
    expect(await result).toBe(false);
  });

  test('resolves blocked when neither load nor error fires before the timeout', async () => {
    // happy-dom auto-fires `load` on inserted iframes, which the blocked-portal
    // case precisely does NOT do — hand the probe an inert element so only the
    // timeout arm can resolve it.
    const originalCreate = document.createElement.bind(document);
    document.createElement = ((tag: string) =>
      tag === 'iframe' ? (originalCreate('div') as unknown as HTMLIFrameElement) : originalCreate(tag)) as never;
    try {
      expect(await probeSrcIframes(20)).toBe(false);
    } finally {
      document.createElement = originalCreate;
    }
  });

  test('resolves blocked on an error event', async () => {
    const result = probeSrcIframes(5000);
    probeElement().dispatchEvent(new Event('error'));
    expect(await result).toBe(false);
  });
});

describe('resolveIframeMode', () => {
  test('?iframe-mode=srcdoc forces srcdoc without probing', async () => {
    setPageUrl('http://localhost:3000/workbench?iframe-mode=srcdoc');
    expect(forcedIframeMode()).toBe('srcdoc');
    expect(await resolveIframeMode()).toBe('srcdoc');
    expect(iframeMode.value).toBe('srcdoc');
    expect(document.querySelector('iframe[data-pmx-iframe-probe]')).toBeNull();
  });

  test('top-level documents resolve src synchronously, verified by a background probe', async () => {
    // Zero probe latency before surfaces mount — but the probe still runs in
    // the background, because some top-level hosts block sub-frame requests.
    expect(await resolveIframeMode()).toBe('src');
    expect(iframeMode.value).toBe('src');
    dispatchHandshake(probeElement());
    await flush();
    expect(iframeMode.value).toBe('src');
    expect(document.querySelector('iframe[data-pmx-iframe-probe]')).toBeNull();
  });

  test('a top-level host that blocks sub-frames self-heals to srcdoc when the probe times out', async () => {
    expect(await resolveIframeMode({ probeTimeoutMs: 20 })).toBe('src');
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(iframeMode.value).toBe('srcdoc');
  });

  test('a known Amp orb host skips the unreliable probe and forces srcdoc when embedded', async () => {
    // The orb portal's nested embed blocks node-sized src iframes even when the
    // tiny probe iframe happens to load — AMP_ORB is stamped into the page by
    // the server, and the resolver must trust it over the probe.
    (window as Window & { __PMX_AMP_ORB?: boolean }).__PMX_AMP_ORB = true;
    try {
      expect(await resolveIframeMode({ embedded: true })).toBe('srcdoc');
      expect(iframeMode.value).toBe('srcdoc');
      expect(document.querySelector('iframe[data-pmx-iframe-probe]')).toBeNull();
    } finally {
      delete (window as Window & { __PMX_AMP_ORB?: boolean }).__PMX_AMP_ORB;
    }
  });

  test('an Amp orb page opened top-level (not embedded) still uses src', async () => {
    (window as Window & { __PMX_AMP_ORB?: boolean }).__PMX_AMP_ORB = true;
    try {
      expect(await resolveIframeMode()).toBe('src');
      dispatchHandshake(probeElement());
    } finally {
      delete (window as Window & { __PMX_AMP_ORB?: boolean }).__PMX_AMP_ORB;
    }
  });

  test('embedded documents probe, and the outcome lands in the shared signal memoized', async () => {
    const first = resolveIframeMode({ embedded: true });
    dispatchHandshake(probeElement());
    expect(await first).toBe('src');
    expect(iframeMode.value).toBe('src');
    // Memoized: no new probe iframe on a second call.
    expect(await resolveIframeMode({ embedded: true })).toBe('src');
    expect(document.querySelector('iframe[data-pmx-iframe-probe]')).toBeNull();
  });
});

function SurfaceProbe({ url }: { url: string }) {
  const frame = useSurfaceFrame(url);
  return <iframe title="surface-probe" data-surface-probe {...frame} />;
}

function surfaceIframe(): HTMLIFrameElement {
  const el = document.querySelector<HTMLIFrameElement>('iframe[data-surface-probe]');
  if (!el) throw new Error('surface iframe not rendered');
  return el;
}

describe('useSurfaceFrame', () => {
  test('src mode passes the URL through', () => {
    iframeMode.value = 'src';
    render(<SurfaceProbe url="/api/canvas/surface/n1?theme=dark" />);
    expect(surfaceIframe().getAttribute('src')).toBe('/api/canvas/surface/n1?theme=dark');
    expect(surfaceIframe().hasAttribute('srcdoc')).toBe(false);
  });

  test('unresolved mode holds a same-origin frame empty instead of loading src', () => {
    render(<SurfaceProbe url="/api/canvas/surface/n1" />);
    expect(surfaceIframe().hasAttribute('src')).toBe(false);
    expect(surfaceIframe().hasAttribute('srcdoc')).toBe(false);
  });

  test('srcdoc mode fetches the same-origin surface and inlines it', async () => {
    iframeMode.value = 'srcdoc';
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response('<!doctype html><h1>inline surface</h1>', {
        headers: { 'Content-Type': 'text/html' },
      });
    }) as typeof fetch;

    render(<SurfaceProbe url="/api/canvas/surface/n1?theme=dark&v=abc" />);
    await flush();

    expect(calls).toEqual(['/api/canvas/surface/n1?theme=dark&v=abc&inline-assets=1']);
    expect(surfaceIframe().getAttribute('srcdoc')).toContain('inline surface');
    expect(surfaceIframe().hasAttribute('src')).toBe(false);
  });

  test('srcdoc mode leaves cross-origin URLs on src (cannot be fetched)', async () => {
    iframeMode.value = 'srcdoc';
    const fetchSpy = mock(async () => new Response(''));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(<SurfaceProbe url="https://example.com/hosted-app" />);
    await flush();

    expect(fetchSpy.mock.calls.length).toBe(0);
    expect(surfaceIframe().getAttribute('src')).toBe('https://example.com/hosted-app');
  });

  test('a failed srcdoc fetch falls back to src', async () => {
    iframeMode.value = 'srcdoc';
    globalThis.fetch = (async () => new Response('gone', { status: 404 })) as unknown as typeof fetch;

    render(<SurfaceProbe url="/api/canvas/surface/missing" />);
    await flush();

    expect(surfaceIframe().getAttribute('src')).toBe('/api/canvas/surface/missing');
    expect(surfaceIframe().hasAttribute('srcdoc')).toBe(false);
  });
});

function DocumentProbe({ html }: { html: string }) {
  const doc = useIframeDocument(html, 'allow-scripts');
  return (
    <iframe
      title="document-probe"
      data-document-probe
      data-ready={doc.ready ? '1' : '0'}
      data-frame-key={doc.key}
      {...doc.attributes}
    />
  );
}

describe('useIframeDocument (srcdoc mode)', () => {
  test('serves the document inline without the frame-documents round-trip', async () => {
    iframeMode.value = 'srcdoc';
    const fetchSpy = mock(async () => new Response(JSON.stringify({ ok: true, url: '/x' })));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(<DocumentProbe html="<h1>ext app</h1>" />);
    await flush();

    const el = document.querySelector<HTMLIFrameElement>('iframe[data-document-probe]');
    if (!el) throw new Error('document iframe not rendered');
    expect(fetchSpy.mock.calls.length).toBe(0);
    expect(el.getAttribute('srcdoc')).toBe('<h1>ext app</h1>');
    expect(el.getAttribute('data-ready')).toBe('1');
    expect(el.getAttribute('data-frame-key')).toStartWith('srcdoc-');
  });

  test('re-mints the frame document when a reconnect finds the URL dead (Finding S)', async () => {
    iframeMode.value = 'src';
    let frameAlive = true;
    let mintCounter = 0;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'HEAD') return new Response(null, { status: frameAlive ? 200 : 404 });
      if (String(url) === '/api/canvas/frame-documents' && init?.method === 'POST') {
        mintCounter += 1;
        return Response.json({ ok: true, url: `/api/canvas/frame-documents/mint-${mintCounter}` });
      }
      return new Response('unexpected', { status: 500 });
    }) as unknown as typeof fetch;

    render(<DocumentProbe html="<h1>ext app</h1>" />);
    await flush();
    const src = () => document.querySelector<HTMLIFrameElement>('iframe[data-document-probe]')?.getAttribute('src');
    expect(src()).toBe('/api/canvas/frame-documents/mint-1');

    // Healthy reconnect (SSE blip, same server): HEAD 200 → document kept,
    // no disruptive remount.
    workbenchConnectionEpoch.value += 1;
    await flush();
    expect(src()).toBe('/api/canvas/frame-documents/mint-1');
    expect(mintCounter).toBe(1);

    // Daemon restart: in-memory frame store is gone (HEAD 404) → the hook
    // re-mints against the new process and swaps the iframe src.
    frameAlive = false;
    workbenchConnectionEpoch.value += 1;
    await flush();
    expect(src()).toBe('/api/canvas/frame-documents/mint-2');
    expect(mintCounter).toBe(2);
  });
});
