import { ContextNode } from '../nodes/ContextNode';
import { LedgerNode } from '../nodes/LedgerNode';
import { StatusNode } from '../nodes/StatusNode';
import { StatusSummary } from '../nodes/StatusSummary';
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

export function DockedNode({ node }: { node: CanvasNodeState }) {
  return (
    <div class="docked-node">
      <div class="docked-node-header">
        <span class="node-type-badge">{TYPE_LABELS[node.type] ?? node.type}</span>
        {node.type === 'status' && node.collapsed && <StatusSummary node={node} />}
        {node.type === 'context' && node.collapsed && (
          <span style={{ fontSize: '11px', color: 'var(--c-muted)' }}>
            Active Agent Context
            {typeof node.data.utilization === 'number' && (
              <> · {Math.round(Number(node.data.utilization) * 100)}%</>
            )}
          </span>
        )}
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
            \u2299
          </button>
        </div>
      </div>
      {!node.collapsed && (
        <div class={`docked-node-body${node.type === 'context' ? ' context-body' : ''}`}>
          {renderDockedContent(node)}
        </div>
      )}
    </div>
  );
}
