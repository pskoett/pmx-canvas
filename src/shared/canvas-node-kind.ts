export interface CanvasNodeKindInput {
  type: string;
  data: Record<string, unknown>;
}

export function getCanvasNodeKind(node: CanvasNodeKindInput): string {
  if (node.type !== 'mcp-app') return node.type;

  const data = node.data;
  if (data.viewerType === 'web-artifact') return 'web-artifact';
  if (data.mode === 'ext-app') return 'external-app';
  if (data.hostMode === 'hosted' && typeof data.path === 'string') return 'web-artifact';
  return 'mcp-app';
}
