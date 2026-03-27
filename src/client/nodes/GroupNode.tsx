import type { CanvasNodeState } from '../types';
import { nodes } from '../state/canvas-store';

interface GroupNodeProps {
  node: CanvasNodeState;
}

export function GroupNode({ node }: GroupNodeProps) {
  const childIds = (node.data.children as string[]) ?? [];
  const color = (node.data.color as string) || 'var(--c-accent)';
  const allNodes = nodes.value;

  // Count how many children actually exist
  const liveChildren = childIds.filter((id) => allNodes.has(id));
  const childCount = liveChildren.length;

  // Build a type summary for the collapsed view
  const typeCounts: Record<string, number> = {};
  for (const id of liveChildren) {
    const child = allNodes.get(id);
    if (child) typeCounts[child.type] = (typeCounts[child.type] ?? 0) + 1;
  }
  const typeSummary = Object.entries(typeCounts)
    .map(([type, count]) => `${count} ${type}`)
    .join(', ');

  return (
    <div class="group-node-body" style={{ '--group-color': color } as Record<string, string>}>
      <div class="group-summary">
        <span class="group-child-count">{childCount} node{childCount !== 1 ? 's' : ''}</span>
        {typeSummary && <span class="group-type-summary">{typeSummary}</span>}
      </div>
      {childCount === 0 && (
        <div class="group-empty-hint">
          Drag nodes here or use the selection bar to group nodes
        </div>
      )}
    </div>
  );
}
