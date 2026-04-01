import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { bringToFront, canvasTheme, persistLayout, updateNode, viewport } from '../state/canvas-store';
import type { CanvasNodeState } from '../types';

type McpUiTheme = 'light' | 'dark';

type IframeLoadTarget = Pick<
  HTMLIFrameElement,
  'addEventListener' | 'removeEventListener' | 'contentDocument'
>;

type ExtAppBridgeNotifications = Pick<AppBridge, 'sendToolInput' | 'sendToolResult'>;

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
  return `${node.id}:${retryKey}:${node.size.height}:${serverName}:${html}`;
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
  const toolInput = (node.data.toolInput as Record<string, unknown> | undefined) ?? {};
  const toolResult = node.data.toolResult as CallToolResult | undefined;
  const toolName = (node.data.toolName as string) ?? 'ext-app';
  const maxHeight = node.size.height;
  const nodeId = node.id;
  const frameKey = `${node.id}:${retryKey}`;
  const bridgeInitKey = getExtAppBridgeInitKey(node, retryKey);
  const toMcpTheme = (theme: string): McpUiTheme => (theme === 'light' ? 'light' : 'dark');

  latestToolInputRef.current = toolInput;
  latestToolResultRef.current = toolResult;

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
      await waitForExtAppFrameLoad(iframe);
      if (disposed) return;
      const contentWindow = iframe.contentWindow;
      if (!contentWindow) {
        throw new Error('Ext-app iframe window is unavailable');
      }

      const bridge = new AppBridge(
        null,
        { name: 'PMX Canvas', version: '1.0.0' },
        { openLinks: {} },
        {
          hostContext: {
            theme: toMcpTheme(canvasTheme.value),
            platform: 'web',
            containerDimensions: { maxHeight },
            displayMode: 'inline',
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
        if (mode === 'fullscreen') {
          const v = viewport.value;
          const padding = 40;
          updateNode(nodeId, {
            position: {
              x: (padding - v.x) / v.scale,
              y: (padding - v.y) / v.scale,
            },
            size: {
              width: (window.innerWidth - padding * 2) / v.scale,
              height: (window.innerHeight - padding * 2) / v.scale,
            },
          });
          bringToFront(nodeId);
          persistLayout();
        }
        return { mode };
      };

      // Proxy callServerTool back to PMX server
      bridge.oncalltool = async (params) => {
        try {
          const resp = await fetch('/api/ext-app/call-tool', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              serverName,
              toolName: params.name,
              arguments: params.arguments,
            }),
          });
          const json = (await resp.json()) as {
            ok: boolean;
            result?: CallToolResult;
            error?: string;
          };
          if (!json.ok) throw new Error(json.error ?? 'Tool call failed');
          setError(null);
          return json.result as CallToolResult;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(`Tool call failed: ${msg}`);
          throw err;
        }
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

      // Auto-dismiss loading banner if bridge handshake doesn't complete in time.
      // Chart ext-apps render from inline data and don't need the bridge;
      // the CDN import inside the sandbox may fail, leaving oninitialized unfired.
      fallbackTimer = setTimeout(() => {
        if (!disposed) setStatus((s) => (s === 'loading' ? 'ready' : s));
      }, 6000);

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
        transportRef.current.close().catch(() => {});
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
        style={{ flex: 1, border: 'none', background: 'var(--c-panel)' }}
        title={`Ext App: ${toolName}`}
      />
    </div>
  );
}
