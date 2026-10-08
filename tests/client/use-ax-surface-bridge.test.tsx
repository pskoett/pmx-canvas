import { afterEach, describe, expect, mock, test } from 'bun:test';
import { render } from '@testing-library/preact';
import { useLayoutEffect } from 'preact/hooks';
import { AX_SURFACE_ACK_SOURCE, AX_SURFACE_EMIT_SOURCE } from '../../src/shared/ax-surface-protocol.ts';
import { useAxSurfaceBridge } from '../../src/client/nodes/use-ax-surface-bridge.ts';

// The M2 shared trust boundary: one hook now owns the sandboxed-surface AX
// listener that was copy-pasted across HtmlNode, McpAppNode, and ExtAppFrame.
// These tests pin the validation gates (source window, protocol tag, nonce,
// node id) and the submit→ack round-trip (#55).

type FakeSurfaceWindow = { postMessage: ReturnType<typeof mock> };

function makeFakeSurface(): { win: FakeSurfaceWindow; iframeRef: { current: HTMLIFrameElement } } {
  const win: FakeSurfaceWindow = { postMessage: mock(() => {}) };
  const iframeRef = {
    current: { contentWindow: win } as unknown as HTMLIFrameElement,
  };
  return { win, iframeRef };
}

function Probe({
  enabled,
  token,
  iframeRef,
  onReady,
}: {
  enabled: boolean;
  token: string;
  iframeRef: { current: HTMLIFrameElement };
  onReady?: () => void;
}) {
  useAxSurfaceBridge({ enabled, token, nodeId: 'node-m2', sourceSurface: 'html-node', iframeRef });
  useLayoutEffect(() => onReady?.(), [onReady]);
  return <div>probe</div>;
}

function dispatchEmit(source: unknown, data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { data, source: source as MessageEventSource | null | undefined }));
}

// Other client files leave debounced store refreshes (the context chip's brief
// fetch) that can land during a test; only an AX interaction post counts here.
function interactionPosts(spy: { mock: { calls: unknown[][] } }): number {
  return spy.mock.calls.filter((call) => call[0] === '/api/canvas/ax/interaction').length;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('useAxSurfaceBridge (plan-009 M2)', () => {
  test('accepts an emit before passive effects, when a fast surface first becomes interactive', async () => {
    const fetchSpy = mock(async () => Response.json({ ok: true }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { win, iframeRef } = makeFakeSurface();
    render(
      <Probe
        enabled={true}
        token="early-nonce"
        iframeRef={iframeRef}
        onReady={() =>
          dispatchEmit(win, {
            source: AX_SURFACE_EMIT_SOURCE,
            token: 'early-nonce',
            nodeId: 'node-m2',
            interaction: { type: 'ax.work.create', payload: { title: 'First click' } },
          })
        }
      />,
    );
    await flush();
    expect(interactionPosts(fetchSpy)).toBe(1);
    expect(win.postMessage.mock.calls).toHaveLength(1);
  });

  test('submits a valid emit through the capability-gated endpoint and acks back', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === '/api/canvas/ax/interaction') {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
      }
      return new Response(JSON.stringify({ ok: true, type: 'ax.work.create' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const { win, iframeRef } = makeFakeSurface();
    render(<Probe enabled={true} token="nonce-1" iframeRef={iframeRef} />);

    dispatchEmit(win, {
      source: AX_SURFACE_EMIT_SOURCE,
      token: 'nonce-1',
      nodeId: 'node-m2',
      correlationId: 'corr-1',
      interaction: { type: 'ax.work.create', payload: { title: 'Wire auth' } },
    });
    await flush();

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('/api/canvas/ax/interaction');
    expect(calls[0].body).toMatchObject({
      type: 'ax.work.create',
      sourceNodeId: 'node-m2',
      sourceSurface: 'html-node',
      payload: { title: 'Wire auth' },
    });

    expect(win.postMessage.mock.calls.length).toBe(1);
    const ack = win.postMessage.mock.calls[0][0] as Record<string, unknown>;
    expect(ack.source).toBe(AX_SURFACE_ACK_SOURCE);
    expect(ack.token).toBe('nonce-1');
    expect(ack.correlationId).toBe('corr-1');
    expect(ack.result).toMatchObject({ ok: true });
  });

  test('ignores emits with a wrong nonce, wrong node id, or foreign source window', async () => {
    const fetchSpy = mock(async () => new Response(JSON.stringify({ ok: true })));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { win, iframeRef } = makeFakeSurface();
    render(<Probe enabled={true} token="nonce-1" iframeRef={iframeRef} />);

    // Wrong token.
    dispatchEmit(win, {
      source: AX_SURFACE_EMIT_SOURCE,
      token: 'stolen-nonce',
      nodeId: 'node-m2',
      interaction: { type: 'ax.work.create' },
    });
    // Wrong node id.
    dispatchEmit(win, {
      source: AX_SURFACE_EMIT_SOURCE,
      token: 'nonce-1',
      nodeId: 'other-node',
      interaction: { type: 'ax.work.create' },
    });
    // Right payload, but from a window that is NOT this node's iframe.
    dispatchEmit(
      { postMessage: mock(() => {}) },
      { source: AX_SURFACE_EMIT_SOURCE, token: 'nonce-1', nodeId: 'node-m2', interaction: { type: 'ax.work.create' } },
    );
    // Wrong protocol tag from the right window with the right nonce.
    dispatchEmit(win, {
      source: 'pmx-canvas-evil',
      token: 'nonce-1',
      nodeId: 'node-m2',
      interaction: { type: 'ax.work.create' },
    });
    // Non-string interaction type.
    dispatchEmit(win, {
      source: AX_SURFACE_EMIT_SOURCE,
      token: 'nonce-1',
      nodeId: 'node-m2',
      interaction: { type: 42 },
    });
    await flush();

    expect(interactionPosts(fetchSpy)).toBe(0);
    expect(win.postMessage.mock.calls.length).toBe(0);
  });

  test('disabled bridge registers nothing', async () => {
    const fetchSpy = mock(async () => new Response(JSON.stringify({ ok: true })));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { win, iframeRef } = makeFakeSurface();
    render(<Probe enabled={false} token="nonce-1" iframeRef={iframeRef} />);

    dispatchEmit(win, {
      source: AX_SURFACE_EMIT_SOURCE,
      token: 'nonce-1',
      nodeId: 'node-m2',
      interaction: { type: 'ax.work.create' },
    });
    await flush();

    expect(interactionPosts(fetchSpy)).toBe(0);
  });
});
