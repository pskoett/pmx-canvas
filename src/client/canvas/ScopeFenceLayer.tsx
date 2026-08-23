import { fenceRectFromNodes } from '../../shared/scope-fence.js';
import { nodes, viewport } from '../state/canvas-store';
import { sessionActive } from '../state/presence-store';
import { scopeFence } from '../state/session-store';

/**
 * Scope fence (rail-chrome-v2 phase 4, design item 4): the region the human
 * granted the attached agent. Drawn in the world layer from the same geometry
 * the server enforces (fenced nodes' bounding box + padding), so what the
 * human sees is exactly what the agent is held to. Mounts only while a
 * session is attached and a fence is set.
 */
export function ScopeFenceLayer() {
  if (!sessionActive.value) return null;
  const fence = scopeFence.value;
  if (!fence) return null;
  const nodeMap = nodes.value;
  const fenced = fence.nodeIds.map((id) => nodeMap.get(id)).filter((node) => node !== undefined);
  const rect = fenceRectFromNodes(fenced, fence.padding);
  if (!rect) return null;
  const counterScale = 1 / Math.max(0.05, viewport.value.scale);

  return (
    <div
      class="scope-fence"
      data-fenced-count={fenced.length}
      style={{ transform: `translate(${rect.x}px, ${rect.y}px)`, width: `${rect.width}px`, height: `${rect.height}px` }}
      aria-hidden="true"
    >
      <span class="scope-fence-pill scope-fence-pill-top" style={{ transform: `scale(${counterScale})` }}>
        Agent scope · {fenced.length} node{fenced.length === 1 ? '' : 's'}
      </span>
      <span class="scope-fence-pill scope-fence-pill-bottom" style={{ transform: `scale(${counterScale})` }}>
        writes outside are blocked · reads allowed
      </span>
    </div>
  );
}
