import type { CallToolResult, ListToolsResult, RequestId, Tool } from '@modelcontextprotocol/sdk/types.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AppBridge, PostMessageTransport, buildAllowAttribute } from '@modelcontextprotocol/ext-apps/app-bridge';
import { useEffect, useRef, useState } from 'preact/hooks';
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

export function ExtAppFrame({ node }: { node: CanvasNodeState }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const transportRef = useRef<PostMessageTransport | null>(null);
  const latestToolInputRef = useRef<Record<string, unknown>>({});
  const latestToolResultRef = useRef<CallToolResult | undefined>(undefined);
  const toolResultSentRef = useRef(false);
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
  const resourceMeta = node.data.resourceMeta as { permissions?: Record<string, unknown> } | undefined;
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
    if (!bridge || !bridgeReadyRef.current || !pendingToolResult || toolResultSentRef.current) {
      return null;
    }
    if (toolResultSendingRef.current) return toolResultSendingRef.current;
    const sendPromise = bridge
      .sendToolResult(pendingToolResult)
      .then(() => {
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
    toolResultSentRef.current = false;
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
          hostContext: {
            theme: toMcpTheme(canvasTheme.value),
            platform: 'web',
            containerDimensions: { maxHeight },
            displayMode: isExpanded ? 'fullscreen' : 'inline',
            locale: navigator.language,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            ...(toolDefinition ? {
              toolInfo: {
                id: toolCallId,
                tool: toolDefinition,
              },
            } : {}),
          },
        },
      );

      // Register handlers BEFORE connect
      bridge.onsizechange = async ({ height }) => {
        if (height && iframe) iframe.style.height = `${height}px`;
        return {};
      };

      bridge.onopenlink = async ({ url }) => {
        window.open(url, '_blank', 'noopener');
        return {};
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
        void sendExtAppBootstrapState(bridge, latestToolInputRef.current, latestToolResultRef.current)
          .then(() => {
            toolResultSentRef.current = Boolean(latestToolResultRef.current);
            setStatus(latestToolResultRef.current ? 'done' : 'ready');
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

      // Propagate theme changes to ext-app iframe
      let firstFire = true;
      themeUnsubRef.current = canvasTheme.subscribe((newTheme) => {
        if (firstFire) { firstFire = false; return; }
        if (disposed) return;
        bridge.setHostContext?.({
          theme: toMcpTheme(newTheme),
          platform: 'web',
          containerDimensions: { maxHeight },
          displayMode: 'inline',
          locale: navigator.language,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
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
      {/* allow-scripts only (no allow-same-origin) — srcdoc gets opaque origin,
          cannot access host cookies/storage/DOM. Communication via postMessage only. */}
      <iframe
        key={frameKey}
        ref={iframeRef}
        srcdoc={html}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        allow={buildAllowAttribute(resourceMeta?.permissions)}
        style={{ flex: 1, border: 'none', background: 'var(--c-panel)' }}
        title={`Ext App: ${toolName}`}
      />
    </div>
  );
}
