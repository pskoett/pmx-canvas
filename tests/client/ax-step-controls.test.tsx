import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { AxStepControls } from '../../src/client/nodes/AxStepControls.tsx';
import { nodes } from '../../src/client/state/canvas-store.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';

function makeNode(data: Record<string, unknown>, type: CanvasNodeState['type'] = 'markdown'): CanvasNodeState {
  return {
    id: 'axflow-panel-1-step-1',
    type,
    position: { x: 0, y: 0 },
    size: { width: 360, height: 200 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data,
  };
}

const STEP_STAMP = { flowId: 'axflow-panel-1', index: 1, total: 3, workItemId: 'work-1' };

const FLOW_STAMP = {
  flowId: 'axflow-panel-1',
  title: 'Loop Flow',
  steps: [
    { index: 1, nodeId: 'axflow-panel-1-step-1', workItemId: 'work-1', title: 'Reproduce' },
    { index: 2, nodeId: 'axflow-panel-1-step-2', workItemId: 'work-2', title: 'Fix' },
  ],
  loop: { running: false, run: 0, maxRuns: 3 },
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  // @testing-library/preact's auto-cleanup registers under the first importing
  // test file only — unmount explicitly so nodes don't leak across files.
  cleanup();
  globalThis.fetch = originalFetch;
  nodes.value = new Map();
});

/** Records the loop states the controls persist; refuses AX interactions when asked. */
function captureLoopWrites(refuseInteractions: boolean): Array<Record<string, unknown>> {
  const loops: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body
      ? (JSON.parse(String(init.body)) as { data?: { axFlow?: { loop?: Record<string, unknown> } } })
      : {};
    if (body.data?.axFlow?.loop) loops.push(body.data.axFlow.loop);
    if (String(input).includes('/ax/interaction') && refuseInteractions)
      return Response.json({ ok: false, error: 'Refused.' }, { status: 409 });
    return Response.json({ ok: true });
  }) as typeof fetch;
  return loops;
}

describe('AxStepControls', () => {
  test('renders the step control row for a node carrying data.axStep', () => {
    const { container, getByText } = render(<AxStepControls node={makeNode({ axStep: STEP_STAMP })} />);
    expect(container.querySelector('.ax-step-controls')).toBeTruthy();
    expect(getByText('Step 1/3')).toBeTruthy();
    for (const label of ['Start', 'Done', 'Blocked']) expect(getByText(label)).toBeTruthy();
    // No flow stamp → no loop/steer controls.
    expect(container.querySelector('.ax-flow-controls')).toBeNull();
  });

  test('renders nothing for a node without a step stamp', () => {
    const { container } = render(<AxStepControls node={makeNode({ title: 'Just a note' })} />);
    expect(container.querySelector('.ax-step-controls')).toBeNull();
    expect(container.textContent).toBe('');
  });

  test('renders nothing for a malformed step stamp', () => {
    const { container } = render(<AxStepControls node={makeNode({ axStep: { flowId: 'f', index: 1 } })} />);
    expect(container.querySelector('.ax-step-controls')).toBeNull();
  });

  test('renders on any node type, not just markdown', () => {
    const { container } = render(<AxStepControls node={makeNode({ axStep: STEP_STAMP }, 'status')} />);
    expect(container.querySelector('.ax-step-controls')).toBeTruthy();
  });

  test('marks the button matching the mirrored work status as active', () => {
    const { getByText } = render(
      <AxStepControls node={makeNode({ axStep: STEP_STAMP, axWorkStatus: 'in-progress' })} />,
    );
    expect(getByText('Start').getAttribute('aria-pressed')).toBe('true');
    expect(getByText('Done').getAttribute('aria-pressed')).toBe('false');
  });

  test('adds loop + steer controls on the anchor node only', () => {
    const { container, getByText, getByLabelText } = render(
      <AxStepControls node={makeNode({ axStep: STEP_STAMP, axFlow: FLOW_STAMP })} />,
    );
    expect(container.querySelector('.ax-flow-controls')).toBeTruthy();
    expect(getByText('Run loop')).toBeTruthy();
    expect(getByText('Loop idle · 0/3 runs')).toBeTruthy();
    expect(getByLabelText('Steer the agent')).toBeTruthy();
  });

  test('shows Stop while the loop is running, with the current run', () => {
    const node = makeNode({
      axStep: STEP_STAMP,
      axFlow: { ...FLOW_STAMP, loop: { running: true, run: 1, maxRuns: 3 } },
    });
    const { getByText, queryByText } = render(<AxStepControls node={node} />);
    expect(getByText('Stop')).toBeTruthy();
    expect(queryByText('Run loop')).toBeNull();
    expect(getByText('Loop running · run 2/3')).toBeTruthy();
  });

  test('Stop keeps a run counter the server advanced after this render', async () => {
    const rendered = makeNode({
      axStep: STEP_STAMP,
      axFlow: { ...FLOW_STAMP, loop: { running: true, run: 1, maxRuns: 3 } },
    });
    // The server finished run 2 before this card re-rendered.
    const advanced = {
      ...rendered,
      data: { ...rendered.data, axFlow: { ...FLOW_STAMP, loop: { running: true, run: 2, maxRuns: 3 } } },
    };
    nodes.value = new Map([[rendered.id, advanced]]);
    const loops = captureLoopWrites(false);
    const { getByText } = render(<AxStepControls node={rendered} />);
    fireEvent.click(getByText('Stop'));
    await waitFor(() => expect(loops).toEqual([{ running: false, run: 2, maxRuns: 3 }]));
  });

  test('a loop whose first step cannot be opened is not left running', async () => {
    const node = makeNode({ axStep: STEP_STAMP, axFlow: FLOW_STAMP });
    nodes.value = new Map([[node.id, node]]);
    const loops = captureLoopWrites(true);
    const { getByText } = render(<AxStepControls node={node} />);
    fireEvent.click(getByText('Run loop'));
    await waitFor(() => expect(loops.length).toBe(2));
    expect(loops.at(-1)).toMatchObject({ running: false });
    expect((nodes.value.get(node.id)?.data.axFlow as { loop: { running: boolean } }).loop.running).toBe(false);
  });
});
