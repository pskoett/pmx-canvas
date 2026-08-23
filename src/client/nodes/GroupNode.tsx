import { nodes } from '../state/canvas-store';
import type { CanvasNodeState } from '../types';

interface GroupNodeProps {
  node: CanvasNodeState;
}

/**
 * Group frame body (rail-chrome-v2 groups v2): the children live in the world
 * layer and the name/count/actions sit on the frame edge, so the body is just
 * the wash — plus a hint while the group is empty.
 */
export function GroupNode({ node }: GroupNodeProps) {
  const childIds = (node.data.children as string[]) ?? [];
  const liveChildren = childIds.filter((id) => nodes.value.has(id));
  if (liveChildren.length > 0) return null;
  return <div class="group-empty-hint">Drop nodes here — release while the frame lights up to add them</div>;
}
