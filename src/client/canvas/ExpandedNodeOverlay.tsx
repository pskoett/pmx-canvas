import { useCallback, useState } from 'preact/hooks';
import { ContextNode } from '../nodes/ContextNode';
import { FileNode } from '../nodes/FileNode';
import { LedgerNode } from '../nodes/LedgerNode';
import { MarkdownNode } from '../nodes/MarkdownNode';
import { McpAppNode } from '../nodes/McpAppNode';
import { StatusNode } from '../nodes/StatusNode';
import { ImageNode } from '../nodes/ImageNode';
import { TraceNode } from '../nodes/TraceNode';
import {
  collapseExpandedNode,
  contextPinnedNodeIds,
  expandedNodeId,
  nodes,
  toggleContextPin,
} from '../state/canvas-store';
import { TYPE_LABELS } from '../types';
import type { CanvasNodeState } from '../types';

function renderContent(node: CanvasNodeState, expanded: boolean) {
  switch (node.type) {
    case 'markdown':
      return <MarkdownNode node={node} expanded={expanded} />;
    case 'mcp-app':
      return <McpAppNode node={node} />;
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
    default:
      return '';
  }
}

function wordCount(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

export function ExpandedNodeOverlay() {
  const nodeId = expandedNodeId.value;
  const node = nodeId ? nodes.value.get(nodeId) : undefined;
  const [copied, setCopied] = useState(false);

  const handleClose = useCallback(() => {
    collapseExpandedNode();
  }, []);

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

  if (!node) return null;

  const title =
    (node.data.title as string) ||
    (node.data.path as string)?.split('/').pop() ||
    TYPE_LABELS[node.type];
  const textContent = getNodeTextContent(node);
  const words = wordCount(textContent);
  const isCtxPinned = nodeId ? contextPinnedNodeIds.value.has(nodeId) : false;
  const hasText = textContent.length > 0;

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
            background: 'rgba(10,14,30,0.6)',
            borderBottom: '1px solid var(--c-line)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: '4px',
              background: 'rgba(70,182,255,0.12)',
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

            {/* Word count */}
            {words > 0 && (
              <span class="expanded-meta">
                {words.toLocaleString()} word{words !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          <span style={{ fontSize: '10px', color: 'var(--c-muted)' }}>Esc to close</span>
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
          }}
        >
          {renderContent(node, true)}
        </div>
      </div>
    </div>
  );
}
