import type { CallToolResult, ListToolsResult, RequestId, Tool } from '@modelcontextprotocol/sdk/types.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  AppBridge,
  PostMessageTransport,
  buildAllowAttribute,
  McpUiHostStylesSchema,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import {
  AX_SURFACE_ACK_SOURCE,
  AX_SURFACE_EMIT_SOURCE,
  HTML_SURFACE_PUSH_SOURCE,
  MCP_SURFACE_METHOD,
  surfaceNotification,
} from '../../shared/ax-surface-protocol.js';
import { extAppToolResultsMatch } from '../../shared/ext-app-tool-result.js';
import { DEFAULT_EXT_APP_SANDBOX } from '../../shared/surface.js';
import { canvasThemeScheme } from '../../shared/themes.js';
import { AUTO_FIT_TITLEBAR_HEIGHT } from '../canvas/auto-fit';
import {
  canvasTheme,
  collapseExpandedNode,
  expandNode,
  expandedNodeId,
  nodes,
  persistLayout,
  resizeNode,
} from '../state/canvas-store';
import { workbenchFetch } from '../state/workbench-transport';
import type { CanvasNodeState } from '../types';
import { useIframeDocument } from './iframe-document-url';
import { useAxSurfaceBridge } from './use-ax-surface-bridge';
import { RefreshingViewerFrame, waitForViewerPaint } from './ViewerFrame';

type DisplayMode = 'inline' | 'fullscreen' | 'pip';

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await workbenchFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as { ok: boolean; result?: T; error?: string };
  if (!json.ok) throw new Error(json.error ?? `Request failed: ${url}`);
  return json.result as T;
}

export function resolveExtAppDisplayModeRequest(requestedMode: DisplayMode, isExpanded: boolean) {
  return {
    nextMode: requestedMode,
    shouldExpand: requestedMode === 'fullscreen' && !isExpanded,
    shouldCollapse: requestedMode === 'inline' && isExpanded,
  };
}

export function buildExtAppAxBridgeScript(axToken: string, nodeId: string): string {
  return `<script data-pmx-canvas-ax-bridge>
(function () {
  const PMX_AX_TOKEN = ${JSON.stringify(axToken)};
  const PMX_AX_NODE_ID = ${JSON.stringify(nodeId)};
  const notify = function (params) {
    parent.postMessage({ jsonrpc: '2.0', method: '${MCP_SURFACE_METHOD}', params: params }, '*');
  };
  const read = function (event) {
    const m = event.data;
    return event.source === parent && m && m.jsonrpc === '2.0' && m.method === '${MCP_SURFACE_METHOD}' && !('id' in m) ? m.params : null;
  };
  window.addEventListener('message', function (event) {
    const m = read(event);
    if (event.source !== parent || !m || m.source !== 'pmx-viewer-theme' || m.token !== PMX_AX_TOKEN) return;
    for (const [name, value] of Object.entries(m.variables)) document.documentElement.style.setProperty(name, value);
  });
  window.addEventListener('message', function (event) {
    const m = read(event);
    if (event.source !== parent || !m || m.source !== '${HTML_SURFACE_PUSH_SOURCE}' || m.token !== PMX_AX_TOKEN || m.type !== 'check-ready') return;
    notify({ source: '${HTML_SURFACE_PUSH_SOURCE}', type: 'mounted', token: PMX_AX_TOKEN });
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      notify({ source: '${HTML_SURFACE_PUSH_SOURCE}', type: 'ready', token: PMX_AX_TOKEN });
    }); });
  });
  window.PMX_AX = window.PMX_AX || {};
  const pending = new Map();
  const ackListeners = [];
  let seq = 0;
  window.PMX_AX.emit = function (type, payload) {
    seq += 1;
    const correlationId = PMX_AX_NODE_ID + '-' + seq + '-' + (Date.now ? Date.now() : 0);
    return new Promise(function (resolve) {
      const timer = setTimeout(function () {
        pending.delete(correlationId);
        resolve({ ok: false, status: 504, code: 'ax-ack-timeout', error: 'ax-ack-timeout' });
      }, 10000);
      pending.set(correlationId, function (result) { clearTimeout(timer); resolve(result); });
      notify({
        source: '${AX_SURFACE_EMIT_SOURCE}', token: PMX_AX_TOKEN, nodeId: PMX_AX_NODE_ID,
        correlationId: correlationId,
        interaction: { type: String(type), payload: payload && typeof payload === 'object' ? payload : {} },
      });
    });
  };
  window.PMX_AX.on = function (eventType, cb) {
    if (eventType === 'ack' && typeof cb === 'function') ackListeners.push(cb);
  };
  window.addEventListener('message', function (event) {
    const m = read(event);
    if (event.source !== window.parent || !m || m.source !== '${AX_SURFACE_ACK_SOURCE}' || m.token !== PMX_AX_TOKEN) return;
    const result = m.result || { ok: false };
    const resolver = m.correlationId ? pending.get(m.correlationId) : undefined;
    if (resolver) { pending.delete(m.correlationId); resolver(result); }
    for (let i = 0; i < ackListeners.length; i += 1) {
      try { ackListeners[i](result, m.interaction || null); } catch (e) {}
    }
    try { window.dispatchEvent(new CustomEvent('pmx-ax-ack', { detail: { result: result, interaction: m.interaction || null } })); } catch (e) {}
  });
})();
</script>`;
}

export function buildExtAppSurfaceBaseStyles(): string {
  return '<style data-pmx-canvas-ext-app-base>html, body { background: var(--c-panel, transparent) !important; }</style>';
}

export function injectExtAppAxBridgeScript(html: string, script: string): string {
  if (!script) return html;
  const head = /<head\b[^>]*>/i.exec(html) ?? /<body\b[^>]*>/i.exec(html);
  if (!head) return `${script}${html}`;
  const end = head.index + head[0].length;
  return `${html.slice(0, end)}${script}${html.slice(end)}`;
}

function positiveDimension(value: number, fallback: number): number {
  if (Number.isFinite(value) && value > 0) return Math.round(value);
  if (Number.isFinite(fallback) && fallback > 0) return Math.round(fallback);
  return 1;
}

export function resolveExtAppContainerDimensions(
  target:
    | {
        clientWidth?: number;
        clientHeight?: number;
        getBoundingClientRect(): Pick<DOMRectReadOnly, 'width' | 'height'>;
      }
    | null
    | undefined,
  fallback: { width: number; height: number },
) {
  const rect = target?.getBoundingClientRect();
  return {
    width: positiveDimension(target?.clientWidth ?? 0, positiveDimension(rect?.width ?? 0, fallback.width)),
    height: positiveDimension(target?.clientHeight ?? 0, positiveDimension(rect?.height ?? 0, fallback.height)),
  };
}

export function shouldApplyExtAppSizeChange(height: unknown, isExpanded: boolean): height is number {
  return typeof height === 'number' && Number.isFinite(height) && height > 0 && !isExpanded;
}

// The MCP scheme remains dark/light, but apps also receive the complete canvas
// palette and the SDK's standard style aliases without a document reload.
function canvasVariables() {
  const computed = getComputedStyle(document.documentElement);
  const variables: Record<string, string> = {};
  for (const name of Array.from(computed)) {
    if (/^--(c-|font-|fs-|space-|r-|e-)/.test(name)) variables[name] = computed.getPropertyValue(name).trim();
  }
  return variables;
}

function hostStyles() {
  const computed = getComputedStyle(document.documentElement);
  const variables: Record<string, string> = {};
  const aliases: Record<string, string> = {
    '--color-background-primary': '--c-panel',
    '--color-background-secondary': '--c-panel-soft',
    '--color-text-primary': '--c-text',
    '--color-text-secondary': '--c-text-soft',
    '--color-border-primary': '--c-line',
    '--font-sans': '--font-ui',
    '--font-mono': '--font-code',
  };
  for (const [name, token] of Object.entries(aliases)) variables[name] = computed.getPropertyValue(token).trim();
  return McpUiHostStylesSchema.parse({ variables });
}

export function ExtAppFrame({ node, expanded = false }: { node: CanvasNodeState; expanded?: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const connections = useRef(
    new Map<HTMLIFrameElement, { flush: () => void; theme: () => void; loaded: () => Promise<boolean> }>(),
  );
  const latest = useRef(node);
  latest.current = node;
  const html = typeof node.data.html === 'string' ? node.data.html : '';
  const appSessionId = node.data.appSessionId as string | undefined;
  const resourceMeta = node.data.resourceMeta as
    | { csp?: Record<string, unknown>; permissions?: Record<string, unknown> }
    | undefined;
  const axToken = useMemo(() => `ax-${crypto.randomUUID()}`, []);
  const axEnabled = (node.data.axCapabilities as { enabled?: boolean } | undefined)?.enabled === true;
  const documentHtml = injectExtAppAxBridgeScript(
    html,
    buildExtAppSurfaceBaseStyles() + buildExtAppAxBridgeScript(axToken, node.id),
  );
  const frameDocument = useIframeDocument(documentHtml, DEFAULT_EXT_APP_SANDBOX);
  useAxSurfaceBridge({
    enabled: axEnabled,
    token: axToken,
    nodeId: node.id,
    sourceSurface: 'mcp-app',
    iframeRef,
    jsonRpc: true,
  });

  const sessionMessage =
    node.data.sessionStatus === 'error'
      ? `Live session unavailable. Showing saved content. Reopen the app to restore interactivity.${node.data.sessionError ? ` (${node.data.sessionError})` : ''}`
      : 'Reconnecting saved app session…';

  const connect = (iframe: HTMLIFrameElement, reportFailure: () => void) => {
    let disposed = false;
    let resizeRaf = 0;
    let persistTimer = 0;
    let initialized = false;
    let inputSent = false;
    let lastSent: CallToolResult | undefined;
    let sending: Promise<void> | undefined;
    let finishBoot!: (ready: boolean) => void;
    const ready = new Promise<boolean>((resolve) => {
      finishBoot = resolve;
    });
    let bootTimer: ReturnType<typeof setTimeout>;
    const context = () => ({
      theme: canvasThemeScheme(canvasTheme.value),
      styles: hostStyles(),
      platform: 'web' as const,
      containerDimensions: resolveExtAppContainerDimensions(iframe, latest.current.size),
      displayMode: expanded ? ('fullscreen' as const) : ('inline' as const),
      locale: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(node.data.toolDefinition
        ? { toolInfo: { id: node.data.toolCallId as RequestId | undefined, tool: node.data.toolDefinition as Tool } }
        : {}),
    });
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
      { hostContext: context() },
    );
    const transport = new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!);
    const fail = (failure: unknown) => {
      if (disposed) return;
      clearTimeout(bootTimer);
      finishBoot(false);
      console.error('Ext-app connection failed', failure);
      reportFailure();
    };
    const flushToolResult = (): Promise<void> | undefined => {
      if (disposed || !inputSent) return;
      if (sending) return sending;
      const sendLatest = async () => {
        while (!disposed) {
          const result = latest.current.data.toolResult as CallToolResult | undefined;
          if (!result || (lastSent && extAppToolResultsMatch(lastSent, result))) return;
          await bridge.sendToolResult(result);
          lastSent = result;
        }
      };
      sending = sendLatest().finally(() => {
        sending = undefined;
      });
      return sending;
    };
    const sendContext = () => {
      if (disposed) return;
      iframe.contentWindow?.postMessage(
        surfaceNotification({ source: 'pmx-viewer-theme', token: axToken, variables: canvasVariables() }),
        '*',
      );
      if (!initialized) return;
      bridge.setHostContext(context());
      void Promise.resolve(bridge.sendHostContextChange(context())).catch(fail);
    };
    const boot = async () => {
      if (disposed || initialized) return;
      initialized = true;
      clearTimeout(bootTimer);
      sendContext();
      await bridge.sendToolInput({ arguments: (latest.current.data.toolInput as Record<string, unknown>) ?? {} });
      inputSent = true;
      await flushToolResult();
      if (disposed) return;
      finishBoot(true);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = requestAnimationFrame(sendContext);
      });
    };
    bridge.oninitialized = () => {
      void boot().catch(fail);
    };
    bridge.onsizechange = async ({ height }) => {
      const current = nodes.value.get(node.id);
      if (!current || current.data.userResized === true) return {};
      if (shouldApplyExtAppSizeChange(height, expanded || expandedNodeId.value === node.id)) {
        const next = Math.max(current.size.height, height + AUTO_FIT_TITLEBAR_HEIGHT);
        if (next - current.size.height > 8) {
          resizeNode(node.id, { width: current.size.width, height: next });
          clearTimeout(persistTimer);
          persistTimer = window.setTimeout(() => persistLayout({ recordHistory: false }), 0);
        }
      }
      return {};
    };
    bridge.onopenlink = async ({ url }) => {
      window.open(url, '_blank', 'noopener');
      return {};
    };
    bridge.onsandboxready = async () => {
      await bridge.sendSandboxResourceReady({
        html: documentHtml,
        sandbox: DEFAULT_EXT_APP_SANDBOX,
        ...(resourceMeta?.csp ? { csp: resourceMeta.csp } : {}),
        ...(resourceMeta?.permissions ? { permissions: resourceMeta.permissions } : {}),
      });
    };
    bridge.onrequestdisplaymode = async ({ mode }) => {
      const request = resolveExtAppDisplayModeRequest(mode, expanded);
      if (request.shouldExpand) expandNode(node.id);
      if (request.shouldCollapse) collapseExpandedNode();
      return { mode: request.nextMode };
    };
    bridge.oncalltool = async (params) => {
      if (!appSessionId) throw new Error(sessionMessage);
      return postJson<CallToolResult>('/api/ext-app/call-tool', {
        sessionId: appSessionId,
        nodeId: node.id,
        serverName: node.data.serverName,
        toolName: params.name,
        arguments: params.arguments ?? {},
      });
    };
    bridge.setRequestHandler(ListToolsRequestSchema, async () =>
      appSessionId ? postJson<ListToolsResult>('/api/ext-app/list-tools', { sessionId: appSessionId }) : { tools: [] },
    );
    bridge.onlistresources = async () =>
      appSessionId ? postJson('/api/ext-app/list-resources', { sessionId: appSessionId }) : { resources: [] };
    bridge.onlistresourcetemplates = async () =>
      appSessionId
        ? postJson('/api/ext-app/list-resource-templates', { sessionId: appSessionId })
        : { resourceTemplates: [] };
    bridge.onreadresource = async ({ uri }) => {
      if (!appSessionId) throw new Error(sessionMessage);
      return postJson('/api/ext-app/read-resource', { sessionId: appSessionId, uri });
    };
    bridge.onlistprompts = async () =>
      appSessionId ? postJson('/api/ext-app/list-prompts', { sessionId: appSessionId }) : { prompts: [] };
    bridge.onupdatemodelcontext = async (params) => {
      if (!appSessionId) return {};
      await postJson('/api/ext-app/model-context', {
        nodeId: node.id,
        ...(Array.isArray(params.content) ? { content: params.content } : {}),
        ...(params.structuredContent && typeof params.structuredContent === 'object'
          ? { structuredContent: params.structuredContent }
          : {}),
      });
      return {};
    };
    connections.current.set(iframe, {
      loaded: () => {
        // Some apps consume notifications without sending initialized. Start
        // their one bootstrap only after scripts loaded, never before listeners.
        if (!initialized)
          bootTimer = setTimeout(() => {
            void boot().catch(fail);
          }, 1200);
        return ready;
      },
      flush: () => {
        void flushToolResult()?.catch(fail);
      },
      theme: sendContext,
    });
    void bridge.connect(transport).catch(fail);
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(sendContext);
    });
    observer.observe(iframe);
    const unsubscribe = canvasTheme.subscribe(sendContext);
    return () => {
      disposed = true;
      clearTimeout(bootTimer);
      finishBoot(false);
      clearTimeout(persistTimer);
      cancelAnimationFrame(resizeRaf);
      observer.disconnect();
      unsubscribe();
      connections.current.delete(iframe);
      void bridge.close().catch(() => {});
    };
  };

  useEffect(() => {
    for (const connection of connections.current.values()) connection.flush();
  }, [node.data.toolResult]);

  return (
    <div class="ext-app-viewer">
      {node.data.sessionStatus && node.data.sessionStatus !== 'ready' && (
        <div class="ext-app-session-notice">⚠ {sessionMessage}</div>
      )}
      <RefreshingViewerFrame
        source={frameDocument}
        identity={JSON.stringify([node.id, node.data.serverName, appSessionId, node.data.sessionStatus])}
        iframeRef={iframeRef}
        onMount={connect}
        onDocumentLoad={async (frame, signal) => {
          const connection = connections.current.get(frame);
          if (!connection || !(await connection.loaded()) || signal.aborted) return false;
          connection.theme();
          return waitForViewerPaint(frame, axToken, signal, true);
        }}
        onOpen={expanded ? undefined : () => expandNode(node.id)}
        sandbox={DEFAULT_EXT_APP_SANDBOX}
        allow={buildAllowAttribute(resourceMeta?.permissions)}
        className="ext-app-frame"
        title={`Ext App: ${node.data.toolName ?? 'ext-app'}`}
      />
    </div>
  );
}
