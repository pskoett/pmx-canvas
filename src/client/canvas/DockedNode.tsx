import { ContextNode } from '../nodes/ContextNode';
import { LedgerNode } from '../nodes/LedgerNode';
import { StatusNode } from '../nodes/StatusNode';
import { StatusSummary } from '../nodes/StatusSummary';
import { attentionHistoryOpen, closeAttentionHistory } from '../state/attention-store';
import { toggleCollapsed, undockNode } from '../state/canvas-store';
import { TYPE_LABELS } from '../types';
import type { CanvasNodeState } from '../types';

function renderDockedContent(node: CanvasNodeState) {
  switch (node.type) {
    case 'status':
      return <StatusNode node={node} />;
    case 'ledger':
      return <LedgerNode node={node} />;
    case 'context':
      return <ContextNode node={node} />;
    default:
      return null;
  }
}

function getContextItemCount(node: CanvasNodeState): number {
  const cards = Array.isArray(node.data.cards) ? (node.data.cards as unknown[]) : [];
  const auxTabs = Array.isArray(node.data.auxTabs) ? (node.data.auxTabs as unknown[]) : [];
  return cards.length + auxTabs.length;
}

function ContextDockedNode({ node }: { node: CanvasNodeState }) {
  const count = getContextItemCount(node);
  const hasItems = count > 0;
  const collapsed = node.collapsed === true;

  const expand = () => {
    // Mutual exclusion with the Updates panel — only one side panel open at a
    // time. They share the same right-edge anchor, so opening both at once
    // would visually collide.
    closeAttentionHistory();
    toggleCollapsed(node.id);
  };

  // Hide the collapsed Context pill while the Updates side panel is open.
  // Mutual exclusion guarantees both panels can't be expanded simultaneously,
  // but the pill itself would otherwise sit beneath/beside the Updates panel
  // at the same right edge — better to hide until Updates is closed.
  if (collapsed && attentionHistoryOpen.value) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        class="context-dock-tab"
        data-docked-node="true"
        onClick={expand}
        aria-label={hasItems ? `Context — ${count} item${count === 1 ? '' : 's'}` : 'Context'}
        title={hasItems ? `${count} item${count === 1 ? '' : 's'} in agent context` : 'Agent context'}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
          <line x1="1.5" y1="6" x2="14.5" y2="6" />
          <circle cx="4" cy="4.25" r="0.6" fill="currentColor" stroke="none" />
        </svg>
        <span class="context-dock-tab-label">Context</span>
        {hasItems && (
          <span class="context-dock-tab-badge" aria-hidden="true">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
    );
  }

  return (
    <aside class="context-dock-panel" data-docked-node="true" aria-label="Agent context">
      <div class="context-dock-header">
        <div class="context-dock-header-text">
          <span class="context-dock-title">Context</span>
          <span class="context-dock-subtitle">
            {hasItems ? `${count} item${count === 1 ? '' : 's'} in agent context` : 'Active agent context'}
          </span>
        </div>
        <div class="context-dock-controls">
          <button
            type="button"
            class="context-dock-icon-button"
            onClick={(e) => {
              e.stopPropagation();
              undockNode(node.id);
            }}
            aria-label="Undock to canvas"
            title="Undock to canvas"
          >
            {'\u2299'}
          </button>
          <button
            type="button"
            class="context-dock-icon-button"
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapsed(node.id);
            }}
            aria-label="Collapse context panel"
            title="Collapse"
          >
            ×
          </button>
        </div>
      </div>
      <div class="context-dock-body">
        <ContextNode node={node} />
      </div>
    </aside>
  );
}

export function DockedNode({ node }: { node: CanvasNodeState }) {
  if (node.type === 'context') {
    return <ContextDockedNode node={node} />;
  }

  return (
    <div class="docked-node" data-docked-node="true">
      <div class="docked-node-header">
        <span class="node-type-badge">{TYPE_LABELS[node.type] ?? node.type}</span>
        {node.type === 'status' && node.collapsed && <StatusSummary node={node} />}
        <div class="docked-node-controls">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapsed(node.id);
            }}
            title={node.collapsed ? 'Expand' : 'Collapse'}
          >
            {node.collapsed ? '\u25B8' : '\u25BE'}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              undockNode(node.id);
            }}
            title="Undock to canvas"
          >
            {'\u2299'}
          </button>
        </div>
      </div>
      {!node.collapsed && (
        <div class="docked-node-body">{renderDockedContent(node)}</div>
      )}
    </div>
  );
}
