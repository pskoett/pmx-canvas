import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/preact';
import { MermaidNode } from '../../src/client/nodes/MermaidNode.tsx';
import { iframeMode } from '../../src/client/state/iframe-mode.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';

function makeMermaidNode(data: Record<string, unknown>): CanvasNodeState {
  return {
    id: 'mermaid-test',
    type: 'mermaid',
    position: { x: 0, y: 0 },
    size: { width: 640, height: 460 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data,
  };
}

beforeEach(() => {
  // Skip the boot-wide embed probe: render surface iframes in src mode.
  iframeMode.value = 'src';
});

afterEach(() => {
  cleanup();
  iframeMode.value = null;
});

describe('MermaidNode render', () => {
  test('renders a sandboxed iframe pointing at the node surface URL', () => {
    const { container } = render(<MermaidNode node={makeMermaidNode({ content: 'graph TD; A-->B;' })} />);
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe?.getAttribute('src')).toContain('/api/canvas/surface/mermaid-test');
  });

  test('renders a muted placeholder when no source is set', () => {
    const { container, getByText } = render(<MermaidNode node={makeMermaidNode({})} />);
    expect(getByText('No diagram source set')).toBeTruthy();
    expect(container.querySelector('iframe')).toBeNull();
  });
});
