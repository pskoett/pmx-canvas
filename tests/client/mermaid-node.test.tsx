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
  test('renders diagrams inline without allocating an iframe', () => {
    const { container } = render(<MermaidNode node={makeMermaidNode({ content: 'graph TD; A-->B;' })} />);
    expect(container.querySelector('.mermaid-diagram')).toBeTruthy();
    expect(container.querySelector('iframe')).toBeNull();
  });

  test('renders a muted placeholder when no source is set', () => {
    const { container, getByText } = render(<MermaidNode node={makeMermaidNode({})} />);
    expect(getByText('No diagram source set')).toBeTruthy();
    expect(container.querySelector('iframe')).toBeNull();
  });

  test('switches the inline fit mode', () => {
    const node = makeMermaidNode({ content: 'graph TD; A-->B;' });
    const { container, rerender } = render(<MermaidNode node={node} />);
    expect(container.querySelector('.mermaid-viewer')?.getAttribute('data-fit')).toBe('contain');
    rerender(<MermaidNode node={{ ...node, data: { ...node.data, fit: 'none' } }} />);
    expect(container.querySelector('.mermaid-viewer')?.getAttribute('data-fit')).toBe('none');
  });
});
