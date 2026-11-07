import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { PromptNode } from '../../src/client/nodes/PromptNode.tsx';
import { nodes, updateNodeData } from '../../src/client/state/canvas-store.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  nodes.value = new Map();
});

test('a failed reply removes only its own turn, keeping turns that arrived while it was sending', async () => {
  const thread: CanvasNodeState = {
    id: 'thread',
    type: 'prompt',
    position: { x: 0, y: 0 },
    size: { width: 520, height: 400 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data: {
      threadStatus: 'answered',
      turns: [
        { role: 'user', text: 'First question', status: 'pending' },
        { role: 'assistant', text: 'First answer', status: 'complete', responseId: 'r1' },
      ],
    },
  };
  nodes.value = new Map([[thread.id, thread]]);
  let fail: (response: Response) => void = () => {};
  globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Promise<Response>((resolve) => (fail = resolve))) as typeof fetch;

  const view = render(<PromptNode node={nodes.value.get('thread') as CanvasNodeState} />);
  const reply = view.getByPlaceholderText('Reply…') as HTMLTextAreaElement;
  fireEvent.input(reply, { target: { value: 'Follow-up' } });
  fireEvent.keyDown(reply, { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect((nodes.value.get('thread')?.data.turns as unknown[]).length).toBe(3));

  // The server echoes the reply (as new turn objects) and another agent's answer lands
  // while this reply is still in flight.
  const latest = nodes.value.get('thread')?.data.turns as Array<Record<string, unknown>>;
  act(() =>
    updateNodeData('thread', {
      turns: [
        ...latest.map((turn) => ({ ...turn })),
        { role: 'assistant', text: 'Late answer', status: 'complete', responseId: 'r2' },
      ],
    }),
  );
  await act(async () => fail(Response.json({ ok: false, error: 'Rejected.' }, { status: 409 })));

  await waitFor(() => expect(view.queryByText('Failed to send reply. Your draft has been restored.')).not.toBeNull());
  const turns = (nodes.value.get('thread')?.data.turns as Array<{ text: string }>).map((turn) => turn.text);
  expect(turns).toEqual(['First question', 'First answer', 'Late answer']);
});
