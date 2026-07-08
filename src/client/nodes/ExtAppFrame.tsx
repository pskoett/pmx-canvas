import type { CallToolResult, ListToolsResult, RequestId, Tool } from '@modelcontextprotocol/sdk/types.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AppBridge, PostMessageTransport, buildAllowAttribute } from '@modelcontextprotocol/ext-apps/app-bridge';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { extAppToolResultsMatch } from '../../shared/ext-app-tool-result.js';
import { DEFAULT_EXT_APP_SANDBOX } from '../../shared/surface.js';
import { submitAxInteractionFromClient } from '../state/intent-bridge';
import { showToast } from '../state/attention-bridge';
import {
  canvasTheme,
  collapseExpandedNode,
  expandNode,
  expandedNodeId,
  nodes,
  persistLayout,
  resizeNode,
} from '../state/canvas-store';
import type { CanvasNodeState } from '../types';
import { AUTO_FIT_TITLEBAR_HEIGHT } from '../canvas/auto-fit';
import { useIframeDocument } from './iframe-document-url';

type McpUiTheme = 'light' | 'dark';

type ExtAppBridgeNotifications = Pick<AppBridge, 'sendToolInput' | 'sendToolResult'>;
type DisplayMode = 'inline' | 'fullscreen' | 'pip';
type ExtAppFrameStatus = 'loading' | 'ready' | 'done';

interface ExtAppHostDimensionsTarget {
  clientWidth?: number;
  clientHeight?: number;
  getBoundingClientRect(): Pick<DOMRectReadOnly, 'width' | 'height'>;
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as {
    ok: boolean;
    result?: T;
    error?: string;
  };
  if (!json.ok) throw new Error(json.error ?? `Request failed: ${url}`);
  return json.result as T;
}

/**
 * Finding F (0.2.4): detect a WebKit-only host — Safari or a WKWebView (e.g. the
 * GitHub Copilot app's embedded panel). Blink engines (Chrome / Chromium / Edge /
 * the Codex browser, all of which carry a Chrome/Chromium/CriOS/Edg token) and
 * Android WebView are excluded, as is Gecko (no `AppleWebKit`). Used to gate the
 * one-time ext-app iframe repaint remount to the only engine that exhibits the
 * present-at-load black-tile paint race, so the remount is a strict no-op
 * everywhere we can test (Chrome / Codex / Playwright).
 */
export function isWebKitOnlyHost(userAgent: string): boolean {
  return /AppleWebKit/.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|Android/.test(userAgent);
}

// Finding F (0.2.5, reworked 0.3.1): BOOT-AWARE serialized WebKit remount queue.
// The black tile is a cold-hydration BURST problem — a single ext-app repaints fine
// into an idle panel (like a live-created node, or expand+close), but several
// compositing at once overwhelm WebKit and all stay black. The 0.2.5 fixed-stagger
// slots (450ms apart) were NOT boot-aware: each recovery remount reboots the app
// (~1-2s for Excalidraw), so N staggered remounts overlapped into a fresh burst and
// the per-node one-shot flag was spent — exactly the multi-app reload blackout the
// 0.3.1 report shows. This queue runs remounts strictly one at a time: each entry
// performs its remount, then waits for that app's GENUINE initialized handshake
// (or a bounded timeout for an app that never boots) plus a settle delay before the
// next entry fires — so every remount lands in an idle panel, which is the
// empirically always-successful recovery (what expand+close does manually).
// Settle covers the scene DRAW: the app's initialized handshake fires before the
// replayed tool result arrives and the scene is painted, so the queue waits for the
// settled signal (bootstrap chain incl. tool-result send complete) plus this pause.
export const WEBKIT_REMOUNT_SETTLE_MS = 1000;
const WEBKIT_BOOT_TIMEOUT_MS = 7000;

export interface WebkitRemountTask {
  /** Perform the remount. Return false if the node no longer needs it (skips the boot wait). */
  remount: () => boolean;
  /** Resolves when the remounted app genuinely boots AND finishes its bootstrap replay, or after a bounded timeout. */
  awaitBoot: () => Promise<void>;
}

// Bounded recovery trail readable via `webview evaluate` / devtools
// (window.__PMX_EXTAPP_LOG). The WebKit compositor dropout is otherwise
// unobservable from page JS — this is the only diagnostic surface.
export function extAppRecoveryLog(nodeId: string, event: string): void {
  if (typeof window === 'undefined') return;
  const host = window as unknown as { __PMX_EXTAPP_LOG?: Array<{ t: number; nodeId: string; event: string }> };
  host.__PMX_EXTAPP_LOG ??= [];
  if (host.__PMX_EXTAPP_LOG.length < 500) host.__PMX_EXTAPP_LOG.push({ t: Date.now(), nodeId, event });
}

let webkitRemountChain: Promise<void> = Promise.resolve();
export function enqueueWebkitRemount(task: WebkitRemountTask): void {
  webkitRemountChain = webkitRemountChain
    .then(async () => {
      if (!task.remount()) return;
      await task.awaitBoot();
      await new Promise((resolve) => setTimeout(resolve, WEBKIT_REMOUNT_SETTLE_MS));
    })
    .catch(() => {});
}

export function shouldScheduleWebKitRepaint(status: ExtAppFrameStatus, hasReplayToolResult: boolean): boolean {
  return hasReplayToolResult ? status === 'done' : status === 'ready' || status === 'done';
}

export function getExtAppBridgeInitKey(node: CanvasNodeState, retryKey: number): string {
  const html = typeof node.data.html === 'string' ? node.data.html : '';
  const serverName = typeof node.data.serverName === 'string' ? node.data.serverName : '';
  const appSessionId = typeof node.data.appSessionId === 'string' ? node.data.appSessionId : '';
  const sessionStatus = typeof node.data.sessionStatus === 'string' ? node.data.sessionStatus : '';
  return `${node.id}:${retryKey}:${serverName}:${appSessionId}:${sessionStatus}:${html}`;
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
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : DEFAULT_EXT_APP_SANDBOX;
}

export function buildExtAppAxBridgeScript(axToken: string, nodeId: string): string {
  return `<script data-pmx-canvas-ax-bridge>
(function () {
  const PMX_AX_TOKEN = ${JSON.stringify(axToken)};
  const PMX_AX_NODE_ID = ${JSON.stringify(nodeId)};
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
      window.parent.postMessage({
        source: 'pmx-canvas-ax',
        token: PMX_AX_TOKEN,
        nodeId: PMX_AX_NODE_ID,
        correlationId: correlationId,
        interaction: { type: String(type), payload: payload && typeof payload === 'object' ? payload : {} },
      }, '*');
    });
  };
  window.PMX_AX.on = function (eventType, cb) {
    if (eventType === 'ack' && typeof cb === 'function') ackListeners.push(cb);
  };
  window.addEventListener('message', function (event) {
    const m = event.data;
    if (!m || m.source !== 'pmx-canvas-ax-ack' || m.token !== PMX_AX_TOKEN) return;
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

export function injectExtAppAxBridgeScript(html: string, axBridgeScript: string): string {
  if (!axBridgeScript) return html;
  const headMatch = /<head\b[^>]*>/i.exec(html);
  if (headMatch?.index !== undefined) {
    const insertAt = headMatch.index + headMatch[0].length;
    return `${html.slice(0, insertAt)}${axBridgeScript}${html.slice(insertAt)}`;
  }
  const bodyMatch = /<body\b[^>]*>/i.exec(html);
  if (bodyMatch?.index !== undefined) {
    const insertAt = bodyMatch.index + bodyMatch[0].length;
    return `${html.slice(0, insertAt)}${axBridgeScript}${html.slice(insertAt)}`;
  }
  return `${axBridgeScript}${html}`;
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
    width: positiveDimension(target?.clientWidth ?? 0, positiveDimension(rect?.width ?? 0, fallback.width)),
    height: positiveDimension(target?.clientHeight ?? 0, positiveDimension(rect?.height ?? 0, fallback.height)),
  };
}

export function shouldApplyExtAppSizeChange(height: unknown, isExpanded: boolean): height is number {
  return typeof height === 'number' && Number.isFinite(height) && height > 0 && !isExpanded;
}

export function resolveExtAppInlineFrameHeight(appHeight: number, hostHeight: number): number {
  return Math.max(positiveDimension(appHeight, 1), positiveDimension(hostHeight, 1));
}

export function ExtAppFrame({ node, expanded = false }: { node: CanvasNodeState; expanded?: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const transportRef = useRef<PostMessageTransport | null>(null);
  const sizePersistTimerRef = useRef<number | null>(null);
  const latestToolInputRef = useRef<Record<string, unknown>>({});
  const latestToolResultRef = useRef<CallToolResult | undefined>(undefined);
  const toolResultSentRef = useRef(false);
  const lastSentToolResultRef = useRef<CallToolResult | undefined>(undefined);
  const toolResultSendingRef = useRef<Promise<void> | null>(null);
  const bridgeReadyRef = useRef(false);
  const themeUnsubRef = useRef<(() => void) | null>(null);
  const webkitRepaintDoneRef = useRef(false);
  const webkitRemountAttemptsRef = useRef(0);
  // Genuine boot signal: set ONLY when the app completes the ui/initialize
  // handshake (bridge.oninitialized) — NOT by the 1200ms bootstrap fallback,
  // which flips status via notifications that resolve even into a dead iframe.
  const appInitializedRef = useRef(false);
  const bootWaitersRef = useRef<Array<() => void>>([]);
  const remountQueuedRef = useRef(false);
  const unmountedRef = useRef(false);
  const [status, setStatus] = useState<ExtAppFrameStatus>('loading');
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
  const resourceMeta = node.data.resourceMeta as
    | {
        csp?: Record<string, unknown>;
        permissions?: Record<string, unknown>;
      }
    | undefined;
  const sessionStatus = node.data.sessionStatus as string | undefined;
  const sessionError = node.data.sessionError as string | undefined;
  const maxHeight = node.size.height;
  const nodeId = node.id;
  const frameKey = getExtAppBridgeInitKey(node, retryKey);
  const hasReplayToolResult = toolResult != null;
  const iframeSandbox = resolveExtAppSandbox(null);
  // Phase 6 — opt-in ext-app AX bridge. When the node sets data.axCapabilities.enabled,
  // inject window.PMX_AX into the app HTML and accept emits below (server re-validates).
  const axCaps = node.data.axCapabilities as { enabled?: boolean } | undefined;
  const axEnabled = axCaps?.enabled === true && typeof html === 'string' && html.length > 0;
  const axToken = useMemo(() => `ax-${crypto.randomUUID()}`, []);
  const axBridgeScript = axEnabled ? buildExtAppAxBridgeScript(axToken, nodeId) : '';
  const iframeDocument = useIframeDocument(injectExtAppAxBridgeScript(html ?? '', axBridgeScript), iframeSandbox);

  useEffect(() => {
    if (!axEnabled) return;
    function onAxMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as {
        source?: string;
        token?: string;
        nodeId?: string;
        correlationId?: string;
        interaction?: { type?: unknown; payload?: unknown };
      } | null;
      if (!data || data.source !== 'pmx-canvas-ax' || data.token !== axToken || data.nodeId !== nodeId) return;
      const interaction = data.interaction;
      if (!interaction || typeof interaction.type !== 'string') return;
      const interactionType = interaction.type;
      void submitAxInteractionFromClient({
        type: interactionType,
        sourceNodeId: nodeId,
        sourceSurface: 'mcp-app',
        ...(interaction.payload && typeof interaction.payload === 'object'
          ? { payload: interaction.payload as Record<string, unknown> }
          : {}),
      }).then((res) => {
        if (res.ok) showToast('context', 'AX interaction', interactionType, [nodeId]);
        else showToast('remove', 'AX interaction rejected', res.error ?? res.code ?? '', [nodeId]);
        iframeRef.current?.contentWindow?.postMessage(
          {
            source: 'pmx-canvas-ax-ack',
            token: axToken,
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
  }, [axEnabled, axToken, nodeId]);

  // Enqueue one serialized remount attempt for this node (Finding F recovery).
  // Attempts are capped so a persistently-failing app degrades to the manual
  // fallback (expand+close / Retry) instead of remount-looping forever.
  const WEBKIT_MAX_REMOUNT_ATTEMPTS = 3;
  const scheduleWebkitRemount = (reason: string): void => {
    if (webkitRemountAttemptsRef.current >= WEBKIT_MAX_REMOUNT_ATTEMPTS) {
      extAppRecoveryLog(nodeId, `remount-cap-hit (${reason})`);
      return;
    }
    if (remountQueuedRef.current) return; // an attempt is already queued and has not run yet
    webkitRemountAttemptsRef.current += 1;
    remountQueuedRef.current = true;
    extAppRecoveryLog(nodeId, `remount-queued #${webkitRemountAttemptsRef.current} (${reason})`);
    enqueueWebkitRemount({
      remount: () => {
        remountQueuedRef.current = false;
        if (unmountedRef.current || expandedNodeId.value === nodeId) {
          extAppRecoveryLog(nodeId, 'remount-skipped');
          return false;
        }
        extAppRecoveryLog(nodeId, `remount-run #${webkitRemountAttemptsRef.current}`);
        setRetryKey((k) => k + 1);
        return true;
      },
      awaitBoot: () =>
        new Promise<void>((resolve) => {
          const timer = window.setTimeout(finish, WEBKIT_BOOT_TIMEOUT_MS);
          function finish() {
            window.clearTimeout(timer);
            resolve();
          }
          bootWaitersRef.current.push(finish);
        }),
    });
  };

  // Finding F (0.2.4/0.2.5, reworked 0.3.1): in a WebKit host panel (e.g. the GitHub
  // Copilot app's WKWebView, and Bun's headless WebKit WebView) the doubly-nested
  // ext-app iframe (workbench iframe → mcp-app.html iframe) can come up as a black
  // tile for nodes present at panel-load. The mcp-app shell loads blank, then the app
  // boots over the bridge and draws its content AFTER load; under a cold-hydration
  // burst WebKit does not composite that late draw, so the layer stays black (clean
  // in Blink, and clean for a node created live into an already-idle panel). A
  // parent-side transform/src nudge does NOT repair a black layer — only a full
  // remount (new iframe element + bridge re-init, what expand+close does) does, and
  // only when it lands in an idle moment. So: once the app has booted — `ready` for
  // empty apps, `done` for restored apps that must replay saved tool output — under
  // WebKit only, enqueue ONE recovery remount through the boot-aware queue above, so
  // concurrent ext-apps remount strictly one at a time instead of re-bursting.
  // Strict no-op in Blink/Gecko; the e2e engine is unaffected. Inline instance only.
  useEffect(() => {
    if (expanded || webkitRepaintDoneRef.current) return;
    if (!shouldScheduleWebKitRepaint(status, hasReplayToolResult)) return;
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return;
    if (!isWebKitOnlyHost(navigator.userAgent)) return;
    webkitRepaintDoneRef.current = true;
    scheduleWebkitRemount('post-boot-repaint');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, hasReplayToolResult]);

  // Never-booted watchdog (0.3.1): an iframe whose scripts never ran in the burst
  // shows no error — the bootstrap fallback flips status via notifications that
  // resolve into a dead window, so the tile just stays black. If the CURRENT frame
  // has not completed the genuine initialize handshake within the watchdog window,
  // retry it through the same serialized queue (bounded by the shared attempt cap).
  const WEBKIT_BOOT_WATCHDOG_MS = 6000;
  useEffect(() => {
    if (expanded) return;
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return;
    if (!isWebKitOnlyHost(navigator.userAgent)) return;
    if (!iframeDocument.ready) return;
    const timer = window.setTimeout(() => {
      if (appInitializedRef.current || unmountedRef.current) return;
      scheduleWebkitRemount('boot-watchdog');
    }, WEBKIT_BOOT_WATCHDOG_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey, iframeDocument.ready, expanded]);

  useEffect(
    () => () => {
      unmountedRef.current = true;
      for (const waiter of bootWaitersRef.current.splice(0)) waiter();
    },
    [],
  );

  const toMcpTheme = (theme: string): McpUiTheme => (theme === 'light' ? 'light' : 'dark');
  const isExpanded = expanded || expandedNodeId.value === nodeId;

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
    if (lastSentToolResultRef.current && extAppToolResultsMatch(lastSentToolResultRef.current, pendingToolResult)) {
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

  // Initialize as soon as HTML is mounted; some apps send initialize before iframe load fires.
  useEffect(() => {
    if (!html || !iframeDocument.ready) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    let disposed = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let hostContextResizeObserver: ResizeObserver | null = null;
    let hostContextRaf: number | null = null;
    let readyNudgeRaf: number | null = null;
    toolResultSentRef.current = false;
    lastSentToolResultRef.current = undefined;
    toolResultSendingRef.current = null;
    bridgeReadyRef.current = false;
    // New frame = new boot attempt: the genuine-initialized signal belongs to the
    // CURRENT iframe. The queue's awaitBoot waits on this frame's handshake.
    appInitializedRef.current = false;

    const clearFallbackTimer = (): void => {
      if (!fallbackTimer) return;
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    };

    const init = async () => {
      if (!html) return;
      const contentWindow = iframe.contentWindow;
      if (!contentWindow) {
        throw new Error('Ext-app iframe window is unavailable');
      }

      const buildHostContext = (
        displayMode: DisplayMode = expandedNodeId.value === nodeId ? 'fullscreen' : 'inline',
      ) => ({
        theme: toMcpTheme(canvasTheme.value),
        platform: 'web' as const,
        containerDimensions: resolveExtAppContainerDimensions(iframe, {
          width: node.size.width,
          height: maxHeight,
        }),
        displayMode,
        locale: navigator.language,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(toolDefinition
          ? {
              toolInfo: {
                id: toolCallId,
                tool: toolDefinition,
              },
            }
          : {}),
      });

      const scheduleHostContextUpdate = () => {
        if (hostContextRaf !== null) return;
        hostContextRaf = requestAnimationFrame(() => {
          hostContextRaf = null;
          if (disposed || !bridgeReadyRef.current) return;
          bridge.setHostContext?.(buildHostContext());
        });
      };

      // Re-deliver host context once the iframe has been laid out and painted.
      // Canvas-backed widgets (e.g. Excalidraw) size their drawing surface from
      // containerDimensions at first render; the single handshake-time delivery
      // can land before the embedded frame has settled, leaving a black canvas
      // until an expand/collapse forces a reflow. A double rAF lands after
      // layout+paint, and sendHostContextChange always delivers (setHostContext
      // would diff-suppress the identical context just sent at handshake).
      const nudgeHostContextAfterLayout = () => {
        if (readyNudgeRaf !== null) return;
        readyNudgeRaf = requestAnimationFrame(() => {
          readyNudgeRaf = requestAnimationFrame(() => {
            readyNudgeRaf = null;
            if (disposed || !bridgeReadyRef.current) return;
            void bridge.sendHostContextChange?.(buildHostContext());
          });
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
          const hostDimensions = resolveExtAppContainerDimensions(iframe.parentElement ?? iframe, {
            width: node.size.width,
            height: maxHeight,
          });
          const inlineFrameHeight = resolveExtAppInlineFrameHeight(height, hostDimensions.height);
          iframe.style.height = `${inlineFrameHeight}px`;
          const currentSize = nodes.value.get(nodeId)?.size ?? node.size;
          const nodeHeight = Math.max(currentSize.height, inlineFrameHeight + AUTO_FIT_TITLEBAR_HEIGHT);
          if (Math.abs(nodeHeight - currentSize.height) > 8) {
            resizeNode(nodeId, { width: currentSize.width, height: nodeHeight });
            if (sizePersistTimerRef.current !== null) {
              window.clearTimeout(sizePersistTimerRef.current);
            }
            sizePersistTimerRef.current = window.setTimeout(() => {
              persistLayout({ recordHistory: false });
              sizePersistTimerRef.current = null;
            }, 0);
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
        appInitializedRef.current = true;
        extAppRecoveryLog(nodeId, 'initialized');
        setStatus('ready');
        setError(null);
        void Promise.resolve(bridge.sendHostContextChange(buildHostContext(isExpanded ? 'fullscreen' : 'inline')))
          .then(() => sendExtAppBootstrapState(bridge, latestToolInputRef.current, undefined))
          .then(() => flushToolResult(bridge))
          .then(() => {
            // Settled: handshake + bootstrap replay delivered — the app draws its
            // scene right after this. Release the remount queue (which then adds
            // its own settle pause covering the draw) only from this genuine path;
            // the bootstrap fallback never releases it (a dead iframe must run the
            // queue's bounded timeout instead of green-lighting the next remount).
            extAppRecoveryLog(nodeId, 'settled');
            for (const waiter of bootWaitersRef.current.splice(0)) waiter();
            nudgeHostContextAfterLayout();
          })
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
        const hostContext = buildHostContext(isExpanded ? 'fullscreen' : 'inline');
        bridgeReadyRef.current = true;
        bridge.setHostContext?.(hostContext);
        void Promise.resolve(bridge.sendHostContextChange(hostContext))
          .then(() => sendExtAppBootstrapState(bridge, latestToolInputRef.current, bootstrapToolResult))
          .then(() => {
            toolResultSentRef.current = Boolean(bootstrapToolResult);
            if (bootstrapToolResult) {
              lastSentToolResultRef.current = bootstrapToolResult;
            }
            setStatus(bootstrapToolResult ? 'done' : 'ready');
            setError(null);
            nudgeHostContextAfterLayout();
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
        if (firstFire) {
          firstFire = false;
          return;
        }
        if (disposed) return;
        bridge.setHostContext?.({
          ...buildHostContext(),
          theme: toMcpTheme(newTheme),
        });
        void bridge.sendHostContextChange?.(buildHostContext());
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
      if (readyNudgeRaf !== null) {
        cancelAnimationFrame(readyNudgeRaf);
        readyNudgeRaf = null;
      }
      bridgeReadyRef.current = false;
      toolResultSendingRef.current = null;
      themeUnsubRef.current?.();
      themeUnsubRef.current = null;
      if (sizePersistTimerRef.current !== null) {
        window.clearTimeout(sizePersistTimerRef.current);
        sizePersistTimerRef.current = null;
      }
      bridgeRef.current = null;
      if (transportRef.current) {
        transportRef.current.close().catch((closeError) => {
          console.error('[ext-app] transport close failed:', closeError);
        });
        transportRef.current = null;
      }
    };
  }, [frameKey, iframeDocument.key]);

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
    if (iframeRef.current) {
      iframeRef.current.style.height = '100%';
    }
    if (!bridge || !bridgeReadyRef.current) return undefined;
    // Measure + send AFTER the expand/collapse overlay has laid out (double rAF).
    // Measuring synchronously here reads the iframe at its OLD inline size, so an app
    // like Excalidraw reflows bound text against stale dimensions and clips the start
    // of labels in expanded mode (report #62). A double rAF lands after layout+paint so
    // resolveExtAppContainerDimensions reads the real expanded frame.
    let raf1: number | null = null;
    let raf2: number | null = null;
    raf1 = requestAnimationFrame(() => {
      raf1 = null;
      raf2 = requestAnimationFrame(() => {
        raf2 = null;
        if (!bridgeReadyRef.current) return;
        const hostContext = {
          theme: toMcpTheme(canvasTheme.value),
          platform: 'web' as const,
          containerDimensions: resolveExtAppContainerDimensions(iframeRef.current, {
            width: node.size.width,
            height: maxHeight,
          }),
          displayMode: isExpanded ? ('fullscreen' as const) : ('inline' as const),
          locale: navigator.language,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
        bridge.setHostContext?.(hostContext);
        void bridge.sendHostContextChange?.(hostContext);
      });
    });
    return () => {
      if (raf1 !== null) cancelAnimationFrame(raf1);
      if (raf2 !== null) cancelAnimationFrame(raf2);
    };
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
    <div
      style={{
        flex: 1,
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
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
        <div style={{ padding: '8px', fontSize: '11px', color: 'var(--c-muted)' }}>Connecting to ext-app viewer...</div>
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
          {...iframeDocument.attributes}
          sandbox={iframeSandbox}
          allow={buildAllowAttribute(resourceMeta?.permissions)}
          // NB: do NOT add the `.mcp-app-frame` GPU-layer class (translateZ(0)) here —
          // it creates a stacking context that breaks the AX emit→ack round-trip in the
          // expanded ext-app overlay (#55 e2e); the post-boot WebKit repaint remount
          // below recovers a single present-at-load ext-app without it (Finding F).
          style={{
            flex: 1,
            width: '100%',
            height: '100%',
            minHeight: 0,
            border: 'none',
            background: 'var(--c-panel)',
            pointerEvents: isExpanded && status !== 'loading' ? 'auto' : 'none',
          }}
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
              top: 0,
              right: '56px',
              bottom: '56px',
              left: 0,
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
