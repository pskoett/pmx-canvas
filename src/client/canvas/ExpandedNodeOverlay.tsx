import { HTML_SURFACE_PUSH_SOURCE } from '../../shared/ax-surface-protocol.js';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ContextNode } from '../nodes/ContextNode';
import { DiffNode } from '../nodes/DiffNode';
import { FileNode } from '../nodes/FileNode';
import { LedgerNode } from '../nodes/LedgerNode';
import { MarkdownNode } from '../nodes/MarkdownNode';
import { MermaidNode } from '../nodes/MermaidNode';
import { McpAppNode } from '../nodes/McpAppNode';
import { StatusNode } from '../nodes/StatusNode';
import { ImageNode } from '../nodes/ImageNode';
import { WebpageNode } from '../nodes/WebpageNode';
import { HtmlNode, shouldShowPresentationControls } from '../nodes/HtmlNode';
import { canOpenAsSite, openNodeAsSite } from '../nodes/surface-url';
import { PromptNode } from '../nodes/PromptNode';
import { AxStepControls } from '../nodes/AxStepControls';
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
import { getNodeIcon } from '../icons';
import { useFocusTrap } from './use-focus-trap';
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
    case 'diff':
      return <DiffNode node={node} />;
    case 'mermaid':
      return <MermaidNode node={node} expanded={expanded} />;
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
    case 'diff':
      return (node.data.content as string) || '';
    case 'mermaid':
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
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { source?: unknown }).source === HTML_SURFACE_PUSH_SOURCE &&
    (value as { type?: unknown }).type === 'presentation-exit' &&
    (value as { token?: unknown }).token === token
  );
}

function isPresentationNavigationKey(key: string): boolean {
  return (
    key === 'ArrowRight' ||
    key === 'PageDown' ||
    key === ' ' ||
    key === 'ArrowLeft' ||
    key === 'PageUp' ||
    key === 'Home' ||
    key === 'End'
  );
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

  const postPresentationMessage = useCallback(
    (message: Record<string, unknown>) => {
      const frame = document.querySelector<HTMLIFrameElement>(
        '.html-presentation-overlay iframe.html-node-frame-presentation',
      );
      frame?.contentWindow?.postMessage(
        {
          source: HTML_SURFACE_PUSH_SOURCE,
          token: presentationExitToken,
          ...message,
        },
        '*',
      );
    },
    [presentationExitToken],
  );

  const handleExitPresentation = useCallback(() => {
    setPresenting(false);
  }, []);

  const handlePresentationKeyDown = useCallback(
    (event: KeyboardEvent) => {
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
    },
    [postPresentationMessage],
  );

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
      focusTimers.forEach((timer) => {
        window.clearTimeout(timer);
      });
      document.removeEventListener('keydown', handlePresentationKeyDown, true);
      window.removeEventListener('message', handleMessage);
    };
  }, [handlePresentationKeyDown, presentationExitToken, presenting]);

  // Focus trap (item 18): restore to the node this overlay opened from — its
  // world element is unmounted while expanded and remounted on close.
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreToNode = useCallback(
    () => (nodeId ? document.querySelector<HTMLElement>(`.canvas-node[data-node-id="${CSS.escape(nodeId)}"]`) : null),
    [nodeId],
  );
  useFocusTrap(panelRef, node !== undefined, { restoreTo: restoreToNode });

  if (!node) return null;

  const title = (node.data.title as string) || (node.data.path as string)?.split('/').pop() || TYPE_LABELS[node.type];
  const textContent = getNodeTextContent(node);
  const words = wordCount(textContent);
  const isCtxPinned = nodeId ? contextPinnedNodeIds.value.has(nodeId) : false;
  const hasText = textContent.length > 0;
  const pendingClose = pendingExpandedNodeCloseId.value === nodeId;
  const isEmbeddedViewer =
    node.type === 'mcp-app' || node.type === 'webpage' || node.type === 'json-render' || node.type === 'graph';
  const canPresent = shouldShowPresentationControls(node);

  const NodeIcon = getNodeIcon(node.type);
  const provenance =
    node.data.provenance && typeof node.data.provenance === 'object'
      ? (node.data.provenance as { sourceKind?: string; sourceUri?: string; syncedAt?: string })
      : null;
  const provenanceLabel = provenance
    ? [
        provenance.sourceKind,
        provenance.sourceUri,
        provenance.syncedAt ? `synced ${provenance.syncedAt.slice(11, 16)}` : null,
      ]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
        .join(' · ')
    : null;

  return (
    <div
      class="expanded-overlay-backdrop"
      onPointerDown={handleBackdropPointerDown}
      style={{ pointerEvents: pendingClose ? 'none' : 'auto' }}
    >
      <div
        ref={panelRef}
        class={`expanded-overlay-panel${isCtxPinned ? ' is-pinned' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="expanded-node"
      >
        {/* Header: kind icon · title · kind pill · pin state · actions · close */}
        <div class="expanded-header">
          <span class="expanded-kind-icon" aria-hidden="true">
            <NodeIcon size={15} />
          </span>
          <span class="expanded-title">{title}</span>
          <span class="expanded-kind-pill">{TYPE_LABELS[node.type]}</span>
          <button
            type="button"
            class={`expanded-pin${isCtxPinned ? ' is-on' : ''}`}
            onClick={handleToggleCtxPin}
            title={isCtxPinned ? 'In agent context — click to unpin' : 'Pin as agent context'}
            aria-pressed={isCtxPinned}
          >
            ✦
          </button>
          <span class="expanded-spacer" />
          <div class="expanded-actions">
            {hasText && (
              <button type="button" class="expanded-action-btn" onClick={handleCopy} title="Copy content to clipboard">
                {copied ? 'Copied!' : 'Copy'}
              </button>
            )}
            {canOpenAsSite(node) && (
              <button
                type="button"
                class="expanded-action-btn"
                onClick={() => void openNodeAsSite(node)}
                title="Open as a full-page site in the system browser"
              >
                Open in tab ↗
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
          </div>
          <button type="button" class="expanded-close" onClick={handleClose} title="Close (Esc)" aria-label="Close">
            ×
          </button>
        </div>

        {/* Body: the surface at full size */}
        <div class={`expanded-body${isEmbeddedViewer ? ' is-embedded' : ''}`}>
          {isEmbeddedViewer ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>{renderContent(node, true)}</div>
          ) : (
            renderContent(node, true)
          )}
        </div>
        {/* AX step controls follow the node into focus mode. Without this,
            expanding a materialized flow step showed only its text — the
            Start/Done/Blocked and loop controls live in CanvasNode's body,
            which the overlay does not render. */}
        {/* Here the dock is a SIBLING of the padded content area, so it is
            already flush with the panel: no bleed, and 16px of its own padding
            to line its labels up with the content above. */}
        <div style={{ '--ax-dock-bleed': '0px', '--ax-dock-pad': '16px' } as Record<string, string>}>
          <AxStepControls node={node} />
        </div>
        {/* Footer strip: provenance + how to close */}
        <div class="expanded-footer">
          <span class="expanded-footer-meta">
            {[provenanceLabel, words > 0 ? `${words.toLocaleString()} word${words !== 1 ? 's' : ''}` : null]
              .filter(Boolean)
              .join(' · ') || TYPE_LABELS[node.type].toLowerCase()}
          </span>
          <span class="expanded-spacer" />
          <span class={`expanded-footer-hint${pendingClose ? ' is-saving' : ''}`}>
            {pendingClose ? 'Saving edits…' : 'esc or click outside to close'}
          </span>
        </div>
        {canPresent && presenting && (
          <div
            ref={presentationOverlayRef}
            class="html-presentation-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={`Present ${title}`}
            tabIndex={-1}
            onKeyDownCapture={handlePresentationKeyDown}
          >
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
