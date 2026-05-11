import type { CanvasNodeState } from '../types';

export const AUTO_FIT_TITLEBAR_HEIGHT = 37;
export const AUTO_FIT_MAX_HEIGHT = 600;

function isExtAppNode(node: CanvasNodeState): boolean {
  return node.type === 'mcp-app' && node.data.mode === 'ext-app';
}

function hasExplicitStructuredFrame(node: CanvasNodeState): boolean {
  return node.type === 'graph' || node.type === 'json-render';
}

function isPresentationHtmlNode(node: CanvasNodeState): boolean {
  return node.type === 'html' && node.data.presentation === true;
}

export function shouldAutoFitNode(node: CanvasNodeState): boolean {
  return !node.collapsed && !node.dockPosition && node.data.strictSize !== true && node.type !== 'group' && !isExtAppNode(node) && !hasExplicitStructuredFrame(node) && !isPresentationHtmlNode(node);
}

export function computeAutoFitHeight(node: CanvasNodeState, contentHeight: number): number | null {
  if (!shouldAutoFitNode(node) || contentHeight <= 0) return null;
  return Math.min(contentHeight + AUTO_FIT_TITLEBAR_HEIGHT, AUTO_FIT_MAX_HEIGHT);
}
