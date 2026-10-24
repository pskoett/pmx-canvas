import { setTimeout as delay } from 'node:timers/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ErrorCode,
  McpError,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { canvasState } from '../server/canvas-state.js';
import { onWorkbenchEvent } from '../server/server.js';
import type { CanvasAccess } from './canvas-access.js';
import { ContextUriTemplate } from './context-uri-template.js';

const liveResources = new Set(
  [
    'layout',
    'boards',
    'summary',
    'context',
    'graph',
    'spatial-context',
    'history',
    'code-graph',
    'pinned-context',
    'ax',
    'ax-context',
    'ax-timeline',
    'ax-work',
    'ax-pending-steering',
    'ax-delivery',
  ].map((name) => `canvas://${name}`),
);
const contextTemplate = new ContextUriTemplate();
const graphTemplate = new ContextUriTemplate('graph', ['focus', 'depth']);

// A context-status-changed read receipt must never trigger another read forever.
const resourceEvents = new Set([
  'context-pins-changed',
  'boards-changed',
  'ax-state-changed',
  'ax-event-created',
  'canvas-layout-update',
  'canvas-viewport-update',
  'canvas-camera-move',
  'canvas-tour-step',
  'canvas-tour-exit',
  // These events synchronize node data inside server.ts.
  'workbench-open',
  'ext-app-open',
  'ext-app-update',
  'ext-app-result',
  'context-cards',
  'context-usage',
  'aux-open',
  'aux-close',
  'canvas-status',
  'execution-phase',
  'canvas-response-start',
  'canvas-response-delta',
  'canvas-response-complete',
]);

function isLiveResource(uri: string): boolean {
  return liveResources.has(uri) || contextTemplate.match(uri) !== null || graphTemplate.match(uri) !== null;
}

/** One subscription set and event source per MCP connection. Notifications are not reads. */
export function registerResourceSubscriptions(server: McpServer, getCanvas: () => Promise<CanvasAccess>) {
  const subscriptions = new Set<string>();
  let disposeSource: (() => void) | undefined;
  let source: string | null | undefined;
  let closed = false;

  function notify(): void {
    // Broad invalidation is intentional: context projections span pins, nodes and AX.
    for (const uri of subscriptions) {
      void server.server.sendResourceUpdated({ uri }).catch((error: unknown) => {
        if (!closed) console.error('[mcp] resource notification failed:', error);
      });
    }
  }

  async function watchRemote(baseUrl: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const response = await fetch(`${baseUrl}/api/workbench/events`, { signal });
        if (!response.ok || !response.body) throw new Error(`Canvas event stream: HTTP ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          // Reconnecting may have missed a change. Invalidate subscribed URIs only.
          notify();
          while (!signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split('\n\n');
            buffer = frames.pop() ?? '';
            for (const frame of frames) {
              const event = frame
                .split('\n')
                .find((line) => line.startsWith('event:'))
                ?.slice(6)
                .trim();
              if (event && resourceEvents.has(event)) notify();
            }
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } catch (error) {
        if (signal.aborted) return;
        console.error('[mcp] canvas event stream disconnected:', error);
      }
      try {
        await delay(1_000, undefined, { signal });
      } catch {
        return;
      }
    }
  }

  function attach(canvas: CanvasAccess): void {
    if (closed || subscriptions.size === 0 || source === canvas.remoteBaseUrl) return;
    disposeSource?.();
    source = canvas.remoteBaseUrl;
    if (source) {
      const controller = new AbortController();
      disposeSource = () => controller.abort();
      void watchRemote(source, controller.signal);
    } else {
      const disposeState = canvasState.onChange(notify);
      // Library-only writes do not change the active board's state.
      const disposeEvents = onWorkbenchEvent((event) => {
        if (resourceEvents.has(event)) notify();
      });
      disposeSource = () => {
        disposeState();
        disposeEvents();
      };
    }
  }

  function dispose(): void {
    closed = true;
    subscriptions.clear();
    disposeSource?.();
    disposeSource = undefined;
    source = undefined;
  }

  server.server.registerCapabilities({ resources: { subscribe: true } });
  server.server.setRequestHandler(SubscribeRequestSchema, async ({ params }, extra) => {
    if (!isLiveResource(params.uri))
      throw new McpError(ErrorCode.InvalidParams, `Resource does not support subscriptions: ${params.uri}`);
    const canvas = await getCanvas();
    extra.signal.throwIfAborted();
    if (closed) throw new McpError(ErrorCode.InternalError, 'Connection closed');
    subscriptions.add(params.uri);
    attach(canvas);
    return {};
  });
  server.server.setRequestHandler(UnsubscribeRequestSchema, ({ params }) => {
    subscriptions.delete(params.uri);
    if (subscriptions.size === 0) {
      disposeSource?.();
      disposeSource = undefined;
      source = undefined;
    }
    return {};
  });
  const onclose = server.server.onclose;
  server.server.onclose = () => {
    dispose();
    onclose?.();
  };
  return { attach, dispose };
}
