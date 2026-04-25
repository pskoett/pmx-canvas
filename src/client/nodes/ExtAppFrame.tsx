import type { CallToolResult, ListToolsResult, RequestId, Tool } from '@modelcontextprotocol/sdk/types.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AppBridge, PostMessageTransport, buildAllowAttribute } from '@modelcontextprotocol/ext-apps/app-bridge';
import { useEffect, useRef, useState } from 'preact/hooks';
import { extAppToolResultsMatch } from '../../shared/ext-app-tool-result.js';
import {
  canvasTheme,
  collapseExpandedNode,
  expandNode,
  expandedNodeId,
} from '../state/canvas-store';
import type { CanvasNodeState } from '../types';

type McpUiTheme = 'light' | 'dark';

type IframeLoadTarget = Pick<
  HTMLIFrameElement,
  'addEventListener' | 'removeEventListener' | 'contentDocument'
>;

type ExtAppBridgeNotifications = Pick<AppBridge, 'sendToolInput' | 'sendToolResult'>;
type DisplayMode = 'inline' | 'fullscreen' | 'pip';
const DEFAULT_EXT_APP_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';

interface ExtAppHostDimensionsTarget {
  getBoundingClientRect(): Pick<DOMRectReadOnly, 'width' | 'height'>;
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json() as {
    ok: boolean;
    result?: T;
    error?: string;
  };
  if (!json.ok) throw new Error(json.error ?? `Request failed: ${url}`);
  return json.result as T;
}

export function waitForExtAppFrameLoad(target: IframeLoadTarget): Promise<void> {
  const readyState = target.contentDocument?.readyState;
  if (readyState === 'interactive' || readyState === 'complete') {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const onLoad = () => {
      target.removeEventListener('load', onLoad);
      resolve();
    };
    target.addEventListener('load', onLoad, { once: true });
  });
}

export function getExtAppBridgeInitKey(node: CanvasNodeState, retryKey: number): string {
  const html = typeof node.data.html === 'string' ? node.data.html : '';
  const serverName = typeof node.data.serverName === 'string' ? node.data.serverName : '';
  const appSessionId = typeof node.data.appSessionId === 'string' ? node.data.appSessionId : '';
  const sessionStatus = typeof node.data.sessionStatus === 'string' ? node.data.sessionStatus : '';
  return `${node.id}:${retryKey}:${node.size.height}:${serverName}:${appSessionId}:${sessionStatus}:${html}`;
}

export function resolveExtAppDisplayModeRequest(
  requestedMode: DisplayMode,
  isExpanded: boolean,
): { nextMode: DisplayMode; shouldExpand: boolean; shouldCollapse: boolean } {
  if (requestedMode === 'fullscreen') {
    return {
      nextMode: 'fullscreen',
      shouldExpand: !isExpanded,
      shouldCollapse: false,
    };
  }

  if (requestedMode === 'inline') {
    return {
      nextMode: 'inline',
      shouldExpand: false,
      shouldCollapse: isExpanded,
    };
  }

  return {
    nextMode: requestedMode,
    shouldExpand: false,
    shouldCollapse: false,
  };
}

export async function sendExtAppBootstrapState(
  bridge: ExtAppBridgeNotifications,
  toolInput: Record<string, unknown>,
  toolResult: CallToolResult | undefined,
): Promise<void> {
  await bridge.sendToolInput({ arguments: toolInput });
  if (toolResult) {
    await bridge.sendToolResult(toolResult);
  }
}

export function resolveExtAppSandbox(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : DEFAULT_EXT_APP_SANDBOX;
}

function positiveDimension(value: number, fallback: number): number {
  if (Number.isFinite(value) && value > 0) return Math.round(value);
  if (Number.isFinite(fallback) && fallback > 0) return Math.round(fallback);
  return 1;
}

export function resolveExtAppContainerDimensions(
  target: ExtAppHostDimensionsTarget | null | undefined,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  const rect = target?.getBoundingClientRect();
  return {
    width: positiveDimension(rect?.width ?? 0, fallback.width),
    height: positiveDimension(rect?.height ?? 0, fallback.height),
  };
}

export function shouldApplyExtAppSizeChange(height: unknown, isExpanded: boolean): height is number {
  return typeof height === 'number' && Number.isFinite(height) && height > 0 && !isExpanded;
}

export function ExtAppFrame({ node }: { node: CanvasNodeState }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const transportRef = useRef<PostMessageTransport | null>(null);
  const latestToolInputRef = useRef<Record<string, unknown>>({});
  const latestToolResultRef = useRef<CallToolResult | undefined>(undefined);
  const toolResultSentRef = useRef(false);
  const lastSentToolResultRef = useRef<CallToolResult | undefined>(undefined);
  const toolResultSendingRef = useRef<Promise<void> | null>(null);
  const bridgeReadyRef = useRef(false);
  const themeUnsubRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'done'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const html = node.data.html as string | null;
  const serverName = node.data.serverName as string | undefined;
  const appSessionId = node.data.appSessionId as string | undefined;
  const toolInput = (node.data.toolInput as Record<string, unknown> | undefined) ?? {};
  const toolResult = node.data.toolResult as CallToolResult | undefined;
  const toolName = (node.data.toolName as string) ?? 'ext-app';
  const toolDefinition = node.data.toolDefinition as Tool | undefined;
  const rawToolCallId = node.data.toolCallId;
  const toolCallId: RequestId | undefined =
    typeof rawToolCallId === 'string' || typeof rawToolCallId === 'number' ? rawToolCallId : undefined;
  const resourceMeta = node.data.resourceMeta as {
    csp?: Record<string, unknown>;
    permissions?: Record<string, unknown>;
  } | undefined;
  const sessionStatus = node.data.sessionStatus as string | undefined;
  const sessionError = node.data.sessionError as string | undefined;
  const maxHeight = node.size.height;
  const nodeId = node.id;
  const frameKey = `${node.id}:${retryKey}`;
  const bridgeInitKey = getExtAppBridgeInitKey(node, retryKey);
  const toMcpTheme = (theme: string): McpUiTheme => (theme === 'light' ? 'light' : 'dark');
  const isExpanded = expandedNodeId.value === nodeId;

  latestToolInputRef.current = toolInput;
  latestToolResultRef.current = toolResult;

  const sessionUnavailableMessage =
    sessionStatus === 'error'
      ? (sessionError ?? 'Saved app session is unavailable. Reopen the app to restore interactivity.')
      : 'Reconnecting saved app session...';

  const flushToolResult = (bridge: AppBridge | null): Promise<void> | null => {
    const pendingToolResult = latestToolResultRef.current;
    if (!bridge || !bridgeReadyRef.current || !pendingToolResult) {
      return null;
    }
    // Skip when the content is unchanged. Updates from callServerTool
    // (e.g. Excalidraw saving edits) produce a new reference via SSE and
    // must be forwarded to keep other clients in sync — but SSE layout
    // updates *also* mint new references when nothing in the tool result
    // has actually changed (e.g. after the widget's own updateModelContext
    // call), which would echo the result back and cause the widget to
    // re-render mid-interaction (see: Counter fixture click instability).
    // Deep-equality via structural compare handles both cases: new content
    // is forwarded, unchanged content is suppressed.
    if (lastSentToolResultRef.current === pendingToolResult) {
      return null;
    }
    if (
      lastSentToolResultRef.current &&
      extAppToolResultsMatch(lastSentToolResultRef.current, pendingToolResult)
    ) {
      lastSentToolResultRef.current = pendingToolResult;
      return null;
    }
    if (toolResultSendingRef.current) return toolResultSendingRef.current;
    const sendPromise = bridge
      .sendToolResult(pendingToolResult)
      .then(() => {
        lastSentToolResultRef.current = pendingToolResult;
        toolResultSentRef.current = true;
        setStatus('done');
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Tool result delivery failed: ${msg}`);
        throw err;
      })
      .finally(() => {
        toolResultSendingRef.current = null;
      });
    toolResultSendingRef.current = sendPromise;
    return sendPromise;
  };

  // Initialize bridge when iframe loads and HTML is available
  useEffect(() => {
    if (!html) return; // Wait for HTML to arrive
    const iframe = iframeRef.current;
    if (!iframe) return;
    let disposed = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let hostContextResizeObserver: ResizeObserver | null = null;
    let hostContextRaf: number | null = null;
    toolResultSentRef.current = false;
    lastSentToolResultRef.current = undefined;
    toolResultSendingRef.current = null;
    bridgeReadyRef.current = false;

    const clearFallbackTimer = (): void => {
      if (!fallbackTimer) return;
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    };

    const init = async () => {
      let contentWindow = iframe.contentWindow;
      if (!contentWindow) {
        await waitForExtAppFrameLoad(iframe);
        if (disposed) return;
        contentWindow = iframe.contentWindow;
      }
      if (!contentWindow) {
        throw new Error('Ext-app iframe window is unavailable');
      }

      const buildHostContext = (displayMode: DisplayMode = expandedNodeId.value === nodeId ? 'fullscreen' : 'inline') => ({
        theme: toMcpTheme(canvasTheme.value),
        platform: 'web' as const,
        containerDimensions: resolveExtAppContainerDimensions(iframe, {
          width: node.size.width,
          height: maxHeight,
        }),
        displayMode,
        locale: navigator.language,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(toolDefinition ? {
          toolInfo: {
            id: toolCallId,
            tool: toolDefinition,
          },
        } : {}),
      });

      const scheduleHostContextUpdate = () => {
        if (hostContextRaf !== null) return;
        hostContextRaf = requestAnimationFrame(() => {
          hostContextRaf = null;
          if (disposed || !bridgeReadyRef.current) return;
          bridge.setHostContext?.(buildHostContext());
        });
      };

      const bridge = new AppBridge(
        null,
        { name: 'PMX Canvas', version: '1.0.0' },
        {
          openLinks: {},
          serverTools: { listChanged: false },
          serverResources: { listChanged: false },
          logging: {},
          updateModelContext: { text: {}, structuredContent: {} },
        },
        {
          hostContext: buildHostContext(isExpanded ? 'fullscreen' : 'inline'),
        },
      );

      // Register handlers BEFORE connect
      bridge.onsizechange = async ({ height }) => {
        if (shouldApplyExtAppSizeChange(height, expandedNodeId.value === nodeId)) {
          iframe.style.height = `${height}px`;
        }
        return {};
      };

      bridge.onopenlink = async ({ url }) => {
        window.open(url, '_blank', 'noopener');
        return {};
      };

      bridge.onsandboxready = async () => {
        await bridge.sendSandboxResourceReady({
          html,
          sandbox: DEFAULT_EXT_APP_SANDBOX,
          ...(resourceMeta?.csp ? { csp: resourceMeta.csp } : {}),
          ...(resourceMeta?.permissions ? { permissions: resourceMeta.permissions } : {}),
        });
      };

      // Handle native fullscreen requests from the widget (e.g. Excalidraw expand button)
      bridge.onrequestdisplaymode = async ({ mode }) => {
        const { nextMode, shouldExpand, shouldCollapse } = resolveExtAppDisplayModeRequest(mode, isExpanded);
        if (shouldExpand) {
          expandNode(nodeId);
        } else if (shouldCollapse) {
          collapseExpandedNode();
        }
        return { mode: nextMode };
      };

      // Proxy callServerTool back to PMX server
      bridge.oncalltool = async (params) => {
        if (!appSessionId) {
          throw new Error(sessionUnavailableMessage);
        }
        try {
          const result = await postJson<CallToolResult>('/api/ext-app/call-tool', {
            sessionId: appSessionId,
            nodeId,
            serverName,
            toolName: params.name,
            arguments: params.arguments ?? {},
          });
          setError(null);
          return result;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(`Tool call failed: ${msg}`);
          throw err;
        }
      };

      bridge.setRequestHandler(ListToolsRequestSchema, async () => {
        if (!appSessionId) {
          return { tools: [] } satisfies ListToolsResult;
        }
        return postJson<ListToolsResult>('/api/ext-app/list-tools', { sessionId: appSessionId });
      });

      bridge.onlistresources = async () =>
        appSessionId ? postJson('/api/ext-app/list-resources', { sessionId: appSessionId }) : { resources: [] };

      bridge.onlistresourcetemplates = async () =>
        appSessionId
          ? postJson('/api/ext-app/list-resource-templates', { sessionId: appSessionId })
          : { resourceTemplates: [] };

      bridge.onreadresource = async (params) => {
        if (!appSessionId) {
          throw new Error(sessionUnavailableMessage);
        }
        return postJson('/api/ext-app/read-resource', {
          sessionId: appSessionId,
          uri: params.uri,
        });
      };

      bridge.onlistprompts = async () =>
        appSessionId ? postJson('/api/ext-app/list-prompts', { sessionId: appSessionId }) : { prompts: [] };

      bridge.onupdatemodelcontext = async (params) => {
        if (!appSessionId) return {};
        await postJson('/api/ext-app/model-context', {
          nodeId,
          ...(Array.isArray(params.content) ? { content: params.content } : {}),
          ...(params.structuredContent && typeof params.structuredContent === 'object'
            ? { structuredContent: params.structuredContent }
            : {}),
        });
        return {};
      };

      const transport = new PostMessageTransport(contentWindow, contentWindow);

      bridge.oninitialized = () => {
        if (disposed) return;
        clearFallbackTimer();
        bridgeReadyRef.current = true;
        setStatus('ready');
        setError(null);
        scheduleHostContextUpdate();
        void sendExtAppBootstrapState(bridge, latestToolInputRef.current, undefined)
          .then(() => flushToolResult(bridge))
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            setError(`Bridge bootstrap failed: ${msg}`);
          });
      };

      // Fallback bootstrap for widgets whose initialized notification arrives late
      // or never fires. This keeps standards-based apps usable even when the host
      // handshake timing differs across SDK versions.
      fallbackTimer = setTimeout(() => {
        if (disposed || bridgeReadyRef.current) return;
        const bootstrapToolResult = latestToolResultRef.current;
        void sendExtAppBootstrapState(bridge, latestToolInputRef.current, bootstrapToolResult)
          .then(() => {
            toolResultSentRef.current = Boolean(bootstrapToolResult);
            if (bootstrapToolResult) {
              lastSentToolResultRef.current = bootstrapToolResult;
            }
            setStatus(bootstrapToolResult ? 'done' : 'ready');
            setError(null);
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            setError(`Bridge bootstrap fallback failed: ${msg}`);
          });
      }, 1200);

      await bridge.connect(transport);
      if (disposed) {
        clearFallbackTimer();
        await transport.close();
        return;
      }
      bridgeRef.current = bridge;
      transportRef.current = transport;
      hostContextResizeObserver = new ResizeObserver(scheduleHostContextUpdate);
      hostContextResizeObserver.observe(iframe);
      if (iframe.parentElement) hostContextResizeObserver.observe(iframe.parentElement);

      // Propagate theme changes to ext-app iframe. Read current expanded state
      // at fire time so the widget keeps its fullscreen/inline context accurate.
      let firstFire = true;
      themeUnsubRef.current = canvasTheme.subscribe((newTheme) => {
        if (firstFire) { firstFire = false; return; }
        if (disposed) return;
        bridge.setHostContext?.({
          ...buildHostContext(),
          theme: toMcpTheme(newTheme),
        });
      });

      void flushToolResult(bridge);
    };

    init().catch((err) => {
      clearFallbackTimer();
      console.error('[ext-app] Bridge init failed:', err);
      setError(err?.message ?? 'Bridge initialization failed');
    });

    return () => {
      disposed = true;
      clearFallbackTimer();
      hostContextResizeObserver?.disconnect();
      hostContextResizeObserver = null;
      if (hostContextRaf !== null) {
        cancelAnimationFrame(hostContextRaf);
        hostContextRaf = null;
      }
      bridgeReadyRef.current = false;
      toolResultSendingRef.current = null;
      themeUnsubRef.current?.();
      themeUnsubRef.current = null;
      bridgeRef.current = null;
      if (transportRef.current) {
        transportRef.current.close().catch((closeError) => {
          console.error('[ext-app] transport close failed:', closeError);
        });
        transportRef.current = null;
      }
    };
  }, [bridgeInitKey]);

  // Forward tool result when it arrives after bridge is ready
  useEffect(() => {
    if (toolResult && bridgeRef.current && (status === 'ready' || status === 'done')) {
      void flushToolResult(bridgeRef.current);
    }
  }, [toolResult, status]);

  // Keep the widget's displayMode in sync when the host expands or collapses
  // the node. Without this, a widget that opened in inline mode would never
  // learn that it is now fullscreen (and vice versa), so features gated on
  // fullscreen (like Excalidraw's edit mode) would not activate on the same
  // click that triggered the expansion.
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !bridgeReadyRef.current) return;
    bridge.setHostContext?.({
      theme: toMcpTheme(canvasTheme.value),
      platform: 'web',
      containerDimensions: resolveExtAppContainerDimensions(iframeRef.current, {
        width: node.size.width,
        height: maxHeight,
      }),
      displayMode: isExpanded ? 'fullscreen' : 'inline',
      locale: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }, [isExpanded, maxHeight]);

  // Loading state — HTML not yet fetched
  if (!html) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--c-muted)',
          fontSize: '13px',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <div style={{ opacity: 0.6 }}>Loading {toolName} viewer...</div>
        <div
          style={{
            width: '24px',
            height: '24px',
            border: '2px solid var(--c-line)',
            borderTopColor: 'var(--c-muted)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }}
        />
        <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {sessionStatus && sessionStatus !== 'ready' && (
        <div
          style={{
            padding: '6px 10px',
            fontSize: '11px',
            background: sessionStatus === 'error' ? 'var(--c-danger-12)' : 'var(--c-warn-10)',
            color: sessionStatus === 'error' ? 'var(--c-danger)' : 'var(--c-warn)',
            borderBottom: `1px solid ${sessionStatus === 'error' ? 'var(--c-danger-12)' : 'var(--c-warn-15)'}`,
          }}
        >
          {sessionUnavailableMessage}
        </div>
      )}
      {error && (
        <div
          style={{
            padding: '6px 10px',
            fontSize: '11px',
            background: 'var(--c-danger-12)',
            color: 'var(--c-danger)',
            borderBottom: '1px solid var(--c-danger-12)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span>⚠</span>
          <span style={{ flex: 1 }}>{error}</span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStatus('loading');
              setRetryKey((k) => k + 1);
            }}
            style={{
              background: 'var(--c-surface-hover)',
              border: '1px solid var(--c-danger-12)',
              borderRadius: '3px',
              color: 'var(--c-danger)',
              cursor: 'pointer',
              fontSize: '10px',
              padding: '1px 6px',
            }}
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => setError(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--c-danger)',
              cursor: 'pointer',
              fontSize: '13px',
              padding: '0 2px',
            }}
          >
            ×
          </button>
        </div>
      )}
      {status === 'loading' && (
        <div style={{ padding: '8px', fontSize: '11px', color: 'var(--c-muted)' }}>
          Connecting to ext-app viewer...
        </div>
      )}
      {/* Iframe stack: the widget renders a preview; when not expanded, a
          transparent click-catcher sits on top so the first click always
          expands the node. Without this, widgets like Excalidraw show their
          own "Edit" button inline, which triggers a fullscreen request and
          remounts the iframe in the overlay — forcing the user to click Edit
          a second time to actually enter edit mode. Routing all inline clicks
          to "expand" makes the flow "open → edit" instead of "edit → expand → edit". */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', minHeight: 0, height: '100%' }}>
        <iframe
          key={frameKey}
          ref={iframeRef}
          srcdoc={html}
          sandbox={resolveExtAppSandbox(null)}
          allow={buildAllowAttribute(resourceMeta?.permissions)}
          style={{ flex: 1, width: '100%', height: '100%', minHeight: 0, border: 'none', background: 'var(--c-panel)' }}
          title={`Ext App: ${toolName}`}
        />
        {!isExpanded && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              expandNode(nodeId);
            }}
            class="ext-app-preview-catcher"
            title="Click to open"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'transparent',
              border: 'none',
              padding: 0,
              margin: 0,
              cursor: 'zoom-in',
            }}
            aria-label="Open full view to edit"
          />
        )}
      </div>
    </div>
  );
}
