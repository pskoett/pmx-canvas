import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { CommandBar } from '../../src/client/canvas/CommandBar.tsx';
import { SessionReceipt } from '../../src/client/canvas/SessionReceipt.tsx';
import { TopBar } from '../../src/client/canvas/TopBar.tsx';
import { contextPinnedNodeIds, nodes, replaceContextPinsFromServer } from '../../src/client/state/canvas-store.ts';
import { applyPresenceSnapshot, resetPresence } from '../../src/client/state/presence-store.ts';
import { applySessionReceipt, resetSessionStore, sessionReceipt } from '../../src/client/state/session-store.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';

// rail-chrome-v2 phase 5: the human's steering surface while a session is
// attached (command bar) and the receipt once it ends.

function makeNode(id: string, title?: string): CanvasNodeState {
  return {
    id,
    type: 'markdown',
    position: { x: 0, y: 0 },
    size: { width: 300, height: 200 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data: title === undefined ? {} : { title },
  };
}

type Call = { url: string; init: RequestInit | undefined };
let calls: Call[];
let respond: (url: string) => Response;

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return respond(url);
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  calls = [];
  respond = () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  resetPresence();
  resetSessionStore();
  contextPinnedNodeIds.value = new Set();
  nodes.value = new Map([
    ['n1', makeNode('n1', 'Spec')],
    ['n2', makeNode('n2')],
  ]);
});
afterEach(cleanup);

describe('command bar', () => {
  test('shows the pinned context as chips (title, else type) and × unpins through the same pin toggle', async () => {
    act(() => replaceContextPinsFromServer(['n1', 'n2']));
    const { container, getByLabelText } = render(<CommandBar />);
    const chips = [...container.querySelectorAll('.command-bar-chip-label')].map((chip) => chip.textContent);
    expect(chips).toEqual(['Spec', 'markdown']);

    fireEvent.click(getByLabelText('Unpin Spec'));
    expect([...contextPinnedNodeIds.value]).toEqual(['n2']);
    await waitFor(() => expect(calls.some((call) => call.url.includes('/api/canvas/context-pins'))).toBe(true));
  });

  test('Enter posts a steering message as the workbench and clears the draft on success', async () => {
    const { container, getByLabelText } = render(<CommandBar />);
    const input = getByLabelText('Steer the agent') as HTMLInputElement;
    const send = container.querySelector('.command-bar-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    fireEvent.input(input, { target: { value: '  Use the spec node, skip the tests for now  ' } });
    expect(send.disabled).toBe(false);
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(calls.some((call) => call.url === '/api/canvas/ax/steer')).toBe(true));
    const steer = calls.find((call) => call.url === '/api/canvas/ax/steer')!;
    expect(steer.init?.method).toBe('POST');
    expect(new Headers(steer.init?.headers).get('x-pmx-workbench')).toBe('1');
    expect(JSON.parse(String(steer.init?.body))).toEqual({
      message: 'Use the spec node, skip the tests for now',
      source: 'browser',
    });
    await waitFor(() => expect(input.value).toBe(''));
  });

  test('keeps the draft when the send fails', async () => {
    respond = () => new Response('{"error":"nope"}', { status: 500 });
    const { getByLabelText } = render(<CommandBar />);
    const input = getByLabelText('Steer the agent') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'try again' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(calls.length).toBe(1));
    await waitFor(() => expect(input.disabled).toBe(false));
    expect(input.value).toBe('try again');
  });

  const presence = (label: string, attached: boolean) => ({
    sessionId: label,
    source: label,
    agentId: null,
    label,
    phase: 'idle' as const,
    detail: null,
    focusNodeId: null,
    cursor: null,
    attached,
    opCount: 1,
    contextUsage: null,
    lastSeenAt: '2026-08-23T00:00:00.000Z',
  });

  test('with several connected agents the composer offers a target picker and addresses the steer', async () => {
    act(() =>
      applyPresenceSnapshot({
        presences: [
          // An external writer whose consumer HAS claimed deliveries — the
          // server marked it steerable, so the picker offers it.
          { ...presence('codex', false), steerable: true },
          presence('claude-code', true),
          // A one-shot writer (curl / the CLI): presence without an inbox.
          // Nothing polls its steering, so it must NOT be offered as a target.
          { ...presence('api', false) },
          { ...presence('codex-cli', false) },
          // An adapter session: pretty display label, but the CONSUMER key it
          // claims deliveries with is its source — the steer must target that.
          { ...presence('copilot', true), label: 'GitHub Copilot' },
        ],
      }),
    );
    const { container, getByLabelText } = render(<CommandBar />);
    const picker = getByLabelText('Steer which agent') as HTMLSelectElement;
    // Sessions first, claim-proven live writers after (suffixed) — writers
    // with no steering inbox excluded — broadcast default.
    expect([...picker.options].map((option) => [option.value, option.textContent])).toEqual([
      ['', 'All agents'],
      ['claude-code', 'claude-code'],
      ['copilot', 'GitHub Copilot'],
      ['codex', 'codex · writer'],
    ]);
    expect(picker.value).toBe('');

    fireEvent.change(picker, { target: { value: 'copilot' } });
    const input = getByLabelText('Steer the agent') as HTMLInputElement;
    expect(input.placeholder).toContain('Steer GitHub Copilot');
    fireEvent.input(input, { target: { value: 'fix the CI flake' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(calls.some((call) => call.url === '/api/canvas/ax/steer')).toBe(true));
    expect(JSON.parse(String(calls.find((call) => call.url === '/api/canvas/ax/steer')!.init?.body))).toEqual({
      message: 'fix the CI flake',
      source: 'browser',
      target: 'copilot',
    });

    // The picked agent disconnecting falls back to broadcast — presence is the truth.
    act(() =>
      applyPresenceSnapshot({
        presences: [presence('claude-code', true), { ...presence('codex', false), steerable: true }],
      }),
    );
    expect((getByLabelText('Steer which agent') as HTMLSelectElement).value).toBe('');
    expect((getByLabelText('Steer the agent') as HTMLInputElement).placeholder).toContain('Steer the agent');
  });

  test('one connected agent (or only the un-adopted placeholder besides it) means no picker', () => {
    act(() => applyPresenceSnapshot({ presences: [presence('claude-code', true)] }));
    const { container: one } = render(<CommandBar />);
    expect(one.querySelector('.command-bar-target')).toBeNull();
    cleanup();
    act(() =>
      applyPresenceSnapshot({
        presences: [
          { ...presence('Agent session', true), sessionId: 'browser', source: 'browser' },
          presence('codex', false),
        ],
      }),
    );
    const { container: two } = render(<CommandBar />);
    expect(two.querySelector('.command-bar-target')).toBeNull();
  });

  test('shows the chips as gold ✦ pins with the "in agent context" note and no meter of its own', () => {
    act(() => replaceContextPinsFromServer(['n1']));
    const { container } = render(<CommandBar />);
    expect(container.querySelector('.command-bar-chip-glyph')?.textContent).toBe('✦');
    expect(container.querySelector('.command-bar-chips-note')?.textContent).toBe('in agent context');
    expect(container.querySelector('[data-testid="budget-label"]')).toBeNull();
  });
});

describe('top-bar context budget', () => {
  const attached = {
    sessionId: 'browser',
    source: 'browser',
    agentId: null,
    label: 'Agent session',
    phase: 'idle' as const,
    detail: null,
    focusNodeId: null,
    cursor: null,
    attached: true,
    opCount: 0,
    contextUsage: null,
    lastSeenAt: '2026-08-23T00:00:00.000Z',
  };

  test('one chip per attached session — a second agent is visible up top, not only on the board', () => {
    act(() =>
      applyPresenceSnapshot({
        presences: [
          attached,
          { ...attached, sessionId: 'copilot', source: 'copilot', label: 'GitHub Copilot', phase: 'tooling' as const },
        ],
        budget: { used: 0, total: 10_000 },
      }),
    );
    const { container } = render(<TopBar />);
    const chips = [...container.querySelectorAll('.agent-chip')];
    expect(chips.map((chip) => chip.querySelector('.agent-chip-who')?.textContent)).toEqual([
      'Agent session',
      'GitHub Copilot',
    ]);
    expect(chips.map((chip) => chip.getAttribute('data-phase'))).toEqual(['idle', 'tooling']);
  });

  test('is absent on the quiet board; in a session it reads the presence budget and shifts tone at 70% and 90%', () => {
    const { container, rerender } = render(<TopBar />);
    expect(container.querySelector('.context-budget')).toBeNull();

    act(() => applyPresenceSnapshot({ presences: [attached], budget: { used: 0, total: 10_000 } }));
    rerender(<TopBar />);
    const meter = () => container.querySelector('.context-budget')!;
    const label = () => container.querySelector('[data-testid="budget-label"]')?.textContent;
    expect(label()).toBe('0%');
    expect(meter().className).toContain('tone-ok');

    // A couple of tiny pins round to 0% — say "<1%" rather than looking empty.
    act(() => applyPresenceSnapshot({ budget: { used: 12, total: 10_000 } }));
    rerender(<TopBar />);
    expect(label()).toBe('<1%');

    act(() => applyPresenceSnapshot({ budget: { used: 7_500, total: 10_000 } }));
    rerender(<TopBar />);
    expect(label()).toBe('75%');
    expect(meter().className).toContain('tone-warn');

    act(() => applyPresenceSnapshot({ budget: { used: 9_500, total: 10_000 } }));
    rerender(<TopBar />);
    expect(label()).toBe('95%');
    expect(meter().className).toContain('tone-danger');
    expect((container.querySelector('.context-budget-fill') as HTMLElement).style.width).toBe('95%');
  });

  test('reads "Pins" (estimate) until the host reports the real window, then "Context" with the reported numbers', () => {
    act(() => applyPresenceSnapshot({ presences: [attached], budget: { used: 3_100, total: 32_000 } }));
    const { container, rerender } = render(<TopBar />);
    const meter = () => container.querySelector('.context-budget')!;
    expect(meter().getAttribute('data-mode')).toBe('pins');
    expect(container.querySelector('.context-budget-caption')?.textContent).toBe('Pins');
    // The explanation is a styled tooltip, not a native title (invisible in embedded panes).
    const tooltip = () => meter().parentElement?.querySelector('.toolbar-tooltip');
    expect(tooltip()?.textContent).toContain('Pins — pinned-context size (estimate)');
    expect(tooltip()?.textContent).toContain('≈ 3.1k of a 32k-token budget');
    expect(container.querySelector('[data-testid="budget-label"]')?.textContent).toBe('10%');

    act(() => applyPresenceSnapshot({ presences: [{ ...attached, contextUsage: { used: 42_800, total: 128_000 } }] }));
    rerender(<TopBar />);
    expect(meter().getAttribute('data-mode')).toBe('window');
    expect(container.querySelector('.context-budget-caption')?.textContent).toBe('Context');
    expect(tooltip()?.textContent).toContain('Context window — reported by Agent session');
    expect(tooltip()?.textContent).toContain('43k of 128k tokens');
    expect(container.querySelector('[data-testid="budget-label"]')?.textContent).toBe('33%');
  });
});

describe('session receipt', () => {
  const ended = {
    label: 'Copilot',
    endedAt: '2026-08-23T14:05:00.000Z',
    counts: { items: 4, done: 3, vetoed: 1 },
    snapshot: { id: 'snap-1', name: 'Before session · Copilot · 14:00' },
  };

  test('renders nothing until a session ends, then the counts and the restore hint', () => {
    const { container, rerender, getByTestId } = render(<SessionReceipt onOpenSnapshots={() => {}} />);
    expect(container.innerHTML).toBe('');

    act(() => applySessionReceipt(ended));
    rerender(<SessionReceipt onOpenSnapshots={() => {}} />);
    const tiles = [...getByTestId('session-receipt').querySelectorAll('.session-receipt-tile-value')].map(
      (tile) => tile.textContent,
    );
    expect(tiles).toEqual(['4', '3', '1']);
    expect(getByTestId('session-receipt').textContent).toContain('restore it to undo the session');
  });

  test('View diff compares the board against the pre-session snapshot; Full log opens the snapshots panel', async () => {
    respond = (url) =>
      new Response(
        JSON.stringify(
          url.includes('/diff')
            ? {
                diff: {
                  addedNodes: [{}, {}],
                  removedNodes: [],
                  modifiedNodes: [{}],
                  addedEdges: [{}],
                  removedEdges: [],
                },
              }
            : {},
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    let opened = 0;
    act(() => applySessionReceipt(ended));
    const { getByText, getByTestId } = render(<SessionReceipt onOpenSnapshots={() => (opened += 1)} />);

    fireEvent.click(getByText('View diff'));
    await waitFor(() =>
      expect(getByTestId('session-receipt-diff').textContent).toBe('This session: 3 added · 0 removed · 1 modified'),
    );
    expect(calls[0]?.url).toBe('/api/canvas/snapshots/snap-1/diff');

    fireEvent.click(getByText('History'));
    expect(opened).toBe(1);
  });

  test('a snapshot-less receipt has NO View diff button — the note explains why', () => {
    act(() => applySessionReceipt({ ...ended, snapshot: null }));
    const { queryByText, getByTestId } = render(<SessionReceipt onOpenSnapshots={() => {}} />);
    expect(queryByText('View diff')).toBeNull();
    expect(getByTestId('session-receipt').textContent).toContain('nothing to restore');
    cleanup();
    // An UNCHANGED session says so instead (its snapshot was dropped on purpose).
    act(() => applySessionReceipt({ ...ended, snapshot: null, unchanged: true }));
    const { queryByText: query2, getByTestId: get2 } = render(<SessionReceipt onOpenSnapshots={() => {}} />);
    expect(query2('View diff')).toBeNull();
    expect(get2('session-receipt').textContent).toContain('changed nothing on the board — no snapshot kept');
  });

  test('dismiss clears the receipt; a malformed frame is ignored', () => {
    act(() => applySessionReceipt(ended));
    const { getByLabelText, container } = render(<SessionReceipt onOpenSnapshots={() => {}} />);
    fireEvent.click(getByLabelText('Dismiss receipt'));
    expect(sessionReceipt.value).toBeNull();
    expect(container.innerHTML).toBe('');

    act(() => applySessionReceipt({ counts: { items: 1 } }));
    expect(sessionReceipt.value).toBeNull();
  });
});
