import { effect } from '@preact/signals';
import { JSON_VIEWER_STATE_SOURCE } from '../../shared/ax-surface-protocol.js';
import { canvasInteractionEpoch, nodes } from '../state/canvas-store';

type Snapshot = {
  epoch: number;
  version: unknown;
  documentUrl: unknown;
  state: Record<string, unknown> | null;
  owners: Array<{ token: string; source: Window; mounted: () => void; ready: () => void; cancel: () => void }>;
};

// Tab-local UI state only: never persist form drafts in canvas data or AX. Keep
// the receiver alive across the inline/expanded unmount so queued input messages
// cannot fall into a gap between component effects. Two owners cover a handover;
// removal, board navigation and authored spec changes discard the entire entry.
const snapshots = new Map<string, Snapshot>();
let listening = false;

export function restoreViewerRuntimeState(
  nodeId: string,
  token: string,
  source: Window,
  signal?: AbortSignal,
): Promise<boolean | 'cancelled'> {
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
          for (const owner of snapshot.owners) owner.cancel();
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
      if (message.type === 'mounted') {
        snapshot.owners[ownerIndex]!.mounted();
        return;
      }
      if (message.type === 'ready') {
        snapshot.owners[ownerIndex]!.ready();
        return;
      }
      if (message.type !== 'snapshot') return;
      if (!message.state || typeof message.state !== 'object' || Array.isArray(message.state)) return;
      const { ax: _ax, ...state } = message.state as Record<string, unknown>;
      snapshot.state = state;
      // Once the replacement emits, the retired document cannot overwrite it.
      const retired = snapshot.owners.slice(0, ownerIndex);
      snapshot.owners = snapshot.owners.slice(ownerIndex);
      for (const owner of retired) owner.cancel();
    });
  }
  const node = nodes.value.get(nodeId);
  if (!node || signal?.aborted) return Promise.resolve('cancelled');
  const snapshot: Snapshot = snapshots.get(nodeId) ?? {
    epoch: canvasInteractionEpoch.value,
    version: node.data.specVersion,
    documentUrl: node.data.url,
    state: null,
    owners: [],
  };
  snapshots.set(nodeId, snapshot);
  const ready = new Promise<boolean | 'cancelled'>((resolve) => {
    const finish = (loaded: boolean | 'cancelled') => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', owner.cancel);
      if (loaded !== true) snapshot.owners = snapshot.owners.filter((entry) => entry !== owner);
      resolve(loaded);
    };
    const owner = {
      token,
      source,
      mounted: () => clearTimeout(timer),
      ready: () => finish(true),
      cancel: () => finish('cancelled'),
    };
    // A missing runtime fails, but a healthy offscreen document can wait for
    // paint indefinitely. Its synchronous mount acknowledgement ends the deadline;
    // only the later frame-gated ready message may promote it.
    const timer = setTimeout(() => finish(false), 10_000);
    for (const previous of snapshot.owners.filter((entry) => entry.source === source)) previous.cancel();
    while (snapshot.owners.length > 1) snapshot.owners[0]!.cancel();
    snapshot.owners.push(owner);
    signal?.addEventListener('abort', owner.cancel, { once: true });
  });
  source.postMessage({ source: JSON_VIEWER_STATE_SOURCE, type: 'restore', token, state: snapshot.state }, '*');
  return ready;
}
