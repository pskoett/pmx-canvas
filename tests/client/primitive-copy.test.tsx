import { afterEach, expect, spyOn, test } from 'bun:test';
import { render } from 'preact';
import { useRef } from 'preact/hooks';
import { copyPrimitiveJson, usePrimitiveJson } from '../../src/client/nodes/primitive-copy';
import type { CanvasNodeState } from '../../src/client/types';
import { HTML_SURFACE_PUSH_SOURCE } from '../../src/shared/ax-surface-protocol';

const node: CanvasNodeState = {
  id: 'config',
  type: 'html',
  position: { x: 0, y: 0 },
  size: { width: 400, height: 300 },
  zIndex: 1,
  collapsed: false,
  pinned: false,
  data: { htmlPrimitive: 'config-editor' },
};
const host = document.createElement('div');
afterEach(() => {
  render(null, host);
  host.remove();
});

function Owner({ expanded, token }: { expanded: boolean; token: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  usePrimitiveJson(node, token, frame, expanded);
  return <iframe ref={frame} data-owner={expanded ? 'expanded' : 'inline'} />;
}

test('Copy JSON chooses the expanded draft independently of later inline registration and falls back on close', async () => {
  document.body.append(host);
  // Exercise the text-only clipboard capability; browser coverage tests ClipboardItem.
  const item = globalThis.ClipboardItem;
  Reflect.set(globalThis, 'ClipboardItem', undefined);
  const clipboard = spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  const draw = (expanded: boolean, token: string) =>
    render(
      <>
        {expanded && <Owner key="expanded" expanded token="expanded-token" />}
        <Owner key="inline" expanded={false} token={token} />
      </>,
      host,
    );
  draw(true, 'inline-token');
  const frames = [...host.querySelectorAll('iframe')];
  const responders = frames.map((frame) =>
    spyOn(frame.contentWindow!, 'postMessage').mockImplementation((message) => {
      const request = message as { requestId: string; token: string };
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow!,
          origin: 'null',
          data: {
            ...request,
            source: HTML_SURFACE_PUSH_SOURCE,
            type: 'copy-json-result',
            json: JSON.stringify({ draft: frame.dataset.owner }),
          },
        }),
      );
    }),
  );
  try {
    await copyPrimitiveJson(node.id);
    expect(clipboard).toHaveBeenLastCalledWith('{"draft":"expanded"}');
    draw(true, 'inline-replacement-token');
    await copyPrimitiveJson(node.id);
    expect(clipboard).toHaveBeenLastCalledWith('{"draft":"expanded"}');
    draw(false, 'inline-replacement-token');
    await copyPrimitiveJson(node.id);
    expect(clipboard).toHaveBeenLastCalledWith('{"draft":"inline"}');
  } finally {
    for (const responder of responders) responder.mockRestore();
    clipboard.mockRestore();
    Reflect.set(globalThis, 'ClipboardItem', item);
  }
});
