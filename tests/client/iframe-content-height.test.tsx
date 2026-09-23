import { afterEach, expect, test } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { useIframeContentHeight } from '../../src/client/nodes/use-iframe-content-height';
import { nodes } from '../../src/client/state/canvas-store';
import { grabbingNodeId, humans, resetHumanPresence } from '../../src/client/state/human-store';
import type { CanvasNodeState } from '../../src/client/types';

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  resetHumanPresence();
  nodes.value = new Map();
  globalThis.fetch = originalFetch;
});

function Harness({ node }: { node: CanvasNodeState }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useIframeContentHeight(node, ref, 'test-token');
  return <iframe ref={ref} title="measured" />;
}

for (const remote of [false, true]) {
  test(`defers fitting during a ${remote ? 'remote' : 'local'} grab and records only relocation`, async () => {
    const writes: Array<{
      updates: Array<{ id: string; position?: { x: number; y: number } }>;
      recordHistory?: boolean;
    }> = [];
    globalThis.fetch = (async (url, init) => {
      if (String(url).endsWith('/api/canvas/update')) {
        const body = JSON.parse(String(init?.body));
        if (body.updates?.some((update: { id: string }) => update.id === 'growing')) writes.push(body);
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const node: CanvasNodeState = {
      id: 'growing',
      type: 'json-render',
      position: { x: 100, y: 100 },
      size: { width: 420, height: 280 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: {},
    };
    const neighbor = { ...node, id: 'neighbor', position: { x: 100, y: 420 } };
    nodes.value = new Map([
      [node.id, node],
      [neighbor.id, neighbor],
    ]);
    const { container } = render(<Harness node={node} />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (remote)
      humans.value = [
        {
          clientId: 'other-tab',
          name: 'Other',
          cursor: null,
          grabbingNodeId: node.id,
          lastSeenAt: new Date().toISOString(),
        },
      ];
    else grabbingNodeId.value = node.id;
    const frame = container.querySelector('iframe')!;
    const report = (height: number) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          data: { source: 'pmx-canvas-frame', type: 'content-height', token: 'test-token', height },
        }),
      );
    report(500);
    report(600);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(nodes.value.get(node.id)).toEqual(node);
    expect(writes).toHaveLength(0);
    if (remote) humans.value = [];
    else grabbingNodeId.value = null;
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(nodes.value.get(node.id)?.size.height).toBe(661);
    expect(nodes.value.get(node.id)?.position).toEqual({ x: 100, y: 724 });
    expect(writes[0]?.updates).toHaveLength(1);
    expect(writes[0]?.updates[0]?.id).toBe(node.id);
    expect(writes[0]?.recordHistory).not.toBe(false);
    expect(nodes.value.get(neighbor.id)).toEqual(neighbor);
    report(700);
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]?.recordHistory).toBe(false);
    expect(writes[1]?.updates[0]?.position).toBeUndefined();
  });
}
