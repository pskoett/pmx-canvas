import type { RefObject } from 'preact';
import { useLayoutEffect } from 'preact/hooks';
import { HTML_SURFACE_PUSH_SOURCE } from '../../shared/ax-surface-protocol.js';
import { showToast } from '../state/attention-bridge';
import type { CanvasNodeState } from '../types';

type Owner = { nodeId: string; token: string; frame: RefObject<HTMLIFrameElement>; expanded: boolean };
const owners = new Set<Owner>();

export function canCopyPrimitiveJson(node: CanvasNodeState): boolean {
  return (
    node.type === 'html' && typeof node.data.htmlPrimitive === 'string' && node.data.htmlPrimitive !== 'presentation'
  );
}

export function usePrimitiveJson(
  node: CanvasNodeState,
  token: string,
  frame: RefObject<HTMLIFrameElement>,
  expanded: boolean,
): void {
  const enabled = canCopyPrimitiveJson(node);
  useLayoutEffect(() => {
    if (!enabled) return;
    const owner = { nodeId: node.id, token, frame, expanded };
    owners.add(owner);
    return () => {
      owners.delete(owner);
    };
  }, [enabled, node.id, token, expanded]);
}

function readCurrentJson(nodeId: string): Promise<string> {
  // The expanded document, when present, owns the latest interactive state.
  const connected = [...owners].filter((owner) => owner.nodeId === nodeId && owner.frame.current?.isConnected);
  const owner = connected.find((owner) => owner.expanded) ?? connected[0];
  const frame = owner?.frame.current;
  if (!owner || !frame?.contentWindow) return Promise.reject(new Error('Open the viewer before copying JSON.'));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const finish = (json?: string) => {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      frame.removeEventListener('load', changed);
      if (json !== undefined) resolve(json);
      else reject(new Error('The viewer is unavailable or changed. Wait for it to load, then try again.'));
    };
    const changed = () => finish();
    const receive = (event: MessageEvent) => {
      const message = event.data;
      if (
        event.source !== frame.contentWindow ||
        event.origin !== 'null' ||
        message?.source !== HTML_SURFACE_PUSH_SOURCE ||
        message.type !== 'copy-json-result' ||
        message.token !== owner.token ||
        message.requestId !== requestId
      )
        return;
      finish(
        owners.has(owner) && owner.frame.current === frame && frame.isConnected && typeof message.json === 'string'
          ? message.json
          : undefined,
      );
    };
    const timer = setTimeout(changed, 3000);
    window.addEventListener('message', receive);
    frame.addEventListener('load', changed, { once: true });
    // Opaque-origin sandbox: exact source + per-document nonce bind the reply.
    frame.contentWindow!.postMessage(
      { source: HTML_SURFACE_PUSH_SOURCE, type: 'copy-json', token: owner.token, requestId },
      '*',
    );
  });
}

export async function copyPrimitiveJson(nodeId: string): Promise<void> {
  try {
    if (!navigator.clipboard) throw new Error('Clipboard access is unavailable in this browser.');
    const json = readCurrentJson(nodeId);
    // Keep clipboard.write inside the user's activation, including WebKit. The
    // iframe supplies bytes, never clipboard permission or a stale server export.
    void json.catch(() => {});
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/plain': json.then((text) => new Blob([text], { type: 'text/plain' })) }),
      ]);
    } else {
      await navigator.clipboard.writeText(await json);
    }
    showToast('context', 'JSON copied', '', [nodeId]);
  } catch (error) {
    showToast('remove', 'Could not copy JSON', error instanceof Error ? error.message : 'Clipboard access failed.', [
      nodeId,
    ]);
  }
}
