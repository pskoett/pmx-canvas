import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { EdgeLayer } from '../../src/client/canvas/EdgeLayer.tsx';
import { edges as storeEdges, nodes as storeNodes, viewport } from '../../src/client/state/canvas-store.ts';
import { applyContextStatus, linksChanged } from '../../src/client/state/context-status-store.ts';
import { applyPresenceSnapshot, resetPresence } from '../../src/client/state/presence-store.ts';
import type { CanvasEdge, CanvasNodeState } from '../../src/client/types.ts';
import { type AgentPresence, HUMAN_STARTED_SESSION_LABEL } from '../../src/shared/agent-presence.ts';

// Connection changes, option C (docs/design/LinksOptions.dc.html): the mark sits
// on the link's pill until a read carries either end, and names whichever agent.

function card(id: string, x: number): CanvasNodeState {
  return {
    id,
    type: 'markdown',
    position: { x, y: 0 },
    size: { width: 200, height: 100 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data: { title: id },
  };
}

const human = { actor: 'human' as const, source: 'browser' };
const codex = { actor: 'agent' as const, source: 'mcp', agentId: 'codex' };

function draw(list: CanvasEdge[]): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(<EdgeLayer nodes={signal(storeNodes.value)} edges={signal(new Map(list.map((e) => [e.id, e])))} />, host);
  return host;
}

beforeEach(() => {
  storeNodes.value = new Map([
    ['a', card('a', 0)],
    ['b', card('b', 800)],
    ['c', card('c', 1600)],
  ]);
  viewport.value = { x: 0, y: 0, scale: 1 };
  applyContextStatus({});
  resetPresence();
});
afterEach(() => {
  document.body.innerHTML = '';
  applyContextStatus({});
  resetPresence();
});

describe('link marks', () => {
  test('quiet on a board no agent has read', () => {
    const host = draw([
      { id: 'e1', from: 'a', to: 'b', type: 'relation', label: 'supports', revision: 9, changedBy: human },
    ]);
    expect(host.querySelector('[data-testid="edge-link-mark"]')).toBeNull();
  });

  test("a person's unseen link says which agent has not seen it; an agent's says which agent drew it", () => {
    applyContextStatus({ links: { a: 4, b: 4, c: 4 } });
    const copilot: AgentPresence = {
      sessionId: 'copilot',
      source: 'copilot',
      agentId: null,
      label: 'Copilot',
      phase: 'idle',
      detail: null,
      focusNodeId: null,
      cursor: null,
      attached: true,
      opCount: 0,
      contextUsage: null,
      lastSeenAt: '2026-10-08T00:00:00.000Z',
    };
    applyPresenceSnapshot({ presences: [copilot] });
    const host = draw([
      { id: 'mine', from: 'a', to: 'b', type: 'relation', label: 'supports', revision: 9, changedBy: human },
      { id: 'theirs', from: 'b', to: 'c', type: 'relation', revision: 10, changedBy: codex },
      { id: 'old', from: 'a', to: 'c', type: 'relation', label: 'informs', revision: 3, changedBy: human },
    ]);
    const marks = [...host.querySelectorAll('[data-testid="edge-link-mark"]')];
    expect(marks.map((mark) => mark.textContent)).toEqual(['not seen by Copilot', 'by codex']);
    expect(marks[0]?.getAttribute('class')).toContain('is-not-seen');
    expect(marks[1]?.getAttribute('class')).toContain('is-agent');
  });

  test('without an attached agent the mark names no particular agent', () => {
    applyContextStatus({ links: { a: 4 } });
    const host = draw([{ id: 'e1', from: 'a', to: 'b', type: 'relation', revision: 9, changedBy: human }]);
    expect(host.querySelector('[data-testid="edge-link-mark"]')?.textContent).toBe('not seen by the agent');
    // A session you started that no agent has joined yet is not an agent's name.
    applyPresenceSnapshot({
      presences: [
        {
          sessionId: 'browser',
          source: 'browser',
          agentId: null,
          label: HUMAN_STARTED_SESSION_LABEL,
          phase: 'idle',
          detail: null,
          focusNodeId: null,
          cursor: null,
          attached: true,
          opCount: 0,
          contextUsage: null,
          lastSeenAt: '2026-10-08T00:00:00.000Z',
        },
      ],
    });
    const again = draw([{ id: 'e2', from: 'a', to: 'b', type: 'relation', revision: 9, changedBy: human }]);
    expect(again.querySelector('[data-testid="edge-link-mark"]')?.textContent).toBe('not seen by the agent');
  });

  test("a card's links changed after the read: a person's link or a removal counts, an agent's own link does not", () => {
    applyContextStatus({ links: { a: 4, b: 4 } });
    storeEdges.value = new Map();
    expect(linksChanged('a', 9)).toBe(true); // nothing left on an edge: a removal
    expect(linksChanged('a', 4)).toBe(false);
    expect(linksChanged('c', 9)).toBe(false); // never carried by a read

    storeEdges.value = new Map([
      ['e1', { id: 'e1', from: 'a', to: 'b', type: 'relation', revision: 9, changedBy: codex }],
    ]);
    expect(linksChanged('a', 9)).toBe(false);

    storeEdges.value = new Map([
      ['e1', { id: 'e1', from: 'a', to: 'b', type: 'relation', revision: 9, changedBy: codex }],
      ['e2', { id: 'e2', from: 'b', to: 'a', type: 'relation', revision: 7, changedBy: human }],
    ]);
    expect(linksChanged('a', 9)).toBe(true);
    storeEdges.value = new Map();
  });
});
