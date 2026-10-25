import { effect } from '@preact/signals';
import { JSON_VIEWER_STATE_SOURCE } from '../../shared/ax-surface-protocol.js';
import { canvasInteractionEpoch, nodes } from '../state/canvas-store';
import type { CanvasNodeState } from '../types';
import { VIEWER_LOAD_DEADLINE_MS } from './ViewerFrame';

type Snapshot = {
  epoch: number;
  version: unknown;
  documentUrl: unknown;
  state: Record<string, unknown> | null;
  owners: Array<{ token: string; source: Window }>;
};

// Tab-local UI state only: never persist form drafts in canvas data or AX. Keep
// the receiver alive across the inline/expanded unmount so queued input messages
// cannot fall into a gap between component effects. Two owners cover a handover;
// removal, board navigation and authored spec changes discard the entire entry.
const snapshots = new Map<string, Snapshot>();
let listening = false;

export function restoreViewerRuntimeState(
  authored: CanvasNodeState,
  token: string,
  source: Window,
  signal?: AbortSignal,
): Promise<boolean | 'cancelled'> {
  const nodeId = authored.id;
  if (!listening) {
    listening = true;
    effect(() => {
      const current = nodes.value;
      const epoch = canvasInteractionEpoch.value;
      for (const [id, snapshot] of snapshots) {
        const node = current.get(id);
        if (
          !node ||
          snapshot.epoch !== epoch ||
          snapshot.version !== node.data.specVersion ||
          snapshot.documentUrl !== node.data.url
        ) {
          snapshots.delete(id);
        }
      }
    });
    window.addEventListener('message', (event: MessageEvent) => {
      const message = event.data as {
        source?: string;
        type?: string;
        token?: string;
        nodeId?: string;
        state?: unknown;
      } | null;
      if (!message || message.source !== JSON_VIEWER_STATE_SOURCE || typeof message.nodeId !== 'string') return;
      const snapshot = snapshots.get(message.nodeId);
      const ownerIndex =
        snapshot?.owners.findIndex((owner) => owner.token === message.token && owner.source === event.source) ?? -1;
      if (!snapshot || ownerIndex < 0) return;
      if (message.type !== 'snapshot') return;
      if (!message.state || typeof message.state !== 'object' || Array.isArray(message.state)) return;
      const { ax: _ax, ...state } = message.state as Record<string, unknown>;
      snapshot.state = state;
      // Once the replacement emits, the retired document cannot overwrite it.
      snapshot.owners = snapshot.owners.slice(ownerIndex);
    });
  }
  const node = nodes.value.get(nodeId);
  if (!node || signal?.aborted) return Promise.resolve('cancelled');
  // A retained document may load after its authored spec was replaced. It can
  // still acknowledge paint, but cannot own or restore the new spec's drafts.
  const current = node.data.specVersion === authored.data.specVersion && node.data.url === authored.data.url;
  const snapshot: Snapshot | undefined = current
    ? (snapshots.get(nodeId) ?? {
        epoch: canvasInteractionEpoch.value,
        version: authored.data.specVersion,
        documentUrl: authored.data.url,
        state: null,
        owners: [],
      })
    : undefined;
  if (snapshot) snapshots.set(nodeId, snapshot);
  const ready = new Promise<boolean | 'cancelled'>((resolve) => {
    const finish = (loaded: boolean | 'cancelled') => {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      signal?.removeEventListener('abort', cancel);
      if (loaded !== true && snapshot) snapshot.owners = snapshot.owners.filter((entry) => entry !== owner);
      resolve(loaded);
    };
    const cancel = () => finish('cancelled');
    const receive = (event: MessageEvent) => {
      if (
        event.source !== source ||
        event.data?.source !== JSON_VIEWER_STATE_SOURCE ||
        event.data?.token !== token ||
        event.data?.nodeId !== nodeId
      )
        return;
      if (event.data.type === 'mounted') clearTimeout(timer);
      if (event.data.type === 'ready') finish(true);
    };
    const owner = { token, source };
    // A missing runtime fails, but a healthy offscreen document can wait for
    // paint indefinitely. Its synchronous mount acknowledgement ends the deadline;
    // only the later frame-gated ready message may promote it.
    const timer = setTimeout(() => finish(false), VIEWER_LOAD_DEADLINE_MS);
    if (snapshot) {
      snapshot.owners = snapshot.owners.filter((entry) => entry.source !== source).slice(-1);
      snapshot.owners.push(owner);
    }
    window.addEventListener('message', receive);
    signal?.addEventListener('abort', cancel, { once: true });
  });
  source.postMessage({ source: JSON_VIEWER_STATE_SOURCE, type: 'restore', token, state: snapshot?.state ?? null }, '*');
  return ready;
}
