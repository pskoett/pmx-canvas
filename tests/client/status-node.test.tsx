import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/preact';
import { StatusNode } from '../../src/client/nodes/StatusNode.tsx';
import type { CanvasNodeState } from '../../src/client/types.ts';

function makeStatusNode(data: Record<string, unknown>): CanvasNodeState {
  return {
    id: 'status-test',
    type: 'status',
    position: { x: 0, y: 0 },
    size: { width: 320, height: 180 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data,
  };
}

afterEach(cleanup);

describe('StatusNode render', () => {
  test('renders the phase with its detail text', () => {
    const { getByText } = render(
      <StatusNode node={makeStatusNode({ phase: 'running', detail: 'compiling client' })} />,
    );
    expect(getByText('running')).toBeTruthy();
    expect(getByText('compiling client')).toBeTruthy();
  });

  test('falls back to idle when no phase data is present', () => {
    const { getByText } = render(<StatusNode node={makeStatusNode({})} />);
    expect(getByText('idle')).toBeTruthy();
  });

  test('shows the active tool row only while a tool is running', () => {
    const withTool = render(<StatusNode node={makeStatusNode({ phase: 'tooling', activeTool: 'bun test' })} />);
    expect(withTool.getByText('bun test')).toBeTruthy();

    cleanup();
    const withoutTool = render(<StatusNode node={makeStatusNode({ phase: 'tooling' })} />);
    expect(withoutTool.queryByText('bun test')).toBeNull();
  });

  test('shows a running sub-agent and hides it once completed', () => {
    const running = render(<StatusNode node={makeStatusNode({ subagent: { state: 'running', name: 'explorer' } })} />);
    expect(running.getByText('explorer')).toBeTruthy();
    expect(running.getByText('(running)')).toBeTruthy();

    cleanup();
    const completed = render(
      <StatusNode node={makeStatusNode({ subagent: { state: 'completed', name: 'explorer' } })} />,
    );
    expect(completed.queryByText('explorer')).toBeNull();
  });

  test('renders the status message when present', () => {
    const { getByText } = render(<StatusNode node={makeStatusNode({ message: '2 tests failed', level: 'error' })} />);
    expect(getByText('2 tests failed')).toBeTruthy();
  });
});
