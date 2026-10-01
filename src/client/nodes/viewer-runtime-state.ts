import { effect } from '@preact/signals';
import { JSON_VIEWER_STATE_SOURCE } from '../../shared/ax-surface-protocol.js';
import { canvasInteractionEpoch, nodes } from '../state/canvas-store';

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

export function restoreViewerRuntimeState(nodeId: string, token: string, source: Window): void {
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
        )
          snapshots.delete(id);
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
      if (
        !message ||
        message.source !== JSON_VIEWER_STATE_SOURCE ||
        message.type !== 'snapshot' ||
        typeof message.nodeId !== 'string'
      )
        return;
      const snapshot = snapshots.get(message.nodeId);
      const ownerIndex =
        snapshot?.owners.findIndex((owner) => owner.token === message.token && owner.source === event.source) ?? -1;
      if (!snapshot || ownerIndex < 0) return;
      if (!message.state || typeof message.state !== 'object' || Array.isArray(message.state)) return;
      const { ax: _ax, ...state } = message.state as Record<string, unknown>;
      snapshot.state = state;
      // Once the replacement emits, the retired document cannot overwrite it.
      snapshot.owners = snapshot.owners.slice(ownerIndex);
    });
  }
  const node = nodes.value.get(nodeId);
  if (!node) return;
  let snapshot = snapshots.get(nodeId);
  if (!snapshot) {
    snapshot = {
      epoch: canvasInteractionEpoch.value,
      version: node.data.specVersion,
      documentUrl: node.data.url,
      state: null,
      owners: [],
    };
    snapshots.set(nodeId, snapshot);
  }
  snapshot.owners = [...snapshot.owners.filter((owner) => owner.source !== source).slice(-1), { token, source }];
  source.postMessage({ source: JSON_VIEWER_STATE_SOURCE, type: 'restore', token, state: snapshot.state }, '*');
}
