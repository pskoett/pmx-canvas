import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/preact';
import { DiffNode } from '../../src/client/nodes/DiffNode.tsx';
import type { CanvasNodeState } from '../../src/client/types.ts';

function makeDiffNode(data: Record<string, unknown>): CanvasNodeState {
  return {
    id: 'diff-test',
    type: 'diff',
    position: { x: 0, y: 0 },
    size: { width: 640, height: 420 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data,
  };
}

afterEach(cleanup);

describe('DiffNode render', () => {
  test('renders add/remove/context lines with the right classes and a file header', () => {
    const content = [
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,3 +1,3 @@',
      ' const keep = 1;',
      '-const removed = 2;',
      '+const added = 2;',
    ].join('\n');
    const { container, getByText } = render(<DiffNode node={makeDiffNode({ content })} />);

    expect(getByText('src/app.ts')).toBeTruthy();
    expect(container.querySelector('.diff-file-header')?.textContent).toBe('src/app.ts');
    expect(container.querySelector('.diff-hunk')?.textContent).toBe('@@ -1,3 +1,3 @@');
    expect(container.querySelector('.diff-line-add')?.textContent).toBe('+const added = 2;');
    expect(container.querySelector('.diff-line-remove')?.textContent).toBe('-const removed = 2;');
    expect(container.querySelector('.diff-line-context')?.textContent).toBe(' const keep = 1;');
  });

  test('renders a muted placeholder for empty content', () => {
    const { container, getByText } = render(<DiffNode node={makeDiffNode({ content: '   ' })} />);
    expect(getByText('Empty diff')).toBeTruthy();
    expect(container.querySelector('.diff-node-empty')).toBeTruthy();
  });
});
