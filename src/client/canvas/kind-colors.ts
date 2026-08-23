import type { CanvasNodeState } from '../types';

/** Kind color per node type, as CSS tokens so every theme keeps its palette. */
export const KIND_COLOR: Record<CanvasNodeState['type'], string> = {
  markdown: 'var(--c-accent)',
  'mcp-app': 'var(--c-ok)',
  webpage: 'var(--c-warn)',
  'json-render': 'var(--c-ok)',
  graph: 'var(--c-purple)',
  prompt: 'var(--c-accent)',
  response: 'var(--c-ok)',
  status: 'var(--c-warn)',
  context: 'var(--c-muted)',
  ledger: 'var(--c-dim)',
  trace: 'var(--c-purple)',
  file: 'var(--c-accent)',
  diff: 'var(--c-ok)',
  mermaid: 'var(--c-purple)',
  image: 'var(--c-ok)',
  html: 'var(--c-warn)',
  group: 'var(--c-accent)',
};
