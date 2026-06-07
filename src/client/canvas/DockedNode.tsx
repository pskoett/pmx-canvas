import { ContextNode } from '../nodes/ContextNode';
import { LedgerNode } from '../nodes/LedgerNode';
import { StatusNode } from '../nodes/StatusNode';
import { StatusSummary } from '../nodes/StatusSummary';
import { closeAttentionHistory } from '../state/attention-store';
import { getContextPinnedNodes, toggleCollapsed, undockNode } from '../state/canvas-store';
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
  const pinnedNodes = getContextPinnedNodes();
  const count = pinnedNodes.length > 0 ? pinnedNodes.length : getContextItemCount(node);
  const hasItems = count > 0;
  const collapsed = node.collapsed === true;

  const expand = () => {
    // Mutual exclusion with the Updates panel — only one side panel open at a
    // time. They share the same right-edge anchor, so opening both at once
    // would visually collide.
    closeAttentionHistory();
    toggleCollapsed(node.id);
  };

  if (collapsed) {
    // Collapsed = a menu-height pill in the right of the top HUD row, mirroring
    // the docked status widget on the left so the bar reads as one continuous menu.
    return (
      <div class="docked-node docked-node--collapsed" data-docked-node="true">
        <div class="docked-node-header">
          <span class="node-type-badge">Context</span>
          {hasItems && (
            <span class="docked-node-count" aria-hidden="true">
              {count > 99 ? '99+' : count}
            </span>
          )}
          <div class="docked-node-controls">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                expand();
              }}
              title={hasItems ? `${count} item${count === 1 ? '' : 's'} in agent context — expand` : 'Expand agent context'}
              aria-label={hasItems ? `Context — ${count} item${count === 1 ? '' : 's'}` : 'Expand agent context'}
            >
              {'▸'}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                undockNode(node.id);
              }}
              title="Undock to canvas"
              aria-label="Undock to canvas"
            >
              {'⊙'}
            </button>
          </div>
        </div>
      </div>
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
        <ContextNode node={node} pinnedNodes={pinnedNodes} />
      </div>
    </aside>
  );
}

export function DockedNode({ node }: { node: CanvasNodeState }) {
  if (node.type === 'context') {
    return <ContextDockedNode node={node} />;
  }

  return (
    <div class={`docked-node${node.collapsed ? ' docked-node--collapsed' : ''}`} data-docked-node="true">
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
