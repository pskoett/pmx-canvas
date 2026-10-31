import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { StatusNode } from '../../src/client/nodes/StatusNode.tsx';
import { activeBoardId } from '../../src/client/state/boards-store.ts';
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

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  activeBoardId.value = null;
});

describe('StatusNode render', () => {
  test('work card keeps a refused draft and its original revision; Cancel discards it', async () => {
    activeBoardId.value = 'plan-board';
    const node = { ...makeStatusNode({ title: 'Verify', workState: 'todo', progress: 37 }), contentRevision: 4 };
    let submitted: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      submitted = JSON.parse(String(init?.body));
      return Response.json({ ok: false, error: 'stale content revision' }, { status: 409 });
    }) as typeof fetch;
    const view = render(<StatusNode node={node} />);
    fireEvent.click(view.getByRole('button', { name: 'Edit' }));
    fireEvent.input(view.getByLabelText('Title'), { target: { value: 'Check the browser' } });
    const select = view.getByLabelText('Work state') as HTMLSelectElement;
    select.value = 'blocked';
    // Testing Library remaps fireEvent.change to input under compat, but select still listens for change.
    fireEvent(select, new Event('change', { bubbles: true }));
    fireEvent.input(view.getByLabelText('Progress (%) · optional'), { target: { value: '' } });
    view.rerender(<StatusNode node={{ ...node, contentRevision: 5, data: { ...node.data, workState: 'done' } }} />);
    fireEvent.click(view.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('Your draft is still here'));
    expect(submitted).toEqual({
      title: 'Check the browser',
      data: { workState: 'blocked', detail: '', progress: null },
      expectedBoardId: 'plan-board',
      expectedContentRevision: 4,
    });
    expect((view.getByLabelText('Title') as HTMLInputElement).value).toBe('Check the browser');
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
    expect(view.getByText('Done')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Edit' }));
    expect((view.getByLabelText('Title') as HTMLInputElement).value).toBe('Verify');
    fireEvent.keyDown(view.getByLabelText('Title'), { key: 'Escape' });
    expect(view.queryByLabelText('Title')).toBeNull();
  });

  test('renders the phase with its detail text', () => {
    const { getByText } = render(
      <StatusNode node={makeStatusNode({ phase: 'running', detail: 'compiling client' })} />,
    );
    expect(getByText('Running')).toBeTruthy();
    expect(getByText('compiling client')).toBeTruthy();
  });

  test('falls back to idle when no phase data is present', () => {
    const { getByText } = render(<StatusNode node={makeStatusNode({})} />);
    expect(getByText('Idle')).toBeTruthy();
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
