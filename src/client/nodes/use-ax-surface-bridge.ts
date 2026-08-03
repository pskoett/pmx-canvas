import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';
import { AX_SURFACE_ACK_SOURCE, AX_SURFACE_EMIT_SOURCE } from '../../shared/ax-surface-protocol.js';
import { showToast } from '../state/attention-bridge';
import { submitAxInteractionFromClient } from '../state/intent-bridge';

/** Sandboxed surfaces that emit through this bridge (clamped to their own node server-side). */
export type AxSurfaceBridgeSurface = 'json-render' | 'html-node' | 'mcp-app';

/**
 * The sandboxed-surface AX trust boundary, single-sited (plan-009 M2; the
 * listener was copy-pasted across HtmlNode, McpAppNode, and ExtAppFrame — a
 * prior near-miss lived exactly in that duplication). Receives a
 * `window.PMX_AX.emit(...)` message from THIS node's iframe, validates the
 * event source against the live contentWindow plus the per-mount nonce token
 * and node id, submits the interaction through the capability-gated endpoint
 * (the server re-validates capabilities and clamps sandboxed surfaces to their
 * own node), and acks the result back so the surface can self-confirm (#55).
 */
export function useAxSurfaceBridge(options: {
  enabled: boolean;
  token: string;
  nodeId: string;
  sourceSurface: AxSurfaceBridgeSurface;
  iframeRef: RefObject<HTMLIFrameElement>;
}): void {
  const { enabled, token, nodeId, sourceSurface, iframeRef } = options;
  useEffect(() => {
    if (!enabled || !token) return;
    function onAxMessage(event: MessageEvent) {
      // Bind to THIS node's own iframe; the nonce + nodeId are a second gate,
      // not the only one.
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as {
        source?: string;
        token?: string;
        nodeId?: string;
        correlationId?: string;
        interaction?: { type?: unknown; payload?: unknown };
      } | null;
      if (!data || data.source !== AX_SURFACE_EMIT_SOURCE || data.token !== token || data.nodeId !== nodeId) return;
      const interaction = data.interaction;
      if (!interaction || typeof interaction.type !== 'string') return;
      const interactionType = interaction.type;
      void submitAxInteractionFromClient({
        type: interactionType,
        sourceNodeId: nodeId,
        sourceSurface,
        ...(interaction.payload && typeof interaction.payload === 'object'
          ? { payload: interaction.payload as Record<string, unknown> }
          : {}),
      }).then((res) => {
        if (res.ok) showToast('context', 'AX interaction', interactionType, [nodeId]);
        else showToast('remove', 'AX interaction rejected', res.error ?? res.code ?? '', [nodeId]);
        iframeRef.current?.contentWindow?.postMessage(
          {
            source: AX_SURFACE_ACK_SOURCE,
            token,
            ...(data.correlationId ? { correlationId: data.correlationId } : {}),
            interaction: { type: interactionType },
            result: res,
          },
          '*',
        );
      });
    }
    window.addEventListener('message', onAxMessage);
    return () => window.removeEventListener('message', onAxMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, token, nodeId, sourceSurface]);
}
