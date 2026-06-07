import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ContextNode } from '../nodes/ContextNode';
import { FileNode } from '../nodes/FileNode';
import { LedgerNode } from '../nodes/LedgerNode';
import { MarkdownNode } from '../nodes/MarkdownNode';
import { McpAppNode } from '../nodes/McpAppNode';
import { StatusNode } from '../nodes/StatusNode';
import { ImageNode } from '../nodes/ImageNode';
import { WebpageNode } from '../nodes/WebpageNode';
import { HtmlNode, shouldShowPresentationControls } from '../nodes/HtmlNode';
import { canOpenAsSite, openNodeAsSite, openNodeInSystemBrowser } from '../nodes/surface-url';
import { PromptNode } from '../nodes/PromptNode';
import { ResponseNode } from '../nodes/ResponseNode';
import { TraceNode } from '../nodes/TraceNode';
import {
  collapseExpandedNode,
  contextPinnedNodeIds,
  expandedNodeId,
  nodes,
  pendingExpandedNodeCloseId,
  toggleContextPin,
} from '../state/canvas-store';
import { TYPE_LABELS } from '../types';
import type { CanvasNodeState } from '../types';

function renderContent(node: CanvasNodeState, expanded: boolean) {
  switch (node.type) {
    case 'markdown':
      return <MarkdownNode node={node} expanded={expanded} />;
    case 'mcp-app':
      return <McpAppNode node={node} expanded={expanded} />;
    case 'webpage':
      return <WebpageNode node={node} expanded={expanded} />;
    case 'json-render':
      return <McpAppNode node={node} expanded={expanded} />;
    case 'graph':
      return <McpAppNode node={node} expanded={expanded} />;
    case 'prompt':
      return <PromptNode node={node} />;
    case 'response':
      return <ResponseNode node={node} expanded={expanded} />;
    case 'status':
      return <StatusNode node={node} />;
    case 'context':
      return <ContextNode node={node} expanded={expanded} />;
    case 'ledger':
      return <LedgerNode node={node} />;
    case 'trace':
      return <TraceNode node={node} />;
    case 'file':
      return <FileNode node={node} expanded={expanded} />;
    case 'image':
      return <ImageNode node={node} expanded={expanded} />;
    case 'html':
      return <HtmlNode node={node} expanded={expanded} />;
    default:
      return <div>Unknown node type</div>;
  }
}

/** Extract plain text content from a node for word count / copy. */
function getNodeTextContent(node: CanvasNodeState): string {
  switch (node.type) {
    case 'markdown':
      return (node.data.content as string) || '';
    case 'file':
      return (node.data.fileContent as string) || '';
    case 'webpage':
      return (node.data.content as string) || '';
    case 'html':
      return (node.data.html as string) || (node.data.content as string) || '';
    case 'json-render':
    case 'graph':
      return JSON.stringify(node.data.spec ?? node.data.graphConfig ?? {}, null, 2);
    default:
      return '';
  }
}

function wordCount(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function isPresentationExitMessage(value: unknown, token: string): boolean {
  return value !== null &&
    typeof value === 'object' &&
    (value as { source?: unknown }).source === 'pmx-canvas-html-node' &&
    (value as { type?: unknown }).type === 'presentation-exit' &&
    (value as { token?: unknown }).token === token;
}

function isPresentationNavigationKey(key: string): boolean {
  return key === 'ArrowRight' || key === 'PageDown' || key === ' ' || key === 'ArrowLeft' || key === 'PageUp' || key === 'Home' || key === 'End';
}

function isPresentationExitButtonTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('.html-presentation-exit'));
}

export function ExpandedNodeOverlay() {
  const nodeId = expandedNodeId.value;
  const node = nodeId ? nodes.value.get(nodeId) : undefined;
  const [copied, setCopied] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [presentationExitToken, setPresentationExitToken] = useState('');
  const presentationOverlayRef = useRef<HTMLDivElement>(null);
  const presentationExitButtonRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(() => {
    setPresenting(false);
    collapseExpandedNode();
  }, []);

  const handlePresent = useCallback(() => {
    setPresentationExitToken(`presentation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    setPresenting(true);
  }, []);

  const postPresentationMessage = useCallback((message: Record<string, unknown>) => {
    const frame = document.querySelector<HTMLIFrameElement>('.html-presentation-overlay iframe.html-node-frame-presentation');
    frame?.contentWindow?.postMessage({
      source: 'pmx-canvas-html-node',
      token: presentationExitToken,
      ...message,
    }, '*');
  }, [presentationExitToken]);

  const handleExitPresentation = useCallback(() => {
    setPresenting(false);
  }, []);

  const handlePresentationKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setPresenting(false);
      return;
    }
    if (event.key === 'Tab' && !isPresentationExitButtonTarget(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      presentationExitButtonRef.current?.focus();
      return;
    }
    if ((event.key === ' ' || event.key === 'Enter') && isPresentationExitButtonTarget(event.target)) return;
    if (!isPresentationNavigationKey(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    postPresentationMessage({ type: 'presentation-key', key: event.key });
  }, [postPresentationMessage]);

  const handleBackdropPointerDown = useCallback((e: PointerEvent) => {
    if ((e.target as HTMLElement).classList.contains('expanded-overlay-backdrop')) {
      collapseExpandedNode();
    }
  }, []);

  const handleCopy = useCallback(() => {
    if (!node) return;
    const text = getNodeTextContent(node);
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [node]);

  const handleToggleCtxPin = useCallback(() => {
    if (!nodeId) return;
    toggleContextPin(nodeId);
  }, [nodeId]);

  useEffect(() => {
    setPresenting(false);
  }, [nodeId]);

  useLayoutEffect(() => {
    if (!presenting) return;
    const focusPresentationOverlay = () => {
      const overlay = presentationOverlayRef.current;
      if (!overlay || overlay.contains(document.activeElement)) return;
      overlay.focus();
    };
    const focusTimers = [0, 50, 150].map((delay) => window.setTimeout(focusPresentationOverlay, delay));
    const handleMessage = (event: MessageEvent) => {
      if (!isPresentationExitMessage(event.data, presentationExitToken)) return;
      setPresenting(false);
    };
    document.addEventListener('keydown', handlePresentationKeyDown, true);
    window.addEventListener('message', handleMessage);
    return () => {
      focusTimers.forEach((timer) => window.clearTimeout(timer));
      document.removeEventListener('keydown', handlePresentationKeyDown, true);
      window.removeEventListener('message', handleMessage);
    };
  }, [handlePresentationKeyDown, presentationExitToken, presenting]);

  if (!node) return null;

  const title =
    (node.data.title as string) ||
    (node.data.path as string)?.split('/').pop() ||
    TYPE_LABELS[node.type];
  const textContent = getNodeTextContent(node);
  const words = wordCount(textContent);
  const isCtxPinned = nodeId ? contextPinnedNodeIds.value.has(nodeId) : false;
  const hasText = textContent.length > 0;
  const pendingClose = pendingExpandedNodeCloseId.value === nodeId;
  const isEmbeddedViewer = node.type === 'mcp-app' || node.type === 'webpage' || node.type === 'json-render' || node.type === 'graph';
  const canPresent = shouldShowPresentationControls(node);

  return (
    <div
      class="expanded-overlay-backdrop"
      onPointerDown={handleBackdropPointerDown}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10001,
        background: 'rgba(10,14,30,0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        padding: '32px',
        pointerEvents: pendingClose ? 'none' : 'auto',
      }}
    >
      <div
        class="expanded-overlay-panel"
        style={{
          flex: 1,
          maxWidth: '1200px',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--c-panel)',
          border: `1px solid ${isCtxPinned ? 'var(--c-warn)' : 'var(--c-accent)'}`,
          borderRadius: 'var(--radius)',
          boxShadow: `0 0 0 1px ${isCtxPinned ? 'var(--c-warn)' : 'var(--c-accent)'}, 0 24px 80px rgba(0,0,0,0.6)`,
          overflow: 'hidden',
        }}
      >
        {/* Title bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 16px',
            background: 'var(--c-panel-glass)',
            borderBottom: '1px solid var(--c-line)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: '4px',
              background: 'var(--c-accent-12)',
              color: 'var(--c-accent)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {TYPE_LABELS[node.type]}
          </span>
          <span
            style={{
              flex: 1,
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--c-text)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </span>

          {/* Action buttons */}
          <div class="expanded-actions">
            {/* Context pin toggle */}
            <button
              type="button"
              class={`expanded-action-btn ${isCtxPinned ? 'expanded-action-active' : ''}`}
              onClick={handleToggleCtxPin}
              title={isCtxPinned ? 'Remove from context' : 'Pin as context'}
            >
              {isCtxPinned ? '\u2726 In context' : '\u2726 Pin as context'}
            </button>

            {/* Copy content */}
            {hasText && (
              <button
                type="button"
                class="expanded-action-btn"
                onClick={handleCopy}
                title="Copy content to clipboard"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            )}

            {canOpenAsSite(node) && (
              <button
                type="button"
                class="expanded-action-btn"
                onClick={() => openNodeAsSite(node)}
                title="Open as a full-page site in a new tab"
              >
                Open as site
              </button>
            )}

            {canOpenAsSite(node) && (
              <button
                type="button"
                class="expanded-action-btn"
                onClick={() => void openNodeInSystemBrowser(node)}
                title="Open in the system browser (e.g. Chrome) — useful when the host browser opens tabs in-place"
              >
                Open in system browser
              </button>
            )}

            {canPresent && (
              <button
                type="button"
                class="expanded-action-btn expanded-action-primary"
                onClick={handlePresent}
                title="Present this HTML node fullscreen"
              >
                Present
              </button>
            )}

            {/* Word count */}
            {words > 0 && (
              <span class="expanded-meta">
                {words.toLocaleString()} word{words !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          <span style={{ fontSize: '10px', color: pendingClose ? 'var(--c-warn)' : 'var(--c-muted)' }}>
            {pendingClose ? 'Saving edits...' : 'Esc to close'}
          </span>
          <button
            type="button"
            onClick={handleClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--c-muted)',
              cursor: 'pointer',
              padding: '2px 6px',
              fontSize: '16px',
              lineHeight: 1,
              borderRadius: '4px',
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.color = 'var(--c-text)';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.color = 'var(--c-muted)';
            }}
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        {/* Content area — full height */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '16px',
            minHeight: 0,
            ...(isEmbeddedViewer ? { display: 'flex', flexDirection: 'column' } : {}),
          }}
        >
          {isEmbeddedViewer ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              {renderContent(node, true)}
            </div>
          ) : renderContent(node, true)}
        </div>
        {canPresent && presenting && (
          <div ref={presentationOverlayRef} class="html-presentation-overlay" role="dialog" aria-modal="true" aria-label={`Present ${title}`} tabIndex={-1} onKeyDownCapture={handlePresentationKeyDown}>
            <button
              ref={presentationExitButtonRef}
              type="button"
              class="html-presentation-exit"
              onClick={handleExitPresentation}
              title="Exit presentation (Esc)"
              aria-label="Exit presentation"
            >
              Exit presentation
            </button>
            <div class="html-presentation-stage">
              <HtmlNode node={node} expanded presentation presentationExitToken={presentationExitToken} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
