import { attentionPrimaryNodeIds, attentionRegions, attentionSecondaryNodeIds } from '../state/attention-store';
import { nodes } from '../state/canvas-store';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function getNodeRect(nodeId: string): Rect | null {
  const node = nodes.value.get(nodeId);
  if (!node || node.dockPosition !== null) return null;
  return {
    left: node.position.x,
    top: node.position.y,
    width: node.size.width,
    height: node.size.height,
  };
}

function getRegionRect(nodeIds: string[]): Rect | null {
  const rects = nodeIds
    .map((nodeId) => getNodeRect(nodeId))
    .filter((rect): rect is Rect => rect !== null);
  if (rects.length === 0) return null;

  const minLeft = Math.min(...rects.map((rect) => rect.left));
  const minTop = Math.min(...rects.map((rect) => rect.top));
  const maxRight = Math.max(...rects.map((rect) => rect.left + rect.width));
  const maxBottom = Math.max(...rects.map((rect) => rect.top + rect.height));
  const padX = 54;
  const padY = 46;

  return {
    left: minLeft - padX,
    top: minTop - padY,
    width: maxRight - minLeft + padX * 2,
    height: maxBottom - minTop + padY * 2,
  };
}

function rectStyle(rect: Rect, radius: number): Record<string, string> {
  return {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    borderRadius: `${radius}px`,
  };
}

export function FocusFieldLayer() {
  const primaryNodeIds = Array.from(attentionPrimaryNodeIds.value);
  const secondaryNodeIds = Array.from(attentionSecondaryNodeIds.value);
  const regions = attentionRegions.value;

  if (primaryNodeIds.length === 0 && secondaryNodeIds.length === 0) return null;

  return (
    <div class="attention-field-layer" aria-hidden="true">
      {regions.map((region) => {
        const rect = getRegionRect(region.nodeIds);
        if (!rect) return null;
        return (
          <div
            key={region.id}
            class="attention-field-region"
            style={rectStyle(rect, 42)}
          />
        );
      })}
      {secondaryNodeIds.map((nodeId) => {
        const rect = getNodeRect(nodeId);
        if (!rect) return null;
        return (
          <div
            key={`secondary-${nodeId}`}
            class="attention-field-node attention-field-secondary"
            style={rectStyle({
              left: rect.left - 18,
              top: rect.top - 18,
              width: rect.width + 36,
              height: rect.height + 36,
            }, 28)}
          />
        );
      })}
      {primaryNodeIds.map((nodeId) => {
        const rect = getNodeRect(nodeId);
        if (!rect) return null;
        return (
          <div
            key={`primary-${nodeId}`}
            class="attention-field-node attention-field-primary"
            style={rectStyle({
              left: rect.left - 24,
              top: rect.top - 24,
              width: rect.width + 48,
              height: rect.height + 48,
            }, 30)}
          />
        );
      })}
    </div>
  );
}
