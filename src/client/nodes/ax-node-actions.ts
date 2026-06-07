import { submitAxInteractionFromClient } from '../state/intent-bridge';
import { showToast } from '../state/attention-bridge';
import type { CanvasNodeState } from '../types';

/**
 * Submit a native-node AX interaction (plan-004 Phase 2) and surface the outcome
 * as a transient toast. Inline node controls call this; the server enforces the
 * node's capabilities, so a denied interaction simply shows an error toast.
 */
export async function runNodeAxInteraction(
  node: CanvasNodeState,
  type: string,
  payload: Record<string, unknown> | undefined,
  successTitle: string,
): Promise<void> {
  const res = await submitAxInteractionFromClient({
    type,
    sourceNodeId: node.id,
    sourceSurface: 'native-node',
    ...(payload ? { payload } : {}),
  });
  if (res.ok) {
    showToast('context', successTitle, '', [node.id]);
  } else {
    showToast('remove', 'AX action failed', res.error ?? res.code ?? 'Unknown error', [node.id]);
  }
}

/** Shared style for the small inline AX action button on native nodes. */
export const axNodeActionButtonStyle = {
  padding: '3px 8px',
  fontSize: '10px',
  background: 'var(--c-accent-12)',
  border: '1px solid var(--c-accent-25)',
  borderRadius: '4px',
  color: 'var(--c-text-soft)',
  cursor: 'pointer',
  flexShrink: 0,
} as const;
