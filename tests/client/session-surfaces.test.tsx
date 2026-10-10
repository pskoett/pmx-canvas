import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { CommandBar } from '../../src/client/canvas/CommandBar.tsx';
import { SessionPanel } from '../../src/client/canvas/SessionPanel.tsx';
import { SessionReceipt } from '../../src/client/canvas/SessionReceipt.tsx';
import { TopBar } from '../../src/client/canvas/TopBar.tsx';
import {
  axSurfaceState,
  contextPinnedNodeIds,
  nodes,
  replaceContextPinsFromServer,
} from '../../src/client/state/canvas-store.ts';
import { applyPresenceSnapshot, resetPresence } from '../../src/client/state/presence-store.ts';
import { activeBoardId, boardList } from '../../src/client/state/boards-store.ts';
import {
  activityLens,
  activityLensNodeIds,
  applySessionReceipt,
  resetSessionStore,
  sessionEditedIds,
  sessionReceipt,
} from '../../src/client/state/session-store.ts';
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
  activeBoardId.value = null;
  boardList.value = [];
  contextPinnedNodeIds.value = new Set();
  nodes.value = new Map([
    ['n1', makeNode('n1', 'Spec')],
    ['n2', makeNode('n2')],
  ]);
});
afterEach(cleanup);

describe('session panel disclosure', () => {
  const attached = {
    sessionId: 'copilot',
    source: 'copilot',
    agentId: null,
    label: 'Copilot',
    phase: 'tooling' as const,
    detail: 'Editing files',
    focusNodeId: null,
    cursor: null,
    attached: true,
    opCount: 2,
    contextUsage: null,
    lastSeenAt: '2026-09-09T12:00:00.000Z',
  };
  const gate = {
    id: 'gate-1',
    title: 'Deploy?',
    detail: null,
    status: 'pending',
    nodeIds: [],
    createdAt: '2026-09-09T12:00:00.000Z',
    expiresAt: null,
  };

  beforeEach(() => {
    act(() => applyPresenceSnapshot({ presences: [attached] }));
  });

  test('starts compact with live activity, auto-opens for a gate, and closes after approval or rejection', () => {
    const { container } = render(<SessionPanel />);
    expect(container.querySelector('.session-panel')?.classList.contains('is-collapsed')).toBe(true);
    expect(container.querySelector('.session-collapsed-live')?.textContent).toContain('live');
    expect(container.querySelector('.session-collapsed-live')?.getAttribute('aria-label')).toContain(
      'Running Editing files',
    );

    act(() => {
      axSurfaceState.value = { approvalGates: [gate] };
    });
    expect(container.querySelector('.session-panel')?.classList.contains('is-collapsed')).toBe(false);
    expect(container.querySelector('[data-gate-id="gate-1"]')).not.toBeNull();

    act(() => {
      axSurfaceState.value = { approvalGates: [{ ...gate, status: 'approved' }] };
    });
    expect(container.querySelector('.session-panel')?.classList.contains('is-collapsed')).toBe(true);

    act(() => {
      axSurfaceState.value = { approvalGates: [{ ...gate, status: 'pending' }] };
    });
    expect(container.querySelector('.session-panel')?.classList.contains('is-collapsed')).toBe(false);
    act(() => {
      axSurfaceState.value = { approvalGates: [{ ...gate, status: 'rejected' }] };
    });
    expect(container.querySelector('.session-panel')?.classList.contains('is-collapsed')).toBe(true);
  });

  test('shows self-answer attribution when only resolved gates remain', () => {
    act(() => {
      axSurfaceState.value = {
        approvalGates: [
          { ...gate, status: 'approved', selfAnswer: true, resolvedBy: { actor: 'agent', agentId: 'reviewer' } },
        ],
      };
    });
    const { container, getByLabelText, getByRole } = render(<SessionPanel />);
    fireEvent.click(getByLabelText('Expand session panel'));
    fireEvent.click(getByRole('button', { name: /Work items/i }));
    expect(container.querySelector('[data-gate-id="gate-1"]')?.textContent).toContain('Self-approved by reviewer');
    expect(container.textContent).not.toContain('No work items yet');
  });

  test('preserves a panel the user opened after gates settle', () => {
    const { container, getByLabelText } = render(<SessionPanel />);
    fireEvent.click(getByLabelText('Expand session panel'));
    expect(container.querySelector('.session-panel')?.classList.contains('is-collapsed')).toBe(false);

    act(() => {
      axSurfaceState.value = { approvalGates: [gate] };
    });
    act(() => {
      axSurfaceState.value = { approvalGates: [{ ...gate, status: 'rejected' }] };
    });
    expect(container.querySelector('.session-panel')?.classList.contains('is-collapsed')).toBe(false);

    fireEvent.click(getByLabelText('Collapse session panel'));
    expect(container.querySelector('.session-panel')?.classList.contains('is-collapsed')).toBe(true);
  });
});

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
          // server marked it steerable, so the picker offers it. Its pump
          // health (recent claim + queue depth) shows at the point of choice.
          { ...presence('codex', false), steerable: true, pendingSteers: 2, lastClaimAt: new Date().toISOString() },
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
    const { getByRole, getAllByRole, getByLabelText } = render(<CommandBar />);
    const picker = getByRole('button', { name: 'Steer which agent' });
    fireEvent.click(picker);
    // The picker is the ROSTER: sessions first, claim-proven writers
    // selectable, inbox-less writers visible but disabled with the reason.
    expect(
      getAllByRole('menuitemradio').map((option) => [
        option.getAttribute('data-value'),
        option.querySelector('span')?.textContent,
        option.hasAttribute('disabled'),
      ]),
    ).toEqual([
      ['', 'All agents', false],
      ['claude-code', 'claude-code', false],
      ['copilot', 'GitHub Copilot', false],
      ['codex', 'codex · writer · polling · 2 queued', false],
      ['api', 'api · no inbox', true],
      ['codex-cli', 'codex-cli · no inbox', true],
    ]);
    expect(getByRole('menuitemradio', { name: /All agents/ }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(getByRole('menuitemradio', { name: 'GitHub Copilot' }));
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
    expect(getByRole('button', { name: 'Steer which agent' }).textContent).toBe('All agents');
    expect((getByLabelText('Steer the agent') as HTMLInputElement).placeholder).toContain('Steer the agent');
  });

  test('a lone steerable agent needs no picker — steers auto-address it by name', () => {
    // Amended twice: the survivor of an ended session must stay addressable,
    // but a solo dropdown is noise (user call 2026-08-28) — so no picker, and
    // the composer targets the lone agent automatically.
    act(() => applyPresenceSnapshot({ presences: [presence('claude-code', true)] }));
    const { container: one, getByLabelText: byLabel } = render(<CommandBar />);
    expect(one.querySelector('.command-bar-target')).toBeNull();
    expect((byLabel('Steer the agent') as HTMLInputElement).placeholder).toContain('Steer claude-code');
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

  test('shows the chips as plain blue pins with the "in agent context" note and no meter of its own', () => {
    act(() => replaceContextPinsFromServer(['n1']));
    const { container } = render(<CommandBar />);
    // ✦ means "an agent wrote this" (HeaderMarks); a pinned chip is title + × only (Context.dc.html).
    expect(container.querySelector('.command-bar-chip')?.textContent).not.toContain('✦');
    expect(container.querySelector('.command-bar-chips-note')?.textContent).toBe('in agent context');
    expect(container.querySelector('[data-testid="token-cost"]')).toBeNull();
  });
});

describe('session receipt', () => {
  const ended = {
    label: 'Copilot',
    endedAt: '2026-08-23T14:05:00.000Z',
    counts: { items: 4, done: 3, cancelled: 1, rejected: 1, held: 0 },
    snapshot: { id: 'snap-1', name: 'Before session · Copilot · 14:00', boardId: null },
  };

  test('renders nothing until a session ends, then the counts and the restore hint', () => {
    const { container, rerender, getByTestId } = render(<SessionReceipt onOpenSnapshots={() => {}} />);
    expect(container.innerHTML).toBe('');

    act(() => applySessionReceipt(ended));
    rerender(<SessionReceipt onOpenSnapshots={() => {}} />);
    const tiles = [...getByTestId('session-receipt').querySelectorAll('.session-receipt-tile-value')].map(
      (tile) => tile.textContent,
    );
    expect(tiles).toEqual(['4', '3', '1', '1']);
    // Cancelled and Rejected are separate tiles — never one "Vetoed" pile
    // (a withdrawn duplicate is not a human's no), and an absent outcome
    // (held: 0) renders no tile at all.
    const labels = [...getByTestId('session-receipt').querySelectorAll('.session-receipt-tile-label')].map(
      (tile) => tile.textContent,
    );
    expect(labels).toEqual(['Items', 'Done', 'Cancelled', 'Rejected']);
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
  });

  test('unchanged and worker endings stay quiet and never replace a useful receipt', () => {
    const { container } = render(<SessionReceipt onOpenSnapshots={() => {}} />);
    act(() => applySessionReceipt({ ...ended, unchanged: true }));
    expect(container.innerHTML).toBe('');
    act(() => applySessionReceipt({ ...ended, parentAgentId: 'orchestrator' }));
    expect(container.innerHTML).toBe('');
    act(() => applySessionReceipt(ended));
    const useful = sessionReceipt.value;
    act(() => applySessionReceipt({ ...ended, label: 'Quiet session', unchanged: true }));
    act(() => applySessionReceipt({ ...ended, label: 'Worker', parentAgentId: 'orchestrator' }));
    expect(sessionReceipt.value).toBe(useful);
  });

  test('one session reads "What <agent> did · This session · start–end" (AgentContext.dc.html)', () => {
    act(() => applySessionReceipt({ ...ended, startedAt: '2026-08-23T13:50:00.000Z', endedBy: 'human' }));
    const { getByTestId } = render(<SessionReceipt onOpenSnapshots={() => {}} />);
    const card = getByTestId('session-receipt');
    expect(card.querySelector('.session-receipt-title')?.textContent).toBe('What Copilot did');
    const local = (iso: string) => {
      const at = new Date(iso);
      return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    };
    expect(getByTestId('session-receipt-span').textContent).toBe(
      `This session · ${local('2026-08-23T13:50:00.000Z')}–${local(ended.endedAt)} · saved as a snapshot · ended by you`,
    );
  });

  test('Tell <agent> steers about pins that changed after it read them; Undo puts edited cards back', async () => {
    act(() =>
      applySessionReceipt({
        ...ended,
        context: {
          changedSinceRead: [{ id: 'n1', title: 'SMB interviews' }],
          edited: [
            { id: 'n1', title: 'SMB interviews' },
            { id: 'n2', title: 'Pricing' },
          ],
        },
      }),
    );
    const { getByText } = render(<SessionReceipt onOpenSnapshots={() => {}} />);
    fireEvent.click(getByText('Tell Copilot'));
    await waitFor(() => expect(getByText('Told')).toBeTruthy());
    const steer = calls.find((call) => call.url === '/api/canvas/ax/steer');
    expect(JSON.parse(String(steer?.init?.body)).message).toBe(
      '“SMB interviews” changed after you read it — read it again before relying on it.',
    );

    // You edited n2 after the session: Undo leaves your edit alone.
    nodes.value = new Map(nodes.value).set('n2', {
      ...(nodes.value.get('n2') as CanvasNodeState),
      lastEditedBy: { actor: 'human', source: 'browser' },
    });
    fireEvent.click(getByText('Undo'));
    await waitFor(() => expect(getByText('Kept your edits')).toBeTruthy());
    expect(getByText('cards you edited since were left alone')).toBeTruthy();
    const restores = calls.filter((call) => call.url.endsWith('/restore-node'));
    expect(restores.map((call) => [call.url, JSON.parse(String(call.init?.body)).nodeId])).toEqual([
      ['/api/canvas/snapshots/snap-1/restore-node', 'n1'],
    ]);
  });

  test('each edited card says what the edit did; See change shows before and now, with Undo for that card', async () => {
    nodes.value = new Map(nodes.value).set('n1', {
      ...makeNode('n1', 'SMB'),
      data: { title: 'SMB', content: 'Six would downgrade.' },
    });
    act(() =>
      applySessionReceipt({
        ...ended,
        context: {
          edited: [
            {
              id: 'n1',
              title: 'SMB',
              change: 'rewrote the second paragraph',
              before: 'Eight of twelve churned.',
              after: 'Six would downgrade.',
            },
          ],
        },
      }),
    );
    const { getByText, getByTestId, getAllByRole } = render(<SessionReceipt onOpenSnapshots={() => {}} />);
    expect(getByTestId('session-receipt').textContent).toContain('SMB — rewrote the second paragraph');
    fireEvent.click(getByText('See change'));
    const pair = getByTestId('session-receipt').querySelector('.session-receipt-diff-pair') as HTMLElement;
    expect([...pair.querySelectorAll('.session-receipt-diff-text')].map((side) => side.textContent)).toEqual([
      'Eight of twelve churned.',
      'Six would downgrade.',
    ]);
    expect(pair.querySelector('del')?.textContent).toContain('Eight');
    expect(pair.querySelector('ins')?.textContent).toContain('Six');
    expect(getByText('puts back the text from before')).toBeTruthy();
    fireEvent.click(getByText('Undo this card'));
    await waitFor(() => expect(getByText('every card restored')).toBeTruthy());
    const restored = getAllByRole('button', { name: '✓ Undone' }) as HTMLButtonElement[];
    expect(restored).toHaveLength(2);
    expect(restored.every((button) => button.disabled)).toBe(true);
    expect(getByText('the card shows Before again')).toBeTruthy();
    expect(calls.filter((call) => call.url.endsWith('/restore-node'))).toHaveLength(1);
    // The receipt's edited cards carry the violet bar.
    expect(sessionEditedIds.value.has('n1')).toBe(true);
  });

  test('Undo keeps cards you edited since, and says so; See change says when a card is not on the open board', async () => {
    activeBoardId.value = 'current';
    boardList.value = [
      { id: 'other', name: 'Churn analysis', category: null, createdAt: '', lastOpenedAt: null, nodeCount: 1 },
    ];
    nodes.value = new Map(nodes.value).set('n1', {
      ...makeNode('n1', 'SMB'),
      lastEditedBy: { actor: 'human', source: 'browser' },
    });
    act(() =>
      applySessionReceipt({
        ...ended,
        context: {
          edited: [
            { id: 'n1', title: 'SMB', change: 'rewrote it', before: 'old', after: 'new' },
            { id: 'gone', boardId: 'other', title: 'Elsewhere', change: 'rewrote it', before: 'old', after: 'new' },
          ],
        },
      }),
    );
    const { getAllByText, getByText, queryByText } = render(<SessionReceipt onOpenSnapshots={() => {}} />);
    fireEvent.click(getAllByText('See change')[0]);
    expect(getByText('You edited it since')).toBeTruthy();
    expect(getByText('undo would lose your edit')).toBeTruthy();
    fireEvent.click(getAllByText('See change')[0]);
    expect(getAllByText('Hide change')).toHaveLength(1);
    expect(queryByText('You edited it since')).toBeNull();
    fireEvent.click(getByText('Open Churn analysis to undo'));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/boards/open'))).toBe(true));
    expect((getByText('Undo') as HTMLButtonElement).disabled).toBe(true);
    expect(
      calls
        .filter((call) => call.url.endsWith('/restore-node'))
        .map((call) => JSON.parse(String(call.init?.body)).nodeId),
    ).toEqual([]);
    activeBoardId.value = null;
    boardList.value = [];
  });

  test('word marks leave shared words, punctuation, Unicode and whitespace untouched', () => {
    const before = 'Café coûte €24. 😀\n\nSame word, same old word.';
    const after = 'Café coûte €29. 😀\n\nSame word, same new word.';
    act(() => applySessionReceipt({ ...ended, context: { edited: [{ id: 'n1', title: 'Price', before, after }] } }));
    const { getByText, container } = render(<SessionReceipt onOpenSnapshots={() => {}} />);
    fireEvent.click(getByText('See change'));
    const sides = container.querySelectorAll('.session-receipt-diff-text');
    expect(sides[0].textContent).toBe(before);
    expect(sides[1].textContent).toBe(after);
    expect([...sides[0].querySelectorAll('del')].map((word) => word.textContent)).toEqual(['24', 'old']);
    expect([...sides[1].querySelectorAll('ins')].map((word) => word.textContent)).toEqual(['29', 'new']);
  });

  test('the agent chip counts this session live; its lens hands over to the receipt when the session ends', () => {
    const live = {
      sessionId: 'copilot',
      source: 'copilot',
      agentId: null,
      label: 'Copilot',
      phase: 'idle' as const,
      detail: null,
      focusNodeId: null,
      cursor: null,
      attached: true,
      opCount: 3,
      contextUsage: null,
      lastSeenAt: '2026-08-23T00:00:00.000Z',
      session: { startedAt: '2026-08-23T00:00:00.000Z', read: ['n1', 'n2'], created: [], edited: ['n1'], pinned: [] },
    };
    act(() => applyPresenceSnapshot({ presences: [live] }));
    const { getByRole } = render(<TopBar />);
    const touches = getByRole('button', { name: /This session: 2 read, 1 edited/ });
    expect(touches.textContent).toBe('2 read · 1 edited');
    fireEvent.click(touches);
    expect(activityLens.value).toEqual({ kind: 'live', sessionId: 'copilot' });
    expect([...(activityLensNodeIds.value ?? [])].sort()).toEqual(['n1', 'n2']);
    expect(sessionEditedIds.value.has('n1')).toBe(true);

    act(() => applyPresenceSnapshot({ presences: [] }));
    act(() => applySessionReceipt({ ...ended, writer: 'copilot', context: { read: [{ id: 'n2', title: 'B' }] } }));
    expect(activityLens.value).toEqual({ kind: 'receipt' });
    expect([...(activityLensNodeIds.value ?? [])]).toEqual(['n2']);
  });

  test("each agent's chip shows its own lens; an ending with nothing to show turns the lens off", () => {
    const attached = (sessionId: string, read: string[]) => ({
      sessionId,
      source: sessionId,
      agentId: null,
      label: sessionId,
      phase: 'idle' as const,
      detail: null,
      focusNodeId: null,
      cursor: null,
      attached: true,
      opCount: 1,
      contextUsage: null,
      lastSeenAt: '2026-08-23T00:00:00.000Z',
      session: { startedAt: '2026-08-23T00:00:00.000Z', read, created: [], edited: [], pinned: [] },
    });
    act(() => applyPresenceSnapshot({ presences: [attached('codex', ['n1']), attached('claude', ['n2'])] }));
    const { getAllByRole } = render(<TopBar />);
    fireEvent.click(getAllByRole('button', { name: /This session: 1 read/ })[0] as HTMLElement);
    expect([...(activityLensNodeIds.value ?? [])].length).toBe(1);
    const lens = activityLens.value;
    expect(lens?.kind).toBe('live');
    const chosen = lens?.kind === 'live' ? lens.sessionId : '';
    expect([...(activityLensNodeIds.value ?? [])]).toEqual([chosen === 'codex' ? 'n1' : 'n2']);

    // Another writer with the same label ending changes nothing; the lens's own writer ending turns it off.
    act(() => applySessionReceipt({ ...ended, label: chosen, writer: 'someone-else', unchanged: true }));
    expect(activityLens.value?.kind).toBe('live');
    act(() => applySessionReceipt({ ...ended, label: chosen, writer: chosen, unchanged: true }));
    expect(activityLens.value).toBeNull();
  });

  test('a card two merged sessions both edited keeps the first Before and the last After', () => {
    const edit = (before: string, after: string, change: string) => ({ id: 'n1', title: 'SMB', before, after, change });
    act(() => applySessionReceipt({ ...ended, context: { edited: [edit('A', 'B', 'rewrote it')] } }));
    act(() =>
      applySessionReceipt({ ...ended, label: 'Codex', context: { edited: [edit('B', 'C', 'added 1 paragraph')] } }),
    );
    expect(sessionReceipt.value?.context.edited).toEqual([edit('A', 'C', 'rewrote it; then added 1 paragraph')]);
  });

  test('receipts keep same-id cards on different boards separate', () => {
    const first = { id: 'shared', boardId: 'board-a', title: 'First', before: 'A', after: 'B' };
    const second = { id: 'shared', boardId: 'board-b', title: 'Second', before: 'X', after: 'Y' };
    act(() => applySessionReceipt({ ...ended, context: { read: [first], edited: [first] } }));
    act(() => applySessionReceipt({ ...ended, context: { read: [second], edited: [second] } }));
    expect(sessionReceipt.value?.context.read).toEqual([first, second]);
    expect(sessionReceipt.value?.context.edited).toEqual([first, second]);
    const { getAllByRole } = render(<SessionReceipt onOpenSnapshots={() => {}} />);
    fireEvent.click(getAllByRole('button', { name: 'See change' })[1] as HTMLElement);
    expect(getAllByRole('button', { name: 'Hide change' })).toHaveLength(1);
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

  test('a read-only session says the board did not change, not that it was empty', () => {
    act(() => applySessionReceipt({ ...ended, snapshot: null, context: { read: [{ id: 'n1', title: 'Brief' }] } }));
    const { getByTestId } = render(<SessionReceipt onOpenSnapshots={() => {}} />);
    expect(getByTestId('session-receipt').textContent).toContain('The board itself did not change');
  });

  test('endings while a receipt is up merge into one card that points at History', () => {
    act(() => applySessionReceipt({ ...ended, context: { created: [{ id: 'a', title: 'Alpha' }] } }));
    act(() =>
      applySessionReceipt({
        ...ended,
        label: 'Codex',
        endedAt: '2026-08-23T14:05:02.000Z',
        counts: { items: 5, done: 4, cancelled: 0, rejected: 0, held: 0 },
        snapshot: { id: 'snap-2', name: 'Before session · Codex · 14:01' },
        context: { created: [{ id: 'b', title: 'Beta' }] },
      }),
    );
    // A worker or unchanged ending neither opens nor extends the card.
    act(() => applySessionReceipt({ ...ended, label: 'Worker', parentAgentId: 'Codex' }));
    act(() => applySessionReceipt({ ...ended, label: 'Idle', unchanged: true }));
    const { getByTestId, queryByText, container } = render(<SessionReceipt onOpenSnapshots={() => {}} />);
    const card = getByTestId('session-receipt');
    expect(card.querySelector('.session-receipt-title')?.textContent).toStartWith('2 sessions ended');
    expect(card.querySelector('.session-receipt-who')?.textContent).toBe('Copilot, Codex');
    expect([...card.querySelectorAll('.session-receipt-tile-value')].map((t) => t.textContent)).toEqual(['5', '4']);
    expect(card.querySelector('[data-row="created"] .session-receipt-context-items')?.textContent).toBe('Alpha, Beta');
    // No single snapshot undoes two sessions: no View diff, History has each one.
    expect(queryByText('View diff')).toBeNull();
    expect(card.textContent).toContain('History has each session');
    expect(container.querySelectorAll('[data-testid="session-receipt"]')).toHaveLength(1);
  });

  describe('no timer', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('an untouched receipt is still up after 12 s — it stays until dismissed', () => {
      act(() => applySessionReceipt(ended));
      const { getByTestId } = render(<SessionReceipt onOpenSnapshots={() => {}} />);
      act(() => {
        jest.advanceTimersByTime(12_000);
      });
      expect(sessionReceipt.value).not.toBeNull();
      expect(getByTestId('session-receipt')).toBeTruthy();
    });
  });
});
